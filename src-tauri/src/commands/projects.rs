//! Tauri IPC handlers for project CRUD.

use crate::db::models::Project;

#[tauri::command]
pub async fn list_projects() -> Result<Vec<Project>, String> {
    // TODO: delegar para db::queries::list_projects
    Ok(Vec::new())
}

#[tauri::command]
pub async fn create_project(_name: String, _repo_path: String) -> Result<Project, String> {
    // TODO: validar repo_path, gerar uuid, persistir via db::queries::insert_project
    Err("not implemented".into())
}

#[tauri::command]
pub async fn delete_project(_id: String) -> Result<(), String> {
    // TODO: delegar para db::queries::delete_project (CASCADE limpa executions/steps)
    Ok(())
}
