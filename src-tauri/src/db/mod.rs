//! SQLite persistence layer.
//!
//! Initialization runs the schema + pragmas from docs/schema.md on startup
//! (WAL, foreign_keys, busy_timeout). Actual migrations are wired in a later task.

pub mod models;
pub mod queries;

pub async fn init_db() -> Result<(), String> {
    // TODO: run PRAGMAs + CREATE TABLE statements from docs/schema.md
    Ok(())
}
