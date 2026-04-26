//! Tauri IPC handlers for skill execution control.
//!
//! `execute_skill` is fire-and-forget from the frontend's perspective: it
//! resolves the project (either the explicit `project_id` arg or the
//! persisted `active_project_id` from app_state), parses the skill, inserts
//! the execution row, then spawns a Tokio task that drives the Executor and
//! returns the new `execution_id` immediately. Progress and terminal status
//! flow via events (`execution:step_*`, `execution:completed`).
//!
//! `abort`/`pause`/`resume` flip atomic flags stored in `ExecutionRegistry`.

use std::fs;
use std::path::PathBuf;

use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::config;
use crate::db::models::Execution;
use crate::db::queries;
use crate::orchestrator::skill_parser::{self, ParsedSkill};
use crate::orchestrator::variable_resolver::ResolveContext;
use crate::orchestrator::{ExecutionHandle, ExecutionRegistry, Executor};

const ACTIVE_PROJECT_KEY: &str = "active_project_id";

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn read_skill_content(name: &str) -> Result<String, String> {
    let cfg = config::load_config()?;
    let dir = PathBuf::from(cfg.skills_dir);
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("nome de skill inválido: `{name}`"));
    }
    let path = if name.ends_with(".md") {
        dir.join(name)
    } else {
        dir.join(format!("{name}.md"))
    };
    fs::read_to_string(&path).map_err(|e| format!("falha ao ler skill `{name}`: {e}"))
}

/// Resolve a project: explicit id wins; empty/None falls back to the
/// persisted `app_state.active_project_id`. Returns a clear error when
/// neither path yields a usable id — the orchestrator can't run a skill
/// without a working directory.
async fn resolve_project_id(
    pool: &SqlitePool,
    explicit: Option<String>,
) -> Result<String, String> {
    if let Some(id) = explicit.filter(|s| !s.is_empty()) {
        return Ok(id);
    }
    let row = queries::get_state(pool, ACTIVE_PROJECT_KEY).await?;
    let id = row.map(|s| s.value).unwrap_or_default();
    if id.is_empty() {
        return Err(
            "Nenhum projeto selecionado. Escolha um projeto no rodapé do chat \
             ou cadastre um em Settings."
                .to_string(),
        );
    }
    Ok(id)
}

#[tauri::command]
pub async fn execute_skill(
    skill_name: String,
    project_id: Option<String>,
    pool: State<'_, SqlitePool>,
    registry: State<'_, ExecutionRegistry>,
    app: AppHandle,
) -> Result<String, String> {
    let resolved_id = resolve_project_id(&pool, project_id).await?;

    let project = queries::get_project(&pool, &resolved_id)
        .await?
        .ok_or_else(|| format!("projeto `{resolved_id}` não encontrado"))?;

    let content = read_skill_content(&skill_name)?;
    let skill: ParsedSkill = skill_parser::parse_skill(&content)?;

    let execution_id = new_id();
    let execution = Execution {
        id: execution_id.clone(),
        project_id: project.id.clone(),
        skill_name: skill_name.clone(),
        status: "running".into(),
        started_at: Some(now_iso()),
        finished_at: None,
        total_steps: skill.steps.len() as i64,
        completed_steps: 0,
        created_at: now_iso(),
    };
    queries::insert_execution(&pool, &execution).await?;

    let handle = ExecutionHandle::new();
    registry.register(execution_id.clone(), handle.clone()).await;

    let pool_owned = pool.inner().clone();
    let registry_owned = registry.inner().clone(); // State<_> derefs to the inner; Arc/managed

    let exec_id_for_task = execution_id.clone();
    let app_for_task = app.clone();
    let cwd = Some(project.repo_path.clone());

    // Pre-seed the resolver with project metadata. Skills that reference
    // {{repo_path}} / {{project_name}} / {{project_id}} get them populated
    // automatically without the user having to declare them as inputs.
    let ctx = ResolveContext::new().with_project(
        project.repo_path.clone(),
        project.name.clone(),
        project.id.clone(),
    );

    tauri::async_runtime::spawn(async move {
        let executor = Executor::new(
            app_for_task,
            pool_owned,
            handle,
            exec_id_for_task.clone(),
            cwd,
        );
        let _final_state = executor.run(skill, ctx).await;
        registry_owned.remove(&exec_id_for_task).await;
    });

    Ok(execution_id)
}

#[tauri::command]
pub async fn abort(
    execution_id: String,
    registry: State<'_, ExecutionRegistry>,
) -> Result<(), String> {
    registry.abort(&execution_id).await
}

#[tauri::command]
pub async fn pause(
    execution_id: String,
    registry: State<'_, ExecutionRegistry>,
) -> Result<(), String> {
    registry.pause(&execution_id).await
}

#[tauri::command]
pub async fn resume(
    execution_id: String,
    registry: State<'_, ExecutionRegistry>,
) -> Result<(), String> {
    registry.resume(&execution_id).await
}
