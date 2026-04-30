//! SQLite persistence layer.
//!
//! Holds the connection pool and runs the schema migrations on startup.
//! Migrations are idempotent (CREATE TABLE / TRIGGER / INDEX with
//! `IF NOT EXISTS`), but since SQLite does NOT support
//! `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, column additions are guarded
//! manually with a `pragma_table_info` check.
//!
//! Pragmas (WAL, foreign_keys, busy_timeout) are set declaratively on the
//! connection options — sqlx applies them to every connection in the pool.

pub mod models;
pub mod queries;

use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Executor, Row, SqlitePool};

pub type DbPool = SqlitePool;

const MIGRATION_001: &str = include_str!("../../migrations/001_init.sql");
const MIGRATION_002: &str = include_str!("../../migrations/002_conversations.sql");
const MIGRATION_003: &str = include_str!("../../migrations/003_app_state.sql");
const MIGRATION_005: &str = include_str!("../../migrations/005_workflows.sql");
const MIGRATION_006: &str = include_str!("../../migrations/006_knowledge.sql");
const MIGRATION_007: &str = include_str!("../../migrations/007_capabilities.sql");
const MIGRATION_008: &str = include_str!("../../migrations/008_integrations.sql");

pub fn db_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".genesis").join("genesis.db")
}

pub async fn init_db() -> Result<DbPool, String> {
    let path = db_path();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create {}: {e}", parent.display()))?;
    }

    let url = format!("sqlite:{}", path.display());
    let opts = SqliteConnectOptions::from_str(&url)
        .map_err(|e| format!("invalid sqlite url {url}: {e}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(opts)
        .await
        .map_err(|e| format!("failed to open {}: {e}", path.display()))?;

    run_migrations(&pool).await?;
    Ok(pool)
}

async fn run_migrations(pool: &DbPool) -> Result<(), String> {
    // 001 — core schema (projects, executions, steps, chat_messages).
    pool.execute(MIGRATION_001)
        .await
        .map_err(|e| format!("migration 001 failed: {e}"))?;

    // Add chat_messages.conversation_id column if missing. Must run before
    // 002 (which creates an index on that column).
    ensure_chat_messages_conversation_id(pool).await?;

    // 002 — conversations table + indices.
    pool.execute(MIGRATION_002)
        .await
        .map_err(|e| format!("migration 002 failed: {e}"))?;

    // 003 — app_state key/value store + default seeds.
    pool.execute(MIGRATION_003)
        .await
        .map_err(|e| format!("migration 003 failed: {e}"))?;

    // 004 — extended-thinking columns on chat_messages. ADD COLUMN is
    // idempotent via pragma_table_info guard (SQLite has no IF NOT EXISTS).
    ensure_chat_messages_thinking(pool).await?;

    // 005 — workflows table. The .md file under ~/.genesis/workflows/
    // remains source-of-truth; the row is an index + cached metadata.
    pool.execute(MIGRATION_005)
        .await
        .map_err(|e| format!("migration 005 failed: {e}"))?;

    // 006 — knowledge base (knowledge_files + singleton knowledge_summary).
    // app_state is also re-created via IF NOT EXISTS so the schema is
    // self-contained on fresh installs.
    pool.execute(MIGRATION_006)
        .await
        .map_err(|e| format!("migration 006 failed: {e}"))?;

    // Inline execution-status flow: chat_messages.kind discriminates
    // regular text bubbles from execution status entries; executions.
    // conversation_id pins the audit trail to the chat thread that
    // started the run so status messages route back to the right
    // conversation. Both are inline ALTER TABLE — same guard pattern
    // as the thinking columns above. Not numbered as a migration file
    // because they're column tweaks, not a schema unit.
    ensure_chat_messages_kind(pool).await?;
    ensure_executions_conversation_id(pool).await?;

    // 007 — capabilities table (unified registry of @-mentions: native
    // tools shipped with the app + future connector integrations).
    // Idempotent CREATE TABLE + INSERT OR IGNORE so re-runs don't
    // clobber user edits to the seeded native rows.
    pool.execute(MIGRATION_007)
        .await
        .map_err(|e| format!("migration 007 failed: {e}"))?;

    // 008 — integrations table. Index relacional dos REST APIs que o
    // chat acessa via @<name>. Auth payload + api_key continuam no
    // config.toml; esta tabela é só metadata pra listagem rápida.
    pool.execute(MIGRATION_008)
        .await
        .map_err(|e| format!("migration 008 failed: {e}"))?;

    // Inline ALTER: conversations.active_integration mantém a última
    // integração @<name> que o usuário invocou nessa thread. Permite
    // turnos seguintes herdarem o contexto sem precisar do prefixo
    // @ a cada mensagem. Mesmo guard pattern dos outros ensure_*.
    ensure_conversations_active_integration(pool).await?;

    Ok(())
}

/// SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so we
/// inspect `pragma_table_info` and only run the ALTER when the column is
/// missing. Safe to re-run on an already-migrated DB.
async fn ensure_chat_messages_conversation_id(pool: &DbPool) -> Result<(), String> {
    let rows = sqlx::query("SELECT name FROM pragma_table_info('chat_messages')")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("pragma table_info failed: {e}"))?;

    let has_column = rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .any(|name| name == "conversation_id");

    if has_column {
        return Ok(());
    }

    sqlx::query(
        "ALTER TABLE chat_messages \
         ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("failed to add conversation_id column: {e}"))?;
    Ok(())
}

/// Adds the `thinking` and `thinking_summary` columns to `chat_messages`
/// when they're absent. Same guard pattern as the conversation_id ALTER —
/// SQLite's lack of `ADD COLUMN IF NOT EXISTS` means we have to introspect.
async fn ensure_chat_messages_thinking(pool: &DbPool) -> Result<(), String> {
    let rows = sqlx::query("SELECT name FROM pragma_table_info('chat_messages')")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("pragma table_info failed: {e}"))?;

    let names: Vec<String> = rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .collect();

    if !names.iter().any(|n| n == "thinking") {
        sqlx::query("ALTER TABLE chat_messages ADD COLUMN thinking TEXT")
            .execute(pool)
            .await
            .map_err(|e| format!("failed to add thinking column: {e}"))?;
    }

    if !names.iter().any(|n| n == "thinking_summary") {
        sqlx::query("ALTER TABLE chat_messages ADD COLUMN thinking_summary TEXT")
            .execute(pool)
            .await
            .map_err(|e| format!("failed to add thinking_summary column: {e}"))?;
    }

    Ok(())
}

