//! Tauri IPC handlers for "caminhos" — user-facing alias for projects.
//!
//! Genesis is renaming the product surface from "project" to "caminho"
//! (Portuguese: "path") since users think of these rows as folder
//! bookmarks more than software projects. This module exposes the
//! renamed commands; the legacy `projects::*` handlers stay live so
//! existing frontend code keeps working during the migration.
//!
//! Implementation talks straight to `db::queries` — no delegation to
//! the legacy commands. Keeps caminhos.rs self-contained so projects.rs
//! can be retired without follow-up edits here.

use std::path::Path;

use sqlx::SqlitePool;
use tauri::State;

use crate::db::models::{Caminho, Project};
use crate::db::queries;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub async fn list_caminhos(pool: State<'_, SqlitePool>) -> Result<Vec<Caminho>, String> {
    queries::list_projects(&pool).await
}

/// Validate + canonicalize the path so duplicates via different relative
/// forms collide on the `repo_path UNIQUE` constraint instead of producing
/// twin rows. Mirrors the legacy `projects::create_project` validation —
/// kept inline (not delegated) so this module stands alone.
#[tauri::command]
pub async fn create_caminho(
    name: String,
    repo_path: String,
    pool: State<'_, SqlitePool>,
) -> Result<Caminho, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("nome do caminho vazio".into());
    }

    let path = Path::new(&repo_path);
    if !path.exists() {
        return Err(format!("caminho não encontrado: {repo_path}"));
    }
    if !path.is_dir() {
        return Err(format!("caminho não é um diretório: {repo_path}"));
    }

    let canonical = path
        .canonicalize()
        .map_err(|e| format!("falha ao resolver {repo_path}: {e}"))?
        .to_string_lossy()
        .into_owned();

    let now = now_iso();
    let caminho = Project {
        id: new_id(),
        name: trimmed_name.to_string(),
        repo_path: canonical,
        created_at: now.clone(),
        updated_at: now,
    };
    queries::insert_project(&pool, &caminho).await?;
    Ok(caminho)
}

#[tauri::command]
pub async fn delete_caminho(id: String, pool: State<'_, SqlitePool>) -> Result<(), String> {
    queries::delete_project(&pool, &id).await
}
