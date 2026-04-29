//! Workflow executor — encadeia skills numa sequência ordenada.
//!
//! Cada `WorkflowStep` aponta pra uma skill por nome; o executor carrega o
//! `.md` da skill, parseia, e roda via `Executor` reutilizado. Entre steps
//! a `condition` (quando declarada) controla se o próximo roda — útil pra
//! ramos de fallback (`condition: falha`) e continuações de happy path
//! (`condition: sucesso`).
//!
//! Controle de aborto cascateado: o workflow registra seu próprio
//! `ExecutionHandle` na registry; quando o flag de abort levanta, um
//! watcher spawnado por step propaga o sinal pro `ExecutionHandle` da
//! skill em execução.
//!
//! Eventos emitidos (espelham o padrão dos `execution:*`):
//!   - `workflow:step_started` { workflow_execution_id, step_id, skill_name }
//!   - `workflow:step_completed` { workflow_execution_id, step_id, status }
//!   - `workflow:step_skipped` { workflow_execution_id, step_id, condition }
//!   - `workflow:completed` { workflow_execution_id, status }
//!
//! Eventos das skills internas (`execution:step_*`, `execution:log`, etc)
//! continuam disparando — frontend pode correlacionar pelo execution_id.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};

use crate::config;
use crate::db::models::Execution;
use crate::db::queries;
use crate::orchestrator::skill_parser;
use crate::orchestrator::state::ExecutionState;
use crate::orchestrator::variable_resolver::ResolveContext;
use crate::orchestrator::workflow_parser::{ParsedWorkflow, WorkflowStep};
use crate::orchestrator::{ExecutionHandle, ExecutionRegistry, Executor};

#[derive(Clone, Copy, PartialEq, Eq)]
enum StepOutcome {
    Success,
    Failed,
    Aborted,
    /// Reserved for future use — when a step is gated out by its condition
    /// the loop emits `workflow:step_skipped` directly without storing this
    /// outcome (the next condition checks the last *executed* step). Kept
    /// in the enum so `should_run` table tests can reference it explicitly.
    #[allow(dead_code)]
    Skipped,
}

impl StepOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Failed => "failed",
            Self::Aborted => "aborted",
            Self::Skipped => "skipped",
        }
    }
}

// ── event payloads ──────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct WorkflowStepStartedEvent {
    workflow_execution_id: String,
    step_id: String,
    skill_name: String,
}

#[derive(Clone, Serialize)]
struct WorkflowStepCompletedEvent {
    workflow_execution_id: String,
    step_id: String,
    skill_name: String,
    status: String,
    /// Skill execution row id — frontend correlates with `execution:*`
    /// events to render the inner step list inline.
    skill_execution_id: String,
}

#[derive(Clone, Serialize)]
struct WorkflowStepSkippedEvent {
    workflow_execution_id: String,
    step_id: String,
    skill_name: String,
    condition: String,
}

#[derive(Clone, Serialize)]
struct WorkflowCompletedEvent {
    workflow_execution_id: String,
    status: String,
}

// ── executor ────────────────────────────────────────────────────────────────

pub struct WorkflowExecutor {
    app: AppHandle,
    pool: SqlitePool,
    registry: ExecutionRegistry,
    handle: ExecutionHandle,
    workflow_execution_id: String,
    project_id: String,
    cwd: Option<String>,
}

impl WorkflowExecutor {
    pub fn new(
        app: AppHandle,
        pool: SqlitePool,
        registry: ExecutionRegistry,
        handle: ExecutionHandle,
        workflow_execution_id: String,
        project_id: String,
        cwd: Option<String>,
    ) -> Self {
        Self {
            app,
            pool,
            registry,
            handle,
            workflow_execution_id,
            project_id,
            cwd,
        }
    }

