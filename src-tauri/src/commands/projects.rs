//! Tauri IPC handlers for project CRUD and execution history.
//!
//! `create_project` validates the `repo_path` (must exist as a directory) and
//! canonicalizes it so two projects pointing at the same folder via different
//! relative paths still conflict against the `repo_path UNIQUE` constraint
//! (docs/schema.md §2.1).

use std::path::Path;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::State;

use crate::db::models::{Execution, ExecutionStep, Project};
use crate::db::queries;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Bundle returned by `get_execution_detail` — execution header + its steps
/// in execution order. Mirrors `ExecutionDetail` referenced in docs/PRD.md §4.
#[derive(Debug, Serialize, Deserialize)]
pub struct ExecutionDetail {
    pub execution: Execution,
    pub steps: Vec<ExecutionStep>,
}

#[tauri::command]
pub async fn list_projects(pool: State<'_, SqlitePool>) -> Result<Vec<Project>, String> {
    queries::list_projects(&pool).await
}

#[tauri::command]
pub async fn create_project(
    name: String,
    repo_path: String,
    pool: State<'_, SqlitePool>,
) -> Result<Project, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("nome do projeto vazio".into());
    }

    let path = Path::new(&repo_path);
    if !path.exists() {
        return Err(format!("caminho não encontrado: {repo_path}"));
    }
    if !path.is_dir() {
        return Err(format!("caminho não é um diretório: {repo_path}"));
    }

    // Canonicalize so duplicates via different relative paths hit the UNIQUE
    // constraint on repo_path instead of silently creating two rows.
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("falha ao resolver {repo_path}: {e}"))?
        .to_string_lossy()
        .into_owned();

    let now = now_iso();
    let project = Project {
        id: new_id(),
        name: trimmed_name.to_string(),
        repo_path: canonical,
        created_at: now.clone(),
        updated_at: now,
    };
    queries::insert_project(&pool, &project).await?;
    Ok(project)
}

#[tauri::command]
pub async fn delete_project(id: String, pool: State<'_, SqlitePool>) -> Result<(), String> {
    queries::delete_project(&pool, &id).await
}

#[tauri::command]
pub async fn get_execution_history(
    project_id: String,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<Execution>, String> {
    queries::list_executions_for_project(&pool, &project_id).await
}

#[tauri::command]
pub async fn get_execution_detail(
    execution_id: String,
    pool: State<'_, SqlitePool>,
) -> Result<ExecutionDetail, String> {
    let execution = queries::get_execution(&pool, &execution_id)
        .await?
        .ok_or_else(|| format!("execução `{execution_id}` não encontrada"))?;
    let steps = queries::list_steps_for_execution(&pool, &execution_id).await?;
    Ok(ExecutionDetail { execution, steps })
}
