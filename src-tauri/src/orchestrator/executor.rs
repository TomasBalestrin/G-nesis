//! Execution state machine. Walks the steps of a ParsedSkill, dispatching
//! each step to a channel, validating output, emitting Tauri events.
//!
//! Abort/pause are signalled via `Arc<AtomicBool>` flags shared between the
//! spawned executor task and the command handlers (held in
//! [`ExecutionRegistry`] in Tauri managed state). step_loop is parsed but
//! not yet iterated — the executor logs a warning and runs each step once.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::channels::api::ApiChannel;
use crate::channels::bash::BashChannel;
use crate::channels::claude_code::ClaudeCodeChannel;
use crate::channels::{Channel, ChannelInput};
use crate::db::models::ExecutionStep as ExecutionStepRow;
use crate::db::queries;
use crate::orchestrator::skill_parser::{ParsedSkill, SkillStep};
use crate::orchestrator::state::ExecutionState;
use crate::orchestrator::validator::{self, StepResult};
use crate::orchestrator::variable_resolver::{self, ResolveContext};

// ── registry of running executions ──────────────────────────────────────────

#[derive(Clone, Default)]
pub struct ExecutionHandle {
    pub abort: Arc<AtomicBool>,
    pub pause: Arc<AtomicBool>,
}

impl ExecutionHandle {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Cloneable — internal Arc<Mutex<..>> so cloning shares the map. This lets
/// Tauri command handlers clone the State into a spawned task without
/// fighting borrow-checker lifetimes.
#[derive(Clone, Default)]
pub struct ExecutionRegistry {
    inner: Arc<Mutex<HashMap<String, ExecutionHandle>>>,
}

impl ExecutionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register(&self, id: String, handle: ExecutionHandle) {
        self.inner.lock().await.insert(id, handle);
    }

    pub async fn remove(&self, id: &str) {
        self.inner.lock().await.remove(id);
    }

    async fn flag(
        &self,
        id: &str,
        field: impl Fn(&ExecutionHandle) -> &AtomicBool,
        value: bool,
    ) -> Result<(), String> {
        let guard = self.inner.lock().await;
        let handle = guard
            .get(id)
            .ok_or_else(|| format!("execução `{id}` não encontrada"))?;
        field(handle).store(value, Ordering::SeqCst);
        Ok(())
    }

    pub async fn abort(&self, id: &str) -> Result<(), String> {
        self.flag(id, |h| &h.abort, true).await
    }

    pub async fn pause(&self, id: &str) -> Result<(), String> {
        self.flag(id, |h| &h.pause, true).await
    }

    pub async fn resume(&self, id: &str) -> Result<(), String> {
        self.flag(id, |h| &h.pause, false).await
    }
}

// ── event payloads (docs/PRD.md §4) ─────────────────────────────────────────

#[derive(Clone, Serialize)]
struct StepStartedPayload {
    execution_id: String,
    step_id: String,
    tool: String,
}

#[derive(Clone, Serialize)]
struct StepCompletedPayload {
    execution_id: String,
    step_id: String,
    status: String,
    output: String,
}

#[derive(Clone, Serialize)]
struct StepFailedPayload {
    execution_id: String,
    step_id: String,
    error: String,
    retry_count: u32,
}

#[derive(Clone, Serialize)]
struct ExecutionCompletedPayload {
    execution_id: String,
    status: String,
}

#[derive(Clone, Serialize)]
struct LogPayload {
    execution_id: String,
    step_id: String,
    line: String,
}

// ── executor ────────────────────────────────────────────────────────────────

enum OnFailPolicy {
    Abort,
    Retry(u32),
    Continue,
}

fn parse_on_fail(raw: Option<&str>) -> OnFailPolicy {
    match raw.map(str::trim).unwrap_or("") {
        "" | "abort" => OnFailPolicy::Abort,
        "continue" => OnFailPolicy::Continue,
        s if s.starts_with("retry ") => s[6..]
            .trim()
            .parse::<u32>()
            .map(OnFailPolicy::Retry)
            .unwrap_or(OnFailPolicy::Abort),
        _ => OnFailPolicy::Abort,
    }
}

fn channel_for(tool: &str) -> Option<Box<dyn Channel>> {
    match tool {
        "bash" => Some(Box::new(BashChannel::new())),
        "claude-code" => Some(Box::new(ClaudeCodeChannel::new())),
        "api" => Some(Box::new(ApiChannel::new())),
        _ => None,
    }
}