    pub async fn run(&self, workflow: ParsedWorkflow, seed_ctx: ResolveContext) -> ExecutionState {
        let mut last_status: Option<StepOutcome> = None;

        for step in &workflow.steps {
            if self.handle.abort.load(Ordering::SeqCst) {
                return self.finish(ExecutionState::Aborted).await;
            }

            // Condition gate. The first step always runs (no prior status to
            // compare against); subsequent steps may be skipped per the
            // `should_run` table.
            if !should_run(step.condition.as_deref(), last_status) {
                self.emit(
                    "workflow:step_skipped",
                    &WorkflowStepSkippedEvent {
                        workflow_execution_id: self.workflow_execution_id.clone(),
                        step_id: step.id.clone(),
                        skill_name: step.skill.clone(),
                        condition: step.condition.clone().unwrap_or_default(),
                    },
                );
                continue;
            }

            let outcome = self.run_step(step, &seed_ctx).await;
            last_status = Some(outcome);

            if matches!(outcome, StepOutcome::Aborted) {
                return self.finish(ExecutionState::Aborted).await;
            }
        }

        let final_state = match last_status {
            Some(StepOutcome::Failed) => ExecutionState::Failed,
            Some(StepOutcome::Aborted) => ExecutionState::Aborted,
            _ => ExecutionState::Completed,
        };
        self.finish(final_state).await
    }

    async fn run_step(&self, step: &WorkflowStep, seed_ctx: &ResolveContext) -> StepOutcome {
        // Skill content + parse
        let content = match read_skill_content(&step.skill) {
            Ok(c) => c,
            Err(_) => return self.emit_completed(step, StepOutcome::Failed, ""),
        };
        let parsed = match skill_parser::parse_skill(&content) {
            Ok(p) => p,
            Err(_) => return self.emit_completed(step, StepOutcome::Failed, ""),
        };

        // Each step gets a fresh skill execution row so the skill events
        // (`execution:step_*`) carry an id the frontend can correlate.
        let skill_execution_id = uuid::Uuid::new_v4().to_string();
        let exec_row = Execution {
            id: skill_execution_id.clone(),
            project_id: self.project_id.clone(),
            skill_name: step.skill.clone(),
            status: "running".into(),
            started_at: Some(now_iso()),
            finished_at: None,
            total_steps: parsed.steps.len() as i64,
            completed_steps: 0,
            created_at: now_iso(),
            // Workflow-driven runs aren't chat-triggered; the chat-message
            // routing key stays NULL.
            conversation_id: None,
        };
        if queries::insert_execution(&self.pool, &exec_row)
            .await
            .is_err()
        {
            return self.emit_completed(step, StepOutcome::Failed, &skill_execution_id);
        }

        let skill_handle = ExecutionHandle::new();
        self.registry
            .register(skill_execution_id.clone(), skill_handle.clone())
            .await;

        self.emit(
            "workflow:step_started",
            &WorkflowStepStartedEvent {
                workflow_execution_id: self.workflow_execution_id.clone(),
                step_id: step.id.clone(),
                skill_name: step.skill.clone(),
            },
        );

        // Cascade abort: while the inner skill runs, watch the workflow's
        // abort flag and propagate to the skill's handle. JoinHandle is
        // aborted as soon as the skill returns to avoid stray polling.
        let abort_ref = self.handle.abort.clone();
        let skill_abort_ref = skill_handle.abort.clone();
        let watcher = tokio::spawn(async move {
            while !abort_ref.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            skill_abort_ref.store(true, Ordering::SeqCst);
        });

        let executor = Executor::new(
            self.app.clone(),
            self.pool.clone(),
            skill_handle,
            skill_execution_id.clone(),
            self.cwd.clone(),
        );
        // Each step runs against a fresh ctx clone — skill state from the
        // previous step doesn't leak into this one. v1 limitation: skill
        // outputs aren't threaded into subsequent workflow steps; only the
        // status is. Future task may extend Executor::run to surface ctx.
        let final_state = executor.run(parsed, seed_ctx.clone()).await;

        watcher.abort();
        self.registry.remove(&skill_execution_id).await;

        let outcome = match final_state {
            ExecutionState::Completed => StepOutcome::Success,
            ExecutionState::Failed => StepOutcome::Failed,
            ExecutionState::Aborted => StepOutcome::Aborted,
            _ => StepOutcome::Failed,
        };

        self.emit_completed(step, outcome, &skill_execution_id);
        outcome
    }

