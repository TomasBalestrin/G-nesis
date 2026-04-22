//! Tauri IPC handlers for chat messages and OpenAI orchestration.

use sqlx::SqlitePool;
use tauri::State;

use crate::ai::client::{Message, OpenAIClient};
use crate::ai::prompts::ORCHESTRATOR_SYSTEM_PROMPT;
use crate::config;
use crate::db::models::ChatMessage;
use crate::db::queries;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn openai_client() -> Result<OpenAIClient, String> {
    // Load fresh so a key change via save_config is picked up on the next
    // message without restarting the app.
    let cfg = config::load_config()?;
    let key = cfg
        .openai_api_key
        .ok_or_else(|| "OPENAI_API_KEY não configurada. Abra Settings e cole sua key.".to_string())?;
    OpenAIClient::new(key).map_err(|e| e.user_message())
}

/// Persist the user's message, call GPT-4o with the full history for this
/// execution (or the general thread when `execution_id` is None), persist the
/// assistant reply, and return it.
#[tauri::command]
pub async fn send_chat_message(
    content: String,
    execution_id: Option<String>,
    pool: State<'_, SqlitePool>,
) -> Result<ChatMessage, String> {
    let user_msg = ChatMessage {
        id: new_id(),
        execution_id: execution_id.clone(),
        role: "user".to_string(),
        content,
        created_at: now_iso(),
    };
    queries::insert_message(&pool, &user_msg).await?;

    let history = queries::list_messages(&pool, execution_id.as_deref()).await?;
    let messages: Vec<Message> = history
        .iter()
        .map(|m| Message {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect();

    let client = openai_client()?;
    let reply = client
        .chat_completion(ORCHESTRATOR_SYSTEM_PROMPT, &messages)
        .await
        .map_err(|e| e.user_message())?;

    let assistant_msg = ChatMessage {
        id: new_id(),
        execution_id,
        role: "assistant".to_string(),
        content: reply,
        created_at: now_iso(),
    };
    queries::insert_message(&pool, &assistant_msg).await?;

    Ok(assistant_msg)
}

/// Low-level passthrough for internal uses (skill selection, validation).
/// Does not persist to the chat history.
#[tauri::command]
pub async fn call_openai(prompt: String) -> Result<String, String> {
    let client = openai_client()?;
    let messages = vec![Message {
        role: "user".to_string(),
        content: prompt,
    }];
    client
        .chat_completion("", &messages)
        .await
        .map_err(|e| e.user_message())
}
