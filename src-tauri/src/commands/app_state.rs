//! Tauri IPC for the cross-session UI state store (active project, active
//! model, etc). Backed by the `app_state` table — see migration 003 and
//! db::queries::{get_state, set_state}.

use sqlx::SqlitePool;
use tauri::State;

use crate::db::models::AppState;
use crate::db::queries;

/// Read a single key. Returns `None` if the key was never written and the
/// migration default (if any) wasn't seeded — callers decide the fallback.
#[tauri::command]
pub async fn get_app_state(
    key: String,
    pool: State<'_, SqlitePool>,
) -> Result<Option<AppState>, String> {
    queries::get_state(&pool, &key).await
}

/// UPSERT a key. Returns the freshly written row including the bumped
/// `updated_at`, so the frontend can render "salvo às HH:MM" without an
/// extra round-trip.
#[tauri::command]
pub async fn set_app_state(
    key: String,
    value: String,
    pool: State<'_, SqlitePool>,
) -> Result<AppState, String> {
    queries::set_state(&pool, &key, &value).await
}
