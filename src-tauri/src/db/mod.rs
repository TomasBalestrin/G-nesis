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
