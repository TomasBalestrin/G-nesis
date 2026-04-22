//! Tauri IPC handlers for skill execution control.

#[tauri::command]
pub async fn execute_skill(
    _skill_name: String,
    _project_id: String,
) -> Result<String, String> {
    // TODO: criar Execution, inicializar Executor, dispatch async, retornar execution_id
    Err("not implemented".into())
}

#[tauri::command]
pub async fn abort(_execution_id: String) -> Result<(), String> {
    // TODO: sinalizar Executor para abortar
    Ok(())
}

#[tauri::command]
pub async fn pause(_execution_id: String) -> Result<(), String> {
    // TODO: sinalizar Executor para pausar
    Ok(())
}

#[tauri::command]
pub async fn resume(_execution_id: String) -> Result<(), String> {
    // TODO: sinalizar Executor para retomar
    Ok(())
}
