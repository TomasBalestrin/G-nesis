//! Tauri IPC handlers for the unified capabilities registry.
//!
//! Capabilities are what the user invokes via @-mentions in chat. The DB
//! holds two flavors (`native` shipped with the app, `connector` added
//! later by the user); these handlers let the frontend list and look up
//! rows without inlining SQL — all queries route through `db::queries`.
//!
//! No mutators yet: A1/A2 only need read paths. Insert/update/toggle land
//! in a later task once the connector flow needs them.

use sqlx::SqlitePool;
use tauri::State;

use crate::db::models::Capability;
use crate::db::queries;

/// All enabled capabilities, ordered by type then name. Used by the chat
/// `@`-picker to render the full menu in one call.
#[tauri::command]
pub async fn list_capabilities(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<Capability>, String> {
    queries::list_capabilities(&pool).await
}

/// Resolve a capability by its `name` handle (the @-mention identifier).
/// Returns `None` for unknown names so the frontend can decide between
/// "not found" toast and silent fallback.
#[tauri::command]
pub async fn get_capability(
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<Option<Capability>, String> {
    queries::get_capability_by_name(&pool, &name).await
}

/// Active capabilities filtered to a single type (`"native"` or
/// `"connector"`). Used by the settings page to render the two groups
/// independently.
#[tauri::command]
pub async fn list_capabilities_by_type(
    type_: String,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<Capability>, String> {
    queries::list_capabilities_by_type(&pool, &type_).await
}
