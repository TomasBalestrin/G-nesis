//! CRUD queries. All SQL lives here — never inline SQL in `commands/`
//! (see CLAUDE.md NÃO Fazer).

use sqlx::SqlitePool;

use crate::db::models::{ChatMessage, Execution, ExecutionStep, Project};

fn map_err(e: sqlx::Error) -> String {
    format!("db error: {e}")
}

// ── projects ────────────────────────────────────────────────────────────────

pub async fn list_projects(pool: &SqlitePool) -> Result<Vec<Project>, String> {
    sqlx::query_as::<_, Project>(
        "SELECT id, name, repo_path, created_at, updated_at
         FROM projects
         ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

pub async fn get_project(pool: &SqlitePool, id: &str) -> Result<Option<Project>, String> {
    sqlx::query_as::<_, Project>(
        "SELECT id, name, repo_path, created_at, updated_at
         FROM projects WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

pub async fn insert_project(pool: &SqlitePool, project: &Project) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO projects (id, name, repo_path)
         VALUES (?1, ?2, ?3)",
    )
    .bind(&project.id)
    .bind(&project.name)
    .bind(&project.repo_path)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

pub async fn delete_project(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM projects WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}

// ── executions ──────────────────────────────────────────────────────────────

pub async fn list_executions_for_project(
    pool: &SqlitePool,
    project_id: &str,
) -> Result<Vec<Execution>, String> {
    sqlx::query_as::<_, Execution>(
        "SELECT id, project_id, skill_name, status, started_at, finished_at,
                total_steps, completed_steps, created_at
         FROM executions
         WHERE project_id = ?1
         ORDER BY created_at DESC",
    )
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

pub async fn insert_execution(pool: &SqlitePool, execution: &Execution) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO executions
           (id, project_id, skill_name, status, started_at, finished_at,
            total_steps, completed_steps)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(&execution.id)
    .bind(&execution.project_id)
    .bind(&execution.skill_name)
    .bind(&execution.status)
    .bind(&execution.started_at)
    .bind(&execution.finished_at)
    .bind(execution.total_steps)
    .bind(execution.completed_steps)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

pub async fn update_execution_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE executions SET status = ?1 WHERE id = ?2")
        .bind(status)
        .bind(id)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}

// ── execution_steps ─────────────────────────────────────────────────────────

pub async fn list_steps_for_execution(
    pool: &SqlitePool,
    execution_id: &str,
) -> Result<Vec<ExecutionStep>, String> {
    sqlx::query_as::<_, ExecutionStep>(
        "SELECT id, execution_id, step_id, step_order, tool, status,
                input, output, error, retries, started_at, finished_at,
                duration_ms, created_at
         FROM execution_steps
         WHERE execution_id = ?1
         ORDER BY step_order ASC",
    )
    .bind(execution_id)
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

pub async fn insert_step(pool: &SqlitePool, step: &ExecutionStep) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO execution_steps
           (id, execution_id, step_id, step_order, tool, status,
            input, output, error, retries,
            started_at, finished_at, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
    )
    .bind(&step.id)
    .bind(&step.execution_id)
    .bind(&step.step_id)
    .bind(step.step_order)
    .bind(&step.tool)
    .bind(&step.status)
    .bind(&step.input)
    .bind(&step.output)
    .bind(&step.error)
    .bind(step.retries)
    .bind(&step.started_at)
    .bind(&step.finished_at)
    .bind(step.duration_ms)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

pub async fn update_step_status(
    pool: &SqlitePool,
    id: &str,
    status: &str,
    output: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE execution_steps
         SET status = ?1, output = ?2, error = ?3, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?4",
    )
    .bind(status)
    .bind(output)
    .bind(error)
    .bind(id)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

// ── chat_messages ───────────────────────────────────────────────────────────

pub async fn list_messages(
    pool: &SqlitePool,
    execution_id: Option<&str>,
) -> Result<Vec<ChatMessage>, String> {
    match execution_id {
        Some(exec_id) => sqlx::query_as::<_, ChatMessage>(
            "SELECT id, execution_id, role, content, created_at
             FROM chat_messages
             WHERE execution_id = ?1
             ORDER BY created_at ASC",
        )
        .bind(exec_id)
        .fetch_all(pool)
        .await
        .map_err(map_err),
        None => sqlx::query_as::<_, ChatMessage>(
            "SELECT id, execution_id, role, content, created_at
             FROM chat_messages
             WHERE execution_id IS NULL
             ORDER BY created_at ASC",
        )
        .fetch_all(pool)
        .await
        .map_err(map_err),
    }
}

pub async fn insert_message(pool: &SqlitePool, message: &ChatMessage) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO chat_messages (id, execution_id, role, content)
         VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&message.id)
    .bind(&message.execution_id)
    .bind(&message.role)
    .bind(&message.content)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}