/// Environment variables forwarded to every step's child process. Today this
/// is just `OPENAI_API_KEY` so bash scripts can call the API without the user
/// having to `export` it in their shell. Best-effort: if config load fails or
/// the key is unset, we proceed with an empty env and let the script decide.
fn extra_env_for_step() -> Vec<(String, String)> {
    let mut env = Vec::new();
    if let Ok(cfg) = crate::config::load_config() {
        if let Some(key) = cfg.openai_api_key.filter(|k| !k.is_empty()) {
            env.push(("OPENAI_API_KEY".to_string(), key));
        }
    }
    env
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub struct Executor {
    app: AppHandle,
    pool: SqlitePool,
    handle: ExecutionHandle,
    execution_id: String,
    /// Project cwd — passed to every step unless the step overrides.
    cwd: Option<String>,
}

impl Executor {
    pub fn new(
        app: AppHandle,
        pool: SqlitePool,
        handle: ExecutionHandle,
        execution_id: String,
        cwd: Option<String>,
    ) -> Self {
        Self { app, pool, handle, execution_id, cwd }
    }

    pub async fn run(&self, skill: ParsedSkill, mut ctx: ResolveContext) -> ExecutionState {
        if skill.step_loop.is_some() {
            self.log("", "aviso: step_loop ainda não implementado — steps rodam uma vez".into());
        }

        for (order, step) in skill.steps.iter().enumerate() {
            if self.handle.abort.load(Ordering::SeqCst) {
                return self.finish(ExecutionState::Aborted).await;
            }
            if !self.wait_while_paused().await {
                return self.finish(ExecutionState::Aborted).await;
            }

            let result = self.run_step_with_retry(step, order as i64, &mut ctx).await;
            if matches!(result, StepResult::Failed(_)) {
                match parse_on_fail(step.on_fail.as_deref()) {
                    OnFailPolicy::Continue => continue,
                    _ => return self.finish(ExecutionState::Failed).await,
                }
            }
        }

        self.finish(ExecutionState::Completed).await
    }

    async fn run_step_with_retry(
        &self,
        step: &SkillStep,
        order: i64,
        ctx: &mut ResolveContext,
    ) -> StepResult {
        let max_retries = match parse_on_fail(step.on_fail.as_deref()) {
            OnFailPolicy::Retry(n) => n,
            _ => 0,
        };
        let mut retry_count: u32 = 0;
        loop {
            let outcome = self.run_step_once(step, order, retry_count, ctx).await;
            match outcome {
                StepResult::Success => return StepResult::Success,
                StepResult::Failed(reason) if retry_count >= max_retries => {
                    return StepResult::Failed(reason);
                }
                StepResult::Failed(_) => {
                    retry_count += 1;
                }
            }
        }
    }

    async fn run_step_once(
        &self,
        step: &SkillStep,
        order: i64,
        retry_count: u32,
        ctx: &mut ResolveContext,
    ) -> StepResult {
        let row_id = uuid::Uuid::new_v4().to_string();
        let raw_payload = step
            .command
            .as_deref()
            .or(step.prompt.as_deref())
            .unwrap_or("")
            .to_string();

        // Insert "running" row — trigger will update completed_steps on success.
        let row = ExecutionStepRow {
            id: row_id.clone(),
            execution_id: self.execution_id.clone(),
            step_id: step.id.clone(),
            step_order: order,
            tool: step.tool.clone(),
            status: "running".into(),
            input: raw_payload.clone(),
            output: None,
            error: None,
            retries: retry_count as i64,
            started_at: Some(now_iso()),
            finished_at: None,
            duration_ms: None,
            created_at: now_iso(),
        };
        let _ = queries::insert_step(&self.pool, &row).await;

        // Defensive fallback for empty `tool` — the parser normally
        // rejects a step without one, but a future channel/parse path
        // could leak an empty string. Frontend renderer keys log /
        // status messages off this; "unknown" keeps it grep-able instead
        // of producing a render gap.
        let tool_for_event = if step.tool.is_empty() {
            "unknown".to_string()
        } else {
            step.tool.clone()
        };
        self.emit(
            "execution:step_started",
            &StepStartedPayload {
                execution_id: self.execution_id.clone(),
                step_id: step.id.clone(),
                tool: tool_for_event,
            },
        );

        let resolved = match variable_resolver::resolve(&raw_payload, ctx) {
            Ok(s) => s,
            Err(e) => return self.fail_step(&row_id, &step.id, e.to_string(), retry_count).await,
        };

        let Some(channel) = channel_for(&step.tool) else {
            let msg = format!("tool desconhecido: {}", step.tool);
            return self.fail_step(&row_id, &step.id, msg, retry_count).await;
        };

        let input = ChannelInput {
            command: resolved,
            cwd: self.cwd.clone(),
            // Injeta a OpenAI key no env da subshell bash pra que scripts
            // como legendar.sh encontrem $OPENAI_API_KEY sem o usuário
            // precisar exportar no terminal. A leitura do config
            // respeita a precedência config > env definida em config.rs.
            env: extra_env_for_step(),
            ..Default::default()
        };

        let output = match channel.execute(input).await {
            Ok(o) => o,
            Err(e) => return self.fail_step(&row_id, &step.id, e.to_string(), retry_count).await,
        };

        for line in output.stdout.lines() {
            self.emit(
                "execution:log",
                &LogPayload {
                    execution_id: self.execution_id.clone(),
                    step_id: step.id.clone(),
                    line: line.to_string(),
                },
            );
        }

        match validator::validate(step.validate.as_deref(), &output) {
            StepResult::Success => {
                ctx.set_runtime(format!("{}.output", step.id), output.stdout.clone());
                if let Some(code) = output.exit_code {
                    ctx.set_runtime(format!("{}.exit_code", step.id), code.to_string());
                }
                let _ = queries::update_step_status(
                    &self.pool,
                    &row_id,
                    "success",
                    Some(&output.stdout),
                    None,
                )
                .await;
                // `output.stdout` is always a String (not Option), but
                // it can legitimately be empty when the channel produced
                // no stdout. The TS contract treats `output` as required;
                // emit "" rather than letting the field round-trip
                // through any null path.
                self.emit(
                    "execution:step_completed",
                    &StepCompletedPayload {
                        execution_id: self.execution_id.clone(),
                        step_id: step.id.clone(),
                        status: "success".into(),
                        output: output.stdout,
                    },
                );
                StepResult::Success
            }
            StepResult::Failed(reason) => {
                self.fail_step(&row_id, &step.id, reason.clone(), retry_count)
                    .await
            }
        }
    }

    async fn fail_step(
        &self,
        row_id: &str,
        step_id: &str,
        reason: String,
        retry_count: u32,
    ) -> StepResult {
        // Defensive fallback when a channel surfaces an empty error
        // string — the frontend chains analyze_step_failure on this
        // payload, and an empty `error` would produce a useless GPT
        // prompt ("Erro: (vazio)") and a confusing ❌ bubble.
        let error_for_event = if reason.trim().is_empty() {
            "erro desconhecido".to_string()
        } else {
            reason.clone()
        };
        let _ = queries::update_step_status(
            &self.pool,
            row_id,
            "failed",
            None,
            Some(&reason),
        )
        .await;
        self.emit(
            "execution:step_failed",
            &StepFailedPayload {
                execution_id: self.execution_id.clone(),
                step_id: step_id.to_string(),
                error: error_for_event,
                retry_count,
            },
        );
        StepResult::Failed(reason)
    }

    fn emit<P: Serialize + Clone>(&self, event: &str, payload: &P) {
        let _ = self.app.emit(event, payload.clone());
    }

    fn log(&self, step_id: &str, line: String) {
        self.emit(
            "execution:log",
            &LogPayload {
                execution_id: self.execution_id.clone(),
                step_id: step_id.to_string(),
                line,
            },
        );
    }

    async fn wait_while_paused(&self) -> bool {
        while self.handle.pause.load(Ordering::SeqCst) {
            if self.handle.abort.load(Ordering::SeqCst) {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        true
    }

    async fn finish(&self, state: ExecutionState) -> ExecutionState {
        let status = match state {
            ExecutionState::Completed => "completed",
            ExecutionState::Failed => "failed",
            ExecutionState::Aborted => "aborted",
            _ => "failed",
        };
        let _ = queries::update_execution_status(&self.pool, &self.execution_id, status).await;
        self.emit(
            "execution:completed",
            &ExecutionCompletedPayload {
                execution_id: self.execution_id.clone(),
                status: status.to_string(),
            },
        );
        state
    }
}
