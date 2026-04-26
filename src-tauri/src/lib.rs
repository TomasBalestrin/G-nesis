//! Genesis — desktop skill orchestrator.
//! See docs/architecture.md for module layout.

pub mod ai;
pub mod channels;
pub mod commands;
pub mod config;
pub mod db;
pub mod orchestrator;

use commands::{
    app_state, chat, config as config_cmd, conversations, dependencies, execution, projects,
    skills,
};
use orchestrator::ExecutionRegistry;
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
            let cfg = config::load_config()
                .map_err(|e| format!("failed to load config: {e}"))?;
            if cfg.needs_setup {
                eprintln!(
                    "[genesis] OPENAI_API_KEY not set — frontend should show setup screen"
                );
            }
            app.manage(cfg);

            let pool = tauri::async_runtime::block_on(db::init_db())
                .map_err(|e| format!("failed to initialize database: {e}"))?;
            app.manage(pool);

            app.manage(ExecutionRegistry::new());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // config
            config_cmd::get_config,
            config_cmd::save_config,
            // skills
            skills::list_skills,
            skills::read_skill,
            skills::save_skill,
            skills::delete_skill,
            skills::parse_skill,
            // projects
            projects::list_projects,
            projects::create_project,
            projects::delete_project,
            projects::get_execution_history,
            projects::get_execution_detail,
            // execution
            execution::execute_skill,
            execution::abort,
            execution::pause,
            execution::resume,
            // chat
            chat::send_chat_message,
            chat::call_openai,
            chat::list_messages_by_conversation,
            // conversations
            conversations::list_conversations,
            conversations::create_conversation,
            conversations::delete_conversation,
            conversations::rename_conversation,
            // dependencies
            dependencies::check_dependency,
            dependencies::install_dependency,
            // app_state (UI cross-session state)
            app_state::get_app_state,
            app_state::set_app_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
