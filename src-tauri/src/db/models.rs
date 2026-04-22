use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Execution {
    pub id: String,
    pub project_id: String,
    pub skill_name: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub total_steps: i32,
    pub completed_steps: i32,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecutionStep {
    pub id: String,
    pub execution_id: String,
    pub step_id: String,
    pub step_order: i32,
    pub tool: String,
    pub status: String,
    pub input: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub retries: i32,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub execution_id: Option<String>,
    pub role: String,
    pub content: String,
    pub created_at: String,
}
