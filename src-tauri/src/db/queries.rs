//! CRUD queries. All SQL lives here — never inline SQL in `commands/`
//! (see CLAUDE.md NÃO Fazer).

use sqlx::SqlitePool;

use crate::db::models::{
    AppState, Capability, ChatMessage, Conversation, Execution, ExecutionStep, IntegrationRow,
    KnowledgeFile, KnowledgeFileMeta, KnowledgeSummary, Project, SkillRow,
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

/// Resolves the "active project" for the system-state snapshot injected
/// into the chat prompt: the project tied to the most recent execution.
/// When no execution exists yet (fresh install), falls back to the most
/// recently created project. Returns `None` only when the user has no
/// projects at all.
///
/// Two queries instead of one `LEFT JOIN ... GROUP BY` so the fallback
/// path is explicit and easy to test. This runs once per chat turn, not
/// in a hot loop, so the extra round-trip is fine.
pub async fn get_active_project(pool: &SqlitePool) -> Result<Option<Project>, String> {
    let by_execution = sqlx::query_as::<_, Project>(
        "SELECT p.id, p.name, p.repo_path, p.created_at, p.updated_at
         FROM projects p
         JOIN executions e ON e.project_id = p.id
         ORDER BY e.created_at DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(map_err)?;

    if by_execution.is_some() {
        return Ok(by_execution);
    }

    sqlx::query_as::<_, Project>(
        "SELECT id, name, repo_path, created_at, updated_at
         FROM projects
         ORDER BY created_at DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

// ── executions ──────────────────────────────────────────────────────────────

/// Single source of truth for the columns SELECTed into [`Execution`].
/// Prevents drift when a column is added (FromRow rejects rows missing a
/// field). All SELECTs in this section must format with this const.
const EXECUTION_COLUMNS: &str = "id, project_id, skill_name, status, started_at, finished_at, \
     total_steps, completed_steps, created_at, conversation_id";

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
    sqlx::query_as::<_, Execution>(&format!(
        "SELECT {EXECUTION_COLUMNS} FROM executions \
         WHERE project_id = ?1 ORDER BY created_at DESC"
    ))
    .bind(project_id)
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

pub async fn get_execution(pool: &SqlitePool, id: &str) -> Result<Option<Execution>, String> {
    sqlx::query_as::<_, Execution>(&format!(
        "SELECT {EXECUTION_COLUMNS} FROM executions WHERE id = ?1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

/// In-flight execution for the system-state snapshot. Returns the most
/// recently started execution whose status is still `running` (a single
/// active execution at a time is the expected state, but we order by
/// started_at DESC defensively in case of concurrent runs).
pub async fn get_running_execution(pool: &SqlitePool) -> Result<Option<Execution>, String> {
    sqlx::query_as::<_, Execution>(&format!(
        "SELECT {EXECUTION_COLUMNS} FROM executions \
         WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
    ))
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

/// Most recent execution that already finished (success/failure/aborted).
/// `finished_at IS NOT NULL` is the canonical "this run is done" signal —
/// status alone isn't enough since the schema permits intermediate
/// values. Used by the system-state snapshot so the model can reference
/// "the last thing we ran" without asking the user.
pub async fn get_last_finished_execution(pool: &SqlitePool) -> Result<Option<Execution>, String> {
    sqlx::query_as::<_, Execution>(&format!(
        "SELECT {EXECUTION_COLUMNS} FROM executions \
         WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1"
    ))
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

pub async fn insert_execution(pool: &SqlitePool, execution: &Execution) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO executions
           (id, project_id, skill_name, status, started_at, finished_at,
            total_steps, completed_steps, conversation_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
    .bind(&execution.id)
    .bind(&execution.project_id)
    .bind(&execution.skill_name)
    .bind(&execution.status)
    .bind(&execution.started_at)
    .bind(&execution.finished_at)
    .bind(execution.total_steps)
    .bind(execution.completed_steps)
    .bind(&execution.conversation_id)
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
    "id, execution_id, conversation_id, role, content, created_at, kind, thinking, thinking_summary";

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
        "INSERT INTO chat_messages
            (id, execution_id, conversation_id, role, content, kind, thinking, thinking_summary)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
    .bind(&message.id)
    .bind(&message.execution_id)
    .bind(&message.conversation_id)
    .bind(&message.role)
    .bind(&message.content)
    .bind(&message.kind)
    .bind(&message.thinking)
    .bind(&message.thinking_summary)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

// ── conversations ───────────────────────────────────────────────────────────

/// Single source of truth for the columns SELECTed into [`Conversation`].
/// Inclui `active_integration` (sticky @-mention da thread) — drift
/// quebra `FromRow` porque o derive rejeita rows sem o campo.
const CONVERSATION_COLUMNS: &str = "id, title, created_at, updated_at, active_integration";

pub async fn list_conversations(pool: &SqlitePool) -> Result<Vec<Conversation>, String> {
    sqlx::query_as::<_, Conversation>(&format!(
        "SELECT {CONVERSATION_COLUMNS} FROM conversations ORDER BY updated_at DESC"
    ))
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

pub async fn get_conversation(pool: &SqlitePool, id: &str) -> Result<Option<Conversation>, String> {
    sqlx::query_as::<_, Conversation>(&format!(
        "SELECT {CONVERSATION_COLUMNS} FROM conversations WHERE id = ?1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

/// Set or clear `conversations.active_integration` for a thread. `Some`
/// records the @-handle pra contexto sticky entre turns; `None` limpa
/// (não em uso ainda — futuro botão "limpar contexto").
pub async fn set_conversation_active_integration(
    pool: &SqlitePool,
    id: &str,
    integration_name: Option<&str>,
) -> Result<(), String> {
    sqlx::query("UPDATE conversations SET active_integration = ?1 WHERE id = ?2")
        .bind(integration_name)
        .bind(id)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
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

pub async fn rename_conversation(pool: &SqlitePool, id: &str, title: &str) -> Result<(), String> {
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
    sqlx::query_as::<_, AppState>("SELECT key, value, updated_at FROM app_state WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(map_err)
}

/// UPSERT a single key. Returns the freshly written row so callers can echo
/// the new `updated_at` to the frontend without an extra query.
pub async fn set_state(pool: &SqlitePool, key: &str, value: &str) -> Result<AppState, String> {
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

/// Lightweight read of the `value` column for `key`. Differs from `get_state`
/// in that it returns just the string payload — callers that don't care
/// about `updated_at` use this to skip a layer of unwrapping.
pub async fn get_app_state(pool: &SqlitePool, key: &str) -> Result<Option<String>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM app_state WHERE key = ?1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map_err(map_err)?;
    Ok(row.map(|(v,)| v))
}

/// Companion of `get_app_state`. Same UPSERT semantics as `set_state` but
/// fire-and-forget — drops the freshly-written row to keep the caller-side
/// signature simple. Use `set_state` when you need the new `updated_at`.
pub async fn set_app_state(pool: &SqlitePool, key: &str, value: &str) -> Result<(), String> {
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
    Ok(())
}

// ── knowledge_files ─────────────────────────────────────────────────────────

/// Insert a freshly uploaded knowledge file. Caller generates the id (UUID
/// v4) so the command layer can echo it back without an extra round-trip.
/// `filename` has a UNIQUE constraint at the schema level — re-uploads with
/// the same name surface as a sqlx error and the caller can decide whether
/// to delete-then-insert.
pub async fn insert_knowledge_file(
    pool: &SqlitePool,
    id: &str,
    filename: &str,
    content: &str,
) -> Result<(), String> {
    sqlx::query("INSERT INTO knowledge_files (id, filename, content) VALUES (?1, ?2, ?3)")
        .bind(id)
        .bind(filename)
        .bind(content)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}

/// List all knowledge files without their content — sidebar / settings
/// only need filename + uploaded_at, and the content column can run into
/// hundreds of KB per row.
pub async fn list_knowledge_files(pool: &SqlitePool) -> Result<Vec<KnowledgeFileMeta>, String> {
    sqlx::query_as::<_, KnowledgeFileMeta>(
        "SELECT id, filename, uploaded_at
         FROM knowledge_files
         ORDER BY uploaded_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

/// Fetch a single knowledge file with its full content — used by the
/// editor / re-upload flow when the user wants to see the original markdown.
pub async fn get_knowledge_file(pool: &SqlitePool, id: &str) -> Result<KnowledgeFile, String> {
    sqlx::query_as::<_, KnowledgeFile>(
        "SELECT id, filename, content, uploaded_at
         FROM knowledge_files
         WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(map_err)?
    .ok_or_else(|| format!("knowledge_file `{id}` não encontrado"))
}

pub async fn delete_knowledge_file(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM knowledge_files WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}

/// Bulk-fetch all (filename, content) pairs ordered by upload time. Feeds
/// the summarizer pipeline — it concatenates the contents into a single
/// prompt for GPT and replaces the singleton summary row.
pub async fn get_all_knowledge_contents(
    pool: &SqlitePool,
) -> Result<Vec<(String, String)>, String> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT filename, content
         FROM knowledge_files
         ORDER BY uploaded_at ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

// ── knowledge_summary (singleton) ───────────────────────────────────────────

/// UPSERT the singleton summary row. Always uses id = 'singleton' so
/// regenerations overwrite cleanly without a delete-first dance.
/// `generated_at` is server-computed via strftime so the timestamp matches
/// other tables' precision.
pub async fn upsert_knowledge_summary(
    pool: &SqlitePool,
    summary: &str,
    source_count: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO knowledge_summary (id, summary, source_count)
         VALUES ('singleton', ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET
             summary = excluded.summary,
             source_count = excluded.source_count,
             generated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    )
    .bind(summary)
    .bind(source_count)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

/// Read the current summary if any has been generated yet. `None` means
/// the user has uploaded files but never asked for a summary, OR no files
/// at all — the caller decides which message to show.
pub async fn get_knowledge_summary(pool: &SqlitePool) -> Result<Option<KnowledgeSummary>, String> {
    sqlx::query_as::<_, KnowledgeSummary>(
        "SELECT id, summary, generated_at, source_count
         FROM knowledge_summary
         WHERE id = 'singleton'",
    )
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

/// Wipe the singleton row. Used when the last knowledge file is deleted —
/// keeping a stale summary around would confuse the system prompt builder.
pub async fn delete_knowledge_summary(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("DELETE FROM knowledge_summary WHERE id = 'singleton'")
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}

// ── capabilities ────────────────────────────────────────────────────────────

/// Single source of truth for the columns SELECTed into [`Capability`].
/// `type` is escaped because it's a reserved Rust keyword — the FromRow
/// derive lines this up with the `type_` field via the
/// `#[sqlx(rename = "type")]` attribute on the struct.
const CAPABILITY_COLUMNS: &str = "id, name, display_name, description, type, channel, config, \
     doc_ai, doc_user, enabled, created_at, updated_at";

/// Active capabilities sorted by type then name. Disabled rows are
/// hidden (the picker only shows what the user can actually invoke).
/// Sort by type so natives come before connectors (lexicographic on
/// `'native' < 'connector'`? no — `'connector' < 'native'`. Both
/// surfaces handle either order; we just want a stable groupings).
pub async fn list_capabilities(pool: &SqlitePool) -> Result<Vec<Capability>, String> {
    sqlx::query_as::<_, Capability>(&format!(
        "SELECT {CAPABILITY_COLUMNS} FROM capabilities \
         WHERE enabled = 1 \
         ORDER BY type, name"
    ))
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

/// Fetch a capability by its `name` handle (the @-mention identifier).
/// Returns `None` for unknown / disabled-and-renamed rows. Callers
/// resolve the channel + doc_ai from the row and dispatch accordingly.
pub async fn get_capability_by_name(
    pool: &SqlitePool,
    name: &str,
) -> Result<Option<Capability>, String> {
    sqlx::query_as::<_, Capability>(&format!(
        "SELECT {CAPABILITY_COLUMNS} FROM capabilities WHERE name = ?1"
    ))
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

/// Active capabilities filtered to a single `type_` (`"native"` or
/// `"connector"`). Used by the settings page to render the two groups
/// independently. Mirrors `list_capabilities` ordering by name within
/// the requested type.
pub async fn list_capabilities_by_type(
    pool: &SqlitePool,
    type_: &str,
) -> Result<Vec<Capability>, String> {
    sqlx::query_as::<_, Capability>(&format!(
        "SELECT {CAPABILITY_COLUMNS} FROM capabilities \
         WHERE type = ?1 AND enabled = 1 \
         ORDER BY name"
    ))
    .bind(type_)
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

// ── integrations ────────────────────────────────────────────────────────────

/// Single source of truth for the columns SELECTed into [`IntegrationRow`].
/// Drift here breaks `FromRow` (it rejects rows missing a field), so every
/// SELECT in this section must format with this const.
const INTEGRATION_COLUMNS: &str = "id, name, display_name, base_url, auth_type, spec_file, \
     enabled, last_used_at, created_at";

/// Active integrations sorted by recency of use first, then by name.
/// `last_used_at` is nullable so unused integrations sort to the bottom
/// via `IS NULL` ordering. Disabled rows are hidden — picker only shows
/// what the user can invoke right now.
pub async fn list_integrations(pool: &SqlitePool) -> Result<Vec<IntegrationRow>, String> {
    sqlx::query_as::<_, IntegrationRow>(&format!(
        "SELECT {INTEGRATION_COLUMNS} FROM integrations \
         WHERE enabled = 1 \
         ORDER BY last_used_at IS NULL, last_used_at DESC, name"
    ))
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

/// Fetch by the @-mention handle. Returns `None` for unknown OR disabled
/// rows; if a caller needs disabled entries (e.g. settings management),
/// add a flag-bypassing variant.
pub async fn get_integration_by_name(
    pool: &SqlitePool,
    name: &str,
) -> Result<Option<IntegrationRow>, String> {
    sqlx::query_as::<_, IntegrationRow>(&format!(
        "SELECT {INTEGRATION_COLUMNS} FROM integrations WHERE name = ?1"
    ))
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

/// Insert a fresh row. `created_at` lets the column default fill in via
/// the migration's `strftime` so we don't smuggle clock skew across
/// callers; `last_used_at` is intentionally NULL on insert (set later
/// by [`touch_integration_last_used`]).
pub async fn insert_integration(
    pool: &SqlitePool,
    integration: &IntegrationRow,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO integrations \
         (id, name, display_name, base_url, auth_type, spec_file, enabled) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&integration.id)
    .bind(&integration.name)
    .bind(&integration.display_name)
    .bind(&integration.base_url)
    .bind(&integration.auth_type)
    .bind(&integration.spec_file)
    .bind(integration.enabled)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

/// Edit metadata in place — keyed by `id` so renaming `name` works
/// without a separate handler. `created_at` and `last_used_at` are NOT
/// touched: the first is immutable, the second is bumped only by
/// [`touch_integration_last_used`].
pub async fn update_integration(
    pool: &SqlitePool,
    integration: &IntegrationRow,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE integrations SET \
         name = ?2, display_name = ?3, base_url = ?4, auth_type = ?5, \
         spec_file = ?6, enabled = ?7 \
         WHERE id = ?1",
    )
    .bind(&integration.id)
    .bind(&integration.name)
    .bind(&integration.display_name)
    .bind(&integration.base_url)
    .bind(&integration.auth_type)
    .bind(&integration.spec_file)
    .bind(integration.enabled)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

/// Hard delete by id. The matching `[integrations.<name>]` block in
/// config.toml is the caller's responsibility (typically
/// `integrations::remove_integration`) — we don't reach across the
/// filesystem from here.
pub async fn delete_integration(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM integrations WHERE id = ?1")
        .bind(id)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}

/// Bump `last_used_at` to now. Called after a successful integration
/// invocation so the picker can sort by recency. Keyed by `name`
/// (not id) because callers usually only have the @-mention handle
/// at the time of dispatch.
pub async fn touch_integration_last_used(
    pool: &SqlitePool,
    name: &str,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE integrations \
         SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') \
         WHERE name = ?1",
    )
    .bind(name)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

// ── skills ──────────────────────────────────────────────────────────────────

/// Single source of truth pros columns SELECTed em [`SkillRow`].
/// Drift aqui quebra `FromRow` (rejeita rows com fields ausentes),
/// então todo SELECT no bloco abaixo formata com este const.
const SKILL_COLUMNS: &str = "id, name, version, author, has_assets, \
     has_references, files_count, created_at, updated_at";

/// Lista skills do mirror SQLite, sorted por name. Mirror — não
/// substitui o file scan via `crate::skills::storage::list_skill_packages`
/// (esse continua sendo a source-of-truth). Use SQL aqui pra UI
/// que quer rapidez (sem stat de N pastas + sem parsing de
/// frontmatter) e pode tolerar staleness.
pub async fn list_skills(pool: &SqlitePool) -> Result<Vec<SkillRow>, String> {
    sqlx::query_as::<_, SkillRow>(&format!(
        "SELECT {SKILL_COLUMNS} FROM skills ORDER BY name"
    ))
    .fetch_all(pool)
    .await
    .map_err(map_err)
}

/// Fetch by name (handle do `/skill-name` no chat). `None` quando o
/// row não existe — mirror pode estar atrás do disco; caller decide
/// fallback (ex: re-sync via storage::list_skill_packages).
pub async fn get_skill_by_name(
    pool: &SqlitePool,
    name: &str,
) -> Result<Option<SkillRow>, String> {
    sqlx::query_as::<_, SkillRow>(&format!(
        "SELECT {SKILL_COLUMNS} FROM skills WHERE name = ?1"
    ))
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(map_err)
}

/// Insert. `created_at`/`updated_at` deixam o DEFAULT do schema
/// preencher (strftime now). UNIQUE em `name` propaga erro com
/// detalhe pro caller decidir UPSERT vs reject.
pub async fn insert_skill(pool: &SqlitePool, skill: &SkillRow) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO skills \
         (id, name, version, author, has_assets, has_references, files_count) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&skill.id)
    .bind(&skill.name)
    .bind(&skill.version)
    .bind(&skill.author)
    .bind(skill.has_assets)
    .bind(skill.has_references)
    .bind(skill.files_count)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

/// Update keyed por id (rename via name change OK — UNIQUE bate
/// se colidir). Não toca created_at; updated_at sobe sozinho via
/// trigger trg_skills_updated_at.
pub async fn update_skill(pool: &SqlitePool, skill: &SkillRow) -> Result<(), String> {
    sqlx::query(
        "UPDATE skills SET \
         name = ?2, version = ?3, author = ?4, \
         has_assets = ?5, has_references = ?6, files_count = ?7 \
         WHERE id = ?1",
    )
    .bind(&skill.id)
    .bind(&skill.name)
    .bind(&skill.version)
    .bind(&skill.author)
    .bind(skill.has_assets)
    .bind(skill.has_references)
    .bind(skill.files_count)
    .execute(pool)
    .await
    .map_err(map_err)?;
    Ok(())
}

/// Hard delete por name. Idempotente — SQLite DELETE com 0 matches é
/// Ok. NÃO toca em filesystem; caller chama `crate::skills::storage::
/// delete_skill_package` em paralelo pra cleanup completo.
pub async fn delete_skill_row(pool: &SqlitePool, name: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM skills WHERE name = ?1")
        .bind(name)
        .execute(pool)
        .await
        .map_err(map_err)?;
    Ok(())
}
