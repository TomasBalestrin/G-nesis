//! Tauri IPC handlers for configuration (API key + paths).

use crate::config::{self, Config};

#[tauri::command]
pub async fn get_config() -> Result<Config, String> {
    config::load_config()
}

#[tauri::command]
pub async fn save_config(
    openai_api_key: Option<String>,
    skills_dir: String,
) -> Result<Config, String> {
    config::save_config(openai_api_key, skills_dir)
}
