//! Genesis — desktop skill orchestrator.
//! See docs/architecture.md for module layout.

pub mod ai;
pub mod channels;
pub mod commands;
pub mod config;
pub mod db;
pub mod orchestrator;

use commands::{chat, execution, projects, skills};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let pool = tauri::async_runtime::block_on(db::init_db())
                .map_err(|e| format!("failed to initialize database: {e}"))?;
            app.manage(pool);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // skills
            skills::list_skills,
            skills::read_skill,
            skills::save_skill,
            skills::parse_skill,
            // projects
            projects::list_projects,
            projects::create_project,
            projects::delete_project,
            // execution
            execution::execute_skill,
            execution::abort,
            execution::pause,
            execution::resume,
            // chat
            chat::send_chat_message,
            chat::call_openai,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
