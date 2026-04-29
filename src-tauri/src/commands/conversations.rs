//! Tauri IPC handlers for multi-thread chat — CRUD over the `conversations`
//! table. Messages themselves move through `commands::chat::send_chat_message`
//! with a `conversation_id` parameter.

use sqlx::SqlitePool;
use tauri::State;

use crate::db::models::Conversation;
use crate::db::queries;

const DEFAULT_TITLE: &str = "Nova conversa";
const MAX_TITLE_LEN: usize = 80;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn normalize_title(raw: Option<String>) -> String {
    let trimmed = raw.unwrap_or_default().trim().to_string();
    if trimmed.is_empty() {
        DEFAULT_TITLE.to_string()
    } else if trimmed.chars().count() > MAX_TITLE_LEN {
        let cut: String = trimmed.chars().take(MAX_TITLE_LEN - 1).collect();
        format!("{cut}…")
    } else {
        trimmed
    }
}

#[tauri::command]
pub async fn list_conversations(pool: State<'_, SqlitePool>) -> Result<Vec<Conversation>, String> {
    queries::list_conversations(&pool).await
}

#[tauri::command]
pub async fn create_conversation(
    title: Option<String>,
    pool: State<'_, SqlitePool>,
) -> Result<Conversation, String> {
    let now = now_iso();
    let conversation = Conversation {
        id: new_id(),
        title: normalize_title(title),
        created_at: now.clone(),
        updated_at: now,
    };
    queries::insert_conversation(&pool, &conversation).await?;
    Ok(conversation)
}

#[tauri::command]
pub async fn delete_conversation(id: String, pool: State<'_, SqlitePool>) -> Result<(), String> {
    queries::delete_conversation(&pool, &id).await
}

#[tauri::command]
pub async fn rename_conversation(
    id: String,
    title: String,
    pool: State<'_, SqlitePool>,
) -> Result<Conversation, String> {
    let normalized = normalize_title(Some(title));
    queries::rename_conversation(&pool, &id, &normalized).await?;
    queries::get_conversation(&pool, &id)
        .await?
        .ok_or_else(|| format!("conversa `{id}` não encontrada"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_title_defaults_when_empty() {
        assert_eq!(normalize_title(None), DEFAULT_TITLE);
        assert_eq!(normalize_title(Some("   ".into())), DEFAULT_TITLE);
        assert_eq!(normalize_title(Some("".into())), DEFAULT_TITLE);
    }

    #[test]
    fn normalize_title_trims() {
        assert_eq!(normalize_title(Some("  olá  ".into())), "olá");
    }

    #[test]
    fn normalize_title_truncates_long_input() {
        let long: String = "a".repeat(200);
        let title = normalize_title(Some(long));
        assert_eq!(title.chars().count(), MAX_TITLE_LEN);
        assert!(title.ends_with('…'));
    }
}
