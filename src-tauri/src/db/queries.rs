//! CRUD queries. All SQL lives here — never inline SQL in `commands/`
//! (see CLAUDE.md NÃO Fazer).

use sqlx::SqlitePool;

use crate::db::models::{
    AppState, ChatMessage, Conversation, Execution, ExecutionStep, Project,
};

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

/// Count executions for `skill_name` that are still in flight (pending,
/// running or paused). Used to block destructive actions like deleting the
/// skill .md while a job is using it.
pub async fn count_active_by_skill_name(
    pool: &SqlitePool,
    skill_name: &str,
) -> Result<i64, String> {
    let (count,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM executions
         WHERE skill_name = ?1 AND status IN ('pending', 'running', 'paused')",
    )
    .bind(skill_name)
    .fetch_one(pool)
    .await
    .map_err(map_err)?;
    Ok(count)
}

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

pub async fn get_execution(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<Execution>, String> {
    sqlx::query_as::<_, Execution>(
        "SELECT id, project_id, skill_name, status, started_at, finished_at,
                total_steps, completed_steps, created_at
         FROM executions WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
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

const MESSAGE_COLUMNS: &str =
    "id, execution_id, conversation_id, role, content, created_at";

pub async fn list_messages(
    pool: &SqlitePool,
    execution_id: Option<&str>,
) -> Result<Vec<ChatMessage>, String> {
    let query = match execution_id {
        Some(_) => format!(
            "SELECT {MESSAGE_COLUMNS} FROM chat_messages \
             WHERE execution_id = ?1 ORDER BY created_at ASC"
        ),
        None => format!(
            "SELECT {MESSAGE_COLUMNS} FROM chat_messages \
             WHERE execution_id IS NULL ORDER BY created_at ASC"
        ),
    };
    let mut q = sqlx::query_as::<_, ChatMessage>(&query);
    if let Some(exec_id) = execution_id {
        q = q.bind(exec_id);
    }
    q.fetch_all(pool).await.map_err(map_err)
}

pub async fn list_messages_by_conversation(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<Vec<ChatMessage>, String> {
    sqlx::query_as::<_, ChatMessage>(&format!(
        "SELECT {MESSAGE_COLUMNS} FROM chat_messages \
         WHERE conversation_id = ?1 ORDER BY created_at ASC"
    ))
    .bind(conversation_id)
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

pub async fn insert_message(pool: &SqlitePool, message: &ChatMessage) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO chat_messages (id, execution_id, conversation_id, role, content)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&message.id)
    .bind(&message.execution_id)
    .bind(&message.conversation_id)
    .bind(&message.role)
    .bind(&message.content)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

// ── conversations ───────────────────────────────────────────────────────────

pub async fn list_conversations(pool: &SqlitePool) -> Result<Vec<Conversation>, String> {
    sqlx::query_as::<_, Conversation>(
        "SELECT id, title, created_at, updated_at
         FROM conversations
         ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

pub async fn get_conversation(
    pool: &SqlitePool,
    id: &str,
) -> Result<Option<Conversation>, String> {
    sqlx::query_as::<_, Conversation>(
        "SELECT id, title, created_at, updated_at
         FROM conversations WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

pub async fn insert_conversation(
    pool: &SqlitePool,
    conversation: &Conversation,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO conversations (id, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&conversation.id)
    .bind(&conversation.title)
    .bind(&conversation.created_at)
    .bind(&conversation.updated_at)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

pub async fn delete_conversation(pool: &SqlitePool, id: &str) -> Result<(), String> {
    // chat_messages.conversation_id has ON DELETE CASCADE → rows go with it.
    sqlx::query("DELETE FROM conversations WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}

pub async fn rename_conversation(
    pool: &SqlitePool,
    id: &str,
    title: &str,
) -> Result<(), String> {
    sqlx::query("UPDATE conversations SET title = ?1 WHERE id = ?2")
        .bind(title)
        .bind(id)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}

/// Bump `updated_at` to now so the conversation floats to the top of
/// `list_conversations`. Called every time a message is added to the thread.
pub async fn touch_conversation(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query(
        "UPDATE conversations \
         SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
         WHERE id = ?1",
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

// ── app_state (key/value) ───────────────────────────────────────────────────

/// Returns the row for `key` if it exists. Defaults seeded by migration 003
/// guarantee the canonical keys (`active_project_id`, `active_model_id`)
/// always resolve to a row after first startup.
pub async fn get_state(pool: &SqlitePool, key: &str) -> Result<Option<AppState>, String> {
    sqlx::query_as::<_, AppState>(
        "SELECT key, value, updated_at FROM app_state WHERE key = ?1",
    )
    .bind(key)
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

/// UPSERT a single key. Returns the freshly written row so callers can echo
/// the new `updated_at` to the frontend without an extra query.
pub async fn set_state(
    pool: &SqlitePool,
    key: &str,
    value: &str,
) -> Result<AppState, String> {
    sqlx::query(
        "INSERT INTO app_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET
             value = excluded.value,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .map_err(map_err)?;

    get_state(pool, key)
        .await?
        .ok_or_else(|| format!("app_state row `{key}` desapareceu após upsert"))
}