    fn emit_completed(
        &self,
        step: &WorkflowStep,
        outcome: StepOutcome,
        skill_execution_id: &str,
    ) -> StepOutcome {
        self.emit(
            "workflow:step_completed",
            &WorkflowStepCompletedEvent {
                workflow_execution_id: self.workflow_execution_id.clone(),
                step_id: step.id.clone(),
                skill_name: step.skill.clone(),
                status: outcome.as_str().to_string(),
                skill_execution_id: skill_execution_id.to_string(),
            },
        );
        outcome
    }

    fn emit<P: Serialize + Clone>(&self, name: &str, payload: &P) {
        let _ = self.app.emit(name, payload.clone());
    }

    async fn finish(&self, state: ExecutionState) -> ExecutionState {
        let status = match state {
            ExecutionState::Completed => "completed",
            ExecutionState::Failed => "failed",
            ExecutionState::Aborted => "aborted",
            _ => "failed",
        };
        self.emit(
            "workflow:completed",
            &WorkflowCompletedEvent {
                workflow_execution_id: self.workflow_execution_id.clone(),
                status: status.to_string(),
            },
        );
        state
    }
}

// ── helpers ────────────────────────────────────────────────────────────────

/// Decide whether a step runs given the outcome of the previous step.
/// First step (no prior outcome) always runs regardless of condition —
/// otherwise a "Condição: sucesso" first step would never fire.
fn should_run(condition: Option<&str>, last: Option<StepOutcome>) -> bool {
    let Some(raw) = condition else {
        return true;
    };
    let normalized = raw
        .trim()
        .to_lowercase()
        .replace('ç', "c")
        .replace('ã', "a");

    match (normalized.as_str(), last) {
        ("" | "sempre" | "always", _) => true,
        // First step with a non-trivial condition: be permissive — the
        // user probably wrote it expecting future steps to skip, not the
        // entry point.
        (_, None) => true,
        ("sucesso" | "success", Some(o)) => matches!(o, StepOutcome::Success),
        ("falha" | "failure" | "fail", Some(o)) => matches!(o, StepOutcome::Failed),
        // Any other expression — pass through (future grammar evaluator).
        _ => true,
    }
}

fn read_skill_content(name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("nome de skill inválido: `{name}`"));
    }
    let cfg = config::load_config()?;
    let dir = PathBuf::from(cfg.skills_dir);
    let path = if name.ends_with(".md") {
        dir.join(name)
    } else {
        dir.join(format!("{name}.md"))
    };
    fs::read_to_string(&path).map_err(|e| format!("falha ao ler skill `{name}`: {e}"))
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_step_always_runs() {
        assert!(should_run(None, None));
        assert!(should_run(Some("sucesso"), None));
        assert!(should_run(Some("falha"), None));
        assert!(should_run(Some("sempre"), None));
    }

    #[test]
    fn sucesso_runs_only_after_success() {
        assert!(should_run(Some("sucesso"), Some(StepOutcome::Success)));
        assert!(!should_run(Some("sucesso"), Some(StepOutcome::Failed)));
        assert!(!should_run(Some("sucesso"), Some(StepOutcome::Skipped)));
        // ASCII fallback (the parser strips accents but a hand-written
        // condition might still have the fallback form).
        assert!(should_run(Some("success"), Some(StepOutcome::Success)));
    }

    #[test]
    fn falha_runs_only_after_failure() {
        assert!(should_run(Some("falha"), Some(StepOutcome::Failed)));
        assert!(!should_run(Some("falha"), Some(StepOutcome::Success)));
        // Cedilla strip handled.
        assert!(should_run(Some("Falha"), Some(StepOutcome::Failed)));
    }

    #[test]
    fn unknown_condition_is_permissive() {
        // Future grammar — for now, fall through to "run". Better than
        // silently skipping the step the user wanted.
        assert!(should_run(
            Some("output contains foo"),
            Some(StepOutcome::Success)
        ));
    }

    #[test]
    fn step_outcome_strings() {
        assert_eq!(StepOutcome::Success.as_str(), "success");
        assert_eq!(StepOutcome::Failed.as_str(), "failed");
        assert_eq!(StepOutcome::Aborted.as_str(), "aborted");
        assert_eq!(StepOutcome::Skipped.as_str(), "skipped");
    }
}
