//! Tauri IPC handlers for chat messages and OpenAI orchestration.

use crate::db::models::ChatMessage;

#[tauri::command]
pub async fn send_chat_message(
    _content: String,
    _execution_id: Option<String>,
) -> Result<ChatMessage, String> {
    // TODO: persistir mensagem do usuário, chamar OpenAI, persistir resposta
    Err("not implemented".into())
}

#[tauri::command]
pub async fn call_openai(_prompt: String) -> Result<String, String> {
    // TODO: delegar para ai::client::OpenAIClient::chat
    Ok(String::new())
}