/// Adds `chat_messages.kind` (default `'text'`) so the renderer can
/// branch between regular text bubbles and inline execution status
/// entries (`'execution-status'`). Default backfills existing rows so
/// FromRow always sees a populated column.
async fn ensure_chat_messages_kind(pool: &DbPool) -> Result<(), String> {
    let rows = sqlx::query("SELECT name FROM pragma_table_info('chat_messages')")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("pragma table_info failed: {e}"))?;

    let has_column = rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .any(|name| name == "kind");

    if has_column {
        return Ok(());
    }

    sqlx::query("ALTER TABLE chat_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'")
        .execute(pool)
        .await
        .map_err(|e| format!("failed to add kind column: {e}"))?;
    Ok(())
}

/// Adds `executions.conversation_id` so a skill run started from a chat
/// can route its status messages back to the originating thread.
/// Nullable + no FK — executions started outside the chat (cron,
/// manual, future programmatic triggers) leave it NULL, and the audit
/// row outlives the conversation if the user deletes the thread.
async fn ensure_executions_conversation_id(pool: &DbPool) -> Result<(), String> {
    let rows = sqlx::query("SELECT name FROM pragma_table_info('executions')")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("pragma table_info failed: {e}"))?;

    let has_column = rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .any(|name| name == "conversation_id");

    if has_column {
        return Ok(());
    }

    sqlx::query("ALTER TABLE executions ADD COLUMN conversation_id TEXT")
        .execute(pool)
        .await
        .map_err(|e| format!("failed to add executions.conversation_id: {e}"))?;
    Ok(())
}

/// Adds `conversations.active_integration` (TEXT, nullable). Stores
/// the @-integration handle that's currently "sticky" pra thread —
/// turnos seguintes herdam o contexto sem precisar do `@<name>` no
/// prompt do usuário. NULL = sem integração ativa.
async fn ensure_conversations_active_integration(pool: &DbPool) -> Result<(), String> {
    let rows = sqlx::query("SELECT name FROM pragma_table_info('conversations')")
        .fetch_all(pool)
        .await
        .map_err(|e| format!("pragma table_info failed: {e}"))?;

    let has_column = rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>("name").ok())
        .any(|name| name == "active_integration");

    if has_column {
        return Ok(());
    }

    sqlx::query("ALTER TABLE conversations ADD COLUMN active_integration TEXT")
        .execute(pool)
        .await
        .map_err(|e| format!("failed to add conversations.active_integration: {e}"))?;
    Ok(())
}
