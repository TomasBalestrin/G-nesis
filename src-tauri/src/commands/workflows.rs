//! Tauri IPC handlers for workflow management.
//!
//! Workflows live under `config.workflows_dir` as `.md` files. The DB row
//! in `workflows` is an index + cached metadata; `file_path` points back
//! to the `.md` for the parser.
//!
//! Path handling mirrors `commands/skills.rs`: defensive, no separators,
//! no `..`. Names are validated up-front so file ops never escape the
//! configured directory.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, State};

use crate::config;
use crate::db::queries;
use crate::orchestrator::variable_resolver::ResolveContext;
use crate::orchestrator::workflow_executor::WorkflowExecutor;
use crate::orchestrator::workflow_parser::{self, ParsedWorkflow, WorkflowMeta};
use crate::orchestrator::{ExecutionHandle, ExecutionRegistry};

/// Lightweight summary returned by `list_workflows` — name + description
/// + version pulled from the parsed frontmatter. Avoids re-parsing the
/// full body when the UI only needs a sidebar list.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSummary {
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub triggers: Vec<String>,
}

impl From<WorkflowMeta> for WorkflowSummary {
    fn from(m: WorkflowMeta) -> Self {
        Self {
            name: m.name,
            description: m.description,
            version: m.version,
            author: m.author,
            triggers: m.triggers,
        }
    }
}

fn workflows_dir() -> Result<PathBuf, String> {
    let cfg = config::load_config()?;
    Ok(PathBuf::from(cfg.workflows_dir))
}

fn workflow_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() {
        return Err("nome do workflow vazio".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("nome de workflow inválido: `{name}`"));
    }
    let file_name = if name.ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    };
    Ok(dir.join(file_name))
}

#[tauri::command]
pub async fn list_workflows() -> Result<Vec<WorkflowSummary>, String> {
    let dir = workflows_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("falha ao ler workflows_dir {}: {e}", dir.display()))?;

    let mut summaries: Vec<WorkflowSummary> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            match fs::read_to_string(&path) {
                Ok(content) => match workflow_parser::parse_workflow(&content) {
                    Ok(wf) => summaries.push(wf.meta.into()),
                    Err(err) => {
                        eprintln!("[workflows] pulando {} ao listar: {err}", path.display())
                    }
                },
                Err(err) => eprintln!("[workflows] falha ao ler {}: {err}", path.display()),
            }
        }
    }
    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(summaries)
}

#[tauri::command]
pub async fn read_workflow(name: String) -> Result<String, String> {
    let dir = workflows_dir()?;
    let path = workflow_path(&dir, &name)?;
    fs::read_to_string(&path).map_err(|e| format!("falha ao ler workflow `{name}`: {e}"))
}

#[tauri::command]
pub async fn save_workflow(name: String, content: String) -> Result<(), String> {
    let dir = workflows_dir()?;
    let path = workflow_path(&dir, &name)?;

    // Reject malformed files at the boundary — broken workflows shouldn't
    // hit disk. Same policy save_skill_file follows pra SKILL.md.
    workflow_parser::parse_workflow(&content).map_err(|e| format!("workflow inválido: {e}"))?;

    fs::create_dir_all(&dir).map_err(|e| format!("falha ao criar {}: {e}", dir.display()))?;
    fs::write(&path, content).map_err(|e| format!("falha ao salvar workflow `{name}`: {e}"))
}

#[tauri::command]
pub async fn delete_workflow(name: String) -> Result<(), String> {
    let dir = workflows_dir()?;
    let path = workflow_path(&dir, &name)?;
    if !path.exists() {
        return Err(format!("workflow `{name}` não encontrado"));
    }
    fs::remove_file(&path).map_err(|e| format!("falha ao deletar workflow `{name}`: {e}"))
}

#[tauri::command]
pub async fn parse_workflow(name: String) -> Result<ParsedWorkflow, String> {
    let dir = workflows_dir()?;
    let path = workflow_path(&dir, &name)?;
    let content =
        fs::read_to_string(&path).map_err(|e| format!("falha ao ler workflow `{name}`: {e}"))?;
    workflow_parser::parse_workflow(&content)
}

/// Fire-and-forget execution. Parses the workflow, resolves the project
/// (explicit `project_id` wins; falls back to `app_state.active_project_id`
/// — same precedence as `execute_skill`), spawns a Tokio task that drives
/// the WorkflowExecutor, and returns the new `workflow_execution_id`.
/// Progress flows via `workflow:*` events.
#[tauri::command]
pub async fn execute_workflow(
    workflow_name: String,
    project_id: Option<String>,
    pool: State<'_, SqlitePool>,
    registry: State<'_, ExecutionRegistry>,
    app: AppHandle,
) -> Result<String, String> {
    let resolved_id = resolve_project_id(&pool, project_id).await?;
    let project = queries::get_project(&pool, &resolved_id)
        .await?
        .ok_or_else(|| format!("projeto `{resolved_id}` não encontrado"))?;

    let dir = workflows_dir()?;
    let path = workflow_path(&dir, &workflow_name)?;
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("falha ao ler workflow `{workflow_name}`: {e}"))?;
    let workflow = workflow_parser::parse_workflow(&content)?;

    let workflow_execution_id = uuid::Uuid::new_v4().to_string();

    let handle = ExecutionHandle::new();
    registry
        .register(workflow_execution_id.clone(), handle.clone())
        .await;

    let pool_owned = pool.inner().clone();
    let registry_owned = registry.inner().clone();
    let app_for_task = app.clone();
    let cwd = Some(project.repo_path.clone());

    let ctx = ResolveContext::new().with_project(
        project.repo_path.clone(),
        project.name.clone(),
        project.id.clone(),
    );

    let exec_id_for_task = workflow_execution_id.clone();
    tauri::async_runtime::spawn(async move {
        let executor = WorkflowExecutor::new(
            app_for_task,
            pool_owned,
            registry_owned.clone(),
            handle,
            exec_id_for_task.clone(),
            project.id.clone(),
            cwd,
        );
        let _final_state = executor.run(workflow, ctx).await;
        registry_owned.remove(&exec_id_for_task).await;
    });

    Ok(workflow_execution_id)
}

#[tauri::command]
pub async fn abort_workflow(
    workflow_execution_id: String,
    registry: State<'_, ExecutionRegistry>,
) -> Result<(), String> {
    registry.abort(&workflow_execution_id).await
}

// ── helpers ────────────────────────────────────────────────────────────────

const ACTIVE_PROJECT_KEY: &str = "active_project_id";

async fn resolve_project_id(pool: &SqlitePool, explicit: Option<String>) -> Result<String, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal() {
        let dir = Path::new("/tmp/wf");
        assert!(workflow_path(dir, "../etc/passwd").is_err());
        assert!(workflow_path(dir, "foo/bar").is_err());
        assert!(workflow_path(dir, "foo\\bar").is_err());
        assert!(workflow_path(dir, "").is_err());
    }

    #[test]
    fn appends_md_extension_when_missing() {
        let dir = Path::new("/tmp/wf");
        assert_eq!(
            workflow_path(dir, "deploy").unwrap(),
            PathBuf::from("/tmp/wf/deploy.md"),
        );
        assert_eq!(
            workflow_path(dir, "deploy.md").unwrap(),
            PathBuf::from("/tmp/wf/deploy.md"),
        );
    }
}
