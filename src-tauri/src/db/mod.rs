//! SQLite persistence layer.
//!
//! Holds the connection pool and runs the schema migration (idempotent
//! CREATE TABLE / CREATE TRIGGER) on startup. The pool is stored in Tauri's
//! managed state so commands can access it via `State<DbPool>`.
//!
//! Pragmas (WAL, foreign_keys, busy_timeout) are set declaratively on the
//! connection options — sqlx applies them to every connection in the pool.

pub mod models;
pub mod queries;

use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Executor, SqlitePool};

pub type DbPool = SqlitePool;

const MIGRATION_SQL: &str = include_str!("../../migrations/001_init.sql");

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
    pool.execute(MIGRATION_SQL)
        .await
        .map_err(|e| format!("migration failed: {e}"))?;
    Ok(())
}
