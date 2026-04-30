//! Genesis — desktop skill orchestrator.
//! See docs/architecture.md for module layout.

pub mod ai;
pub mod channels;
pub mod commands;
pub mod config;
pub mod db;
pub mod integrations;
pub mod orchestrator;

use channels::terminal::TerminalRegistry;
use commands::{
    app_state, caminhos, capabilities, chat, config as config_cmd, conversations, dependencies,
    execution, integrations as integrations_cmd, knowledge, projects, skills, workflows,
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
            let cfg = config::load_config().map_err(|e| format!("failed to load config: {e}"))?;
            if cfg.needs_setup {
                eprintln!("[genesis] OPENAI_API_KEY not set — frontend should show setup screen");
            }
            app.manage(cfg);

            // ~/.genesis/integrations/ existe a partir do boot, antes que
            // qualquer add_integration tente escrever spec lá. Idempotente.
            integrations::ensure_specs_dir()
                .map_err(|e| format!("failed to ensure integrations dir: {e}"))?;

            let pool = tauri::async_runtime::block_on(db::init_db())
                .map_err(|e| format!("failed to initialize database: {e}"))?;
            app.manage(pool);

            app.manage(ExecutionRegistry::new());
            app.manage(TerminalRegistry::new());

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
            // projects::list_projects / create_project / delete_project
            // foram aposentados em H1 — todo o surface migrou pra
            // caminhos::*. get_execution_history e get_execution_detail
            // permanecem porque CaminhoDetail consulta o histórico
            // by project_id (schema DB ainda usa projects table).
            caminhos::list_caminhos,
            caminhos::create_caminho,
            caminhos::delete_caminho,
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
            chat::insert_execution_status_message,
            chat::analyze_step_failure,
            chat::save_skill_folder,
            // capabilities (unified @-mention registry — read-only paths)
            capabilities::list_capabilities,
            capabilities::get_capability,
            capabilities::list_capabilities_by_type,
            // integrations (REST APIs invocadas via @<name>; api_key
            // mora só no config.toml — nunca cruza o IPC boundary).
            integrations_cmd::list_integrations,
            integrations_cmd::add_integration,
            integrations_cmd::update_integration,
            integrations_cmd::remove_integration,
            integrations_cmd::test_integration,
            integrations_cmd::call_integration,
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
            // knowledge base (uploads + summarizer + value-only app_state helpers)
            knowledge::upload_knowledge_file,
            knowledge::list_knowledge_files,
            knowledge::delete_knowledge_file,
            knowledge::get_knowledge_summary,
            knowledge::regenerate_knowledge_summary,
            knowledge::get_app_state_value,
            knowledge::set_app_state_value,
            // workflows
            workflows::list_workflows,
            workflows::read_workflow,
            workflows::save_workflow,
            workflows::delete_workflow,
            workflows::parse_workflow,
            workflows::execute_workflow,
            workflows::abort_workflow,
            // terminal (PTY)
            channels::terminal::terminal_spawn,
            channels::terminal::terminal_write,
            channels::terminal::terminal_resize,
            channels::terminal::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
