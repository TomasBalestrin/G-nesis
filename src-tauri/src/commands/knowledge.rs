//! Tauri IPC handlers for the personal knowledge base + a "value-only"
//! façade on top of `app_state`.
//!
//! Two flows live here:
//!
//!   * Knowledge files: user uploads markdown describing themselves
//!     (cargo, processos, ferramentas). Each upload triggers a
//!     best-effort summary regeneration via OpenAI; the singleton
//!     `knowledge_summary` row is what the chat surface (future task)
//!     injects into the system prompt.
//!
//!   * App state value helpers: simpler return type
//!     (`Option<String>` / `()`) than the row-based `app_state::*`
//!     commands. Coexist — the row API stays for callers that want
//!     `updated_at`.
//!
//! Persistence is split: file content + summary live in SQLite (so the
//! summary survives reloads without writing to disk), nothing here
//! touches `~/.genesis` outside of the DB.

use sqlx::SqlitePool;
use tauri::State;

use crate::ai::client::OpenAIClient;
use crate::config;
use crate::db::models::{KnowledgeFileMeta, KnowledgeSummary};
use crate::db::queries;

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Build the OpenAI client used by the summarizer. Mirrors `chat::openai_client`
/// so behaviour stays consistent — same precedence (config.toml first,
/// env fallback) and the same user-facing error string when no key is
/// configured.
fn openai_client() -> Result<OpenAIClient, String> {
    let cfg = config::load_config()?;
    let key = cfg.openai_api_key.ok_or_else(|| {
        "OPENAI_API_KEY não configurada. Abra Settings e cole sua key.".to_string()
    })?;
    OpenAIClient::new(key).map_err(|e| e.user_message())
}

/// Reject filenames that would escape `~/.genesis` if they ever reach
/// disk. Today we only persist content into SQLite, but the filename is
/// shown to the user verbatim; restricting to a safe charset keeps the
/// UI consistent and reserves the option to write to disk later.
fn validate_filename(filename: &str) -> Result<(), String> {
    let trimmed = filename.trim();
    if trimmed.is_empty() {
        return Err("filename vazio".into());
    }
    if trimmed.len() > 255 {
        return Err("filename muito longo (>255 chars)".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err(format!("filename inválido: `{trimmed}`"));
    }
    Ok(())
}

/// Concatenate every uploaded file with `=== FILENAME ===` headers and
/// regenerate the singleton summary. Best-effort — failures bubble up so
/// the caller can decide whether to surface or swallow. Empty corpus
/// drops the summary row instead of asking GPT to summarise nothing.
async fn regenerate_summary_inner(pool: &SqlitePool) -> Result<Option<KnowledgeSummary>, String> {
    let contents = queries::get_all_knowledge_contents(pool).await?;
    if contents.is_empty() {
        queries::delete_knowledge_summary(pool).await?;
        return Ok(None);
    }

    let mut concatenated = String::with_capacity(contents.iter().map(|(_, c)| c.len() + 64).sum());
    for (filename, content) in &contents {
        concatenated.push_str("=== ");
        concatenated.push_str(filename);
        concatenated.push_str(" ===\n\n");
        concatenated.push_str(content);
        concatenated.push_str("\n\n");
    }

    let client = openai_client()?;
    let summary = client
        .generate_knowledge_summary(&concatenated)
        .await
        .map_err(|e| e.user_message())?;

    let source_count = contents.len() as i64;
    queries::upsert_knowledge_summary(pool, &summary, source_count).await?;

    queries::get_knowledge_summary(pool).await
}

// ── knowledge_files ─────────────────────────────────────────────────────────

/// Persist a new markdown file and trigger a summary regeneration. The
/// regeneration is best-effort: a failed GPT call (no key, rate-limited,
/// network) is logged to stderr but doesn't fail the upload — the user
/// can retry via `regenerate_knowledge_summary`.
#[tauri::command]
pub async fn upload_knowledge_file(
    filename: String,
    content: String,
    pool: State<'_, SqlitePool>,
) -> Result<KnowledgeFileMeta, String> {
    validate_filename(&filename)?;
    let id = new_id();
    queries::insert_knowledge_file(&pool, &id, filename.trim(), &content).await?;

    if let Err(err) = regenerate_summary_inner(&pool).await {
        eprintln!("[knowledge] upload OK, regen do summary falhou: {err}");
    }

    let files = queries::list_knowledge_files(&pool).await?;
    files
        .into_iter()
        .find(|f| f.id == id)
        .ok_or_else(|| format!("knowledge_file `{id}` desapareceu após upload"))
}

#[tauri::command]
pub async fn list_knowledge_files(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<KnowledgeFileMeta>, String> {
    queries::list_knowledge_files(&pool).await
}

/// Delete a file. If it was the last one, `regenerate_summary_inner`
/// drops the summary row so the chat surface stops injecting stale
/// context into the system prompt.
#[tauri::command]
pub async fn delete_knowledge_file(id: String, pool: State<'_, SqlitePool>) -> Result<(), String> {
    queries::delete_knowledge_file(&pool, &id).await?;

    if let Err(err) = regenerate_summary_inner(&pool).await {
        eprintln!("[knowledge] delete OK, regen do summary falhou: {err}");
    }
    Ok(())
}

// ── knowledge_summary ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_knowledge_summary(
    pool: State<'_, SqlitePool>,
) -> Result<Option<KnowledgeSummary>, String> {
    queries::get_knowledge_summary(&pool).await
}

/// Force a fresh summary from the current corpus. Surfaces errors
/// (missing API key, OpenAI down, etc.) so the UI can show a toast —
/// this is the user-driven retry path that the implicit calls inside
/// upload/delete swallow.
#[tauri::command]
pub async fn regenerate_knowledge_summary(
    pool: State<'_, SqlitePool>,
) -> Result<Option<KnowledgeSummary>, String> {
    regenerate_summary_inner(&pool).await
}

// ── app_state value helpers ─────────────────────────────────────────────────

/// Read just the value column for a key. Lighter than `app_state::get_app_state`
/// (returns the whole row); use this when the UI doesn't care about
/// `updated_at`.
#[tauri::command]
pub async fn get_app_state_value(
    key: String,
    pool: State<'_, SqlitePool>,
) -> Result<Option<String>, String> {
    queries::get_app_state(&pool, &key).await
}

/// UPSERT without echoing the row back. Use `app_state::set_app_state`
/// when you need the post-write `updated_at`.
#[tauri::command]
pub async fn set_app_state_value(
    key: String,
    value: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    queries::set_app_state(&pool, &key, &value).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_filename_accepts_simple() {
        assert!(validate_filename("perfil.md").is_ok());
        assert!(validate_filename("rotinas-2024.md").is_ok());
        assert!(validate_filename("Plano de carreira.md").is_ok());
    }

    #[test]
    fn validate_filename_rejects_traversal_and_separators() {
        assert!(validate_filename("").is_err());
        assert!(validate_filename("   ").is_err());
        assert!(validate_filename("../etc/passwd").is_err());
        assert!(validate_filename("foo/bar.md").is_err());
        assert!(validate_filename("foo\\bar.md").is_err());
        assert!(validate_filename(&"a".repeat(256)).is_err());
    }
}
