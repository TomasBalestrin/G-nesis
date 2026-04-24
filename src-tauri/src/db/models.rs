//! Rust structs mirroring the SQLite schema (see docs/schema.md §3).
//!
//! Integer columns use `i64` because SQLite stores every INTEGER as a 64-bit
//! signed value; sqlx's `FromRow` rejects `i32` unless you convert explicitly.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Execution {
    pub id: String,
    pub project_id: String,
    pub skill_name: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub total_steps: i64,
    pub completed_steps: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ExecutionStep {
    pub id: String,
    pub execution_id: String,
    pub step_id: String,
    pub step_order: i64,
    pub tool: String,
    pub status: String,
    pub input: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub retries: i64,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ChatMessage {
    pub id: String,
    pub execution_id: Option<String>,
    pub conversation_id: Option<String>,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}
