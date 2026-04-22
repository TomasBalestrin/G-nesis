//! CRUD queries for the SQLite database.
//! Populated in later tasks — keep SQL inline here (not in `commands/`).

use crate::db::models::{ChatMessage, Execution, ExecutionStep, Project};

pub async fn list_projects() -> Result<Vec<Project>, String> {
    Ok(Vec::new())
}

pub async fn insert_project(_project: &Project) -> Result<(), String> {
    Ok(())
}

pub async fn delete_project(_id: &str) -> Result<(), String> {
    Ok(())
}

pub async fn insert_execution(_execution: &Execution) -> Result<(), String> {
    Ok(())
}

pub async fn update_execution_status(_id: &str, _status: &str) -> Result<(), String> {
    Ok(())
}

pub async fn insert_step(_step: &ExecutionStep) -> Result<(), String> {
    Ok(())
}

pub async fn insert_message(_message: &ChatMessage) -> Result<(), String> {
    Ok(())
}
