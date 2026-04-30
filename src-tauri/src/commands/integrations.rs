//! Tauri IPC handlers for the integrations registry.
//!
//! Storage is split across three places:
//!   - SQLite `integrations` table — fast metadata index for picker /
//!     list views (NEVER stores api_key).
//!   - `~/.genesis/config.toml [integrations.<name>]` — full auth
//!     payload + the api_key. Source-of-truth for the secret.
//!   - `~/.genesis/integrations/<name>.yaml` — optional OpenAPI-style
//!     spec the chat will reference when planning a request.
//!
//! Every mutator keeps these three in sync (best-effort): writes go in
//! the order TOML → spec file → SQLite, so a partial failure leaves
//! the on-disk config consistent enough that a re-run can finish the
//! job without manual cleanup.
//!
//! `IntegrationRow` is the only shape that ever crosses the IPC
//! boundary. The api_key is intentionally never returned by any
//! handler — frontend reads/edits it via `add_integration` /
//! `update_integration` only.

use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use reqwest::Client;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::config::config_dir;
use crate::db::models::IntegrationRow;
use crate::db::queries;
use crate::integrations::{self, AuthType, Integration};

/// All enabled integrations, ordered by recency of use. Bare passthrough
/// to `queries::list_integrations` — kept in this module for symmetry
/// with the other CRUD handlers and so the frontend tauri-bridge has
/// one consistent import path.
#[tauri::command]
pub async fn list_integrations(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<IntegrationRow>, String> {
    queries::list_integrations(&pool).await
}

/// Register a new integration. Order of writes:
///   1. spec file (optional — caller can skip if the integration's API
///      shape is well known and doesn't need a local spec)
///   2. config.toml — saves auth payload + api_key
///   3. SQLite — inserts metadata row
///
/// Errors out early if `name` is empty or already in the table. Returns
/// the freshly-inserted row (re-fetched so `created_at` reflects the
/// schema's `strftime` default rather than a sentinel).
#[tauri::command]
pub async fn add_integration(
    name: String,
    display_name: String,
    base_url: String,
    api_key: String,
    auth_type: AuthType,
    spec_content: Option<String>,
    pool: State<'_, SqlitePool>,
) -> Result<IntegrationRow, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("nome não pode ser vazio".into());
    }
    if queries::get_integration_by_name(&pool, &name)
        .await?
        .is_some()
    {
        return Err(format!("integration `{name}` já existe"));
    }

    let spec_file = format!("{name}.yaml");
    if let Some(content) = spec_content.as_deref() {
        write_spec_file(&spec_file, content)?;
    }

    let auth_discriminator = auth_type_discriminator(&auth_type).to_string();

    integrations::save_integration(
        Integration {
            name: name.clone(),
            display_name: display_name.clone(),
            base_url: base_url.clone(),
            auth_type,
            spec_file: spec_file.clone(),
            enabled: true,
        },
        Some(api_key),
    )?;

    let row = IntegrationRow {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        display_name,
        base_url,
        auth_type: auth_discriminator,
        spec_file,
        enabled: 1,
        last_used_at: None,
        created_at: String::new(), // schema DEFAULT fills this on INSERT
    };
    queries::insert_integration(&pool, &row).await?;

    queries::get_integration_by_name(&pool, &name)
        .await?
        .ok_or_else(|| "integration recém-criada não foi encontrada".into())
}

/// Edit metadata for an existing integration, keyed by id. **Does not
/// support rename** — the `name` arg must match the row's current name.
/// `api_key` is optional: `None` preserves the previously stored key
/// (lets the user toggle `enabled` or swap auth without re-typing the
/// secret). `spec_content` likewise: `None` leaves the file untouched.
#[tauri::command]
pub async fn update_integration(
    id: String,
    name: String,
    display_name: String,
    base_url: String,
    api_key: Option<String>,
    auth_type: AuthType,
    enabled: bool,
    spec_content: Option<String>,
    pool: State<'_, SqlitePool>,
) -> Result<IntegrationRow, String> {
    // Sanity: the row identified by `id` must currently bear `name`.
    // We catch rename attempts here so the on-disk TOML / spec file
    // never go out of sync with the SQLite row.
    match queries::get_integration_by_name(&pool, &name).await? {
        Some(row) if row.id == id => {}
        Some(_) => return Err(format!("nome `{name}` já está em uso por outra integration")),
        None => return Err("integration não encontrada — rename não suportado em update".into()),
    }

    let spec_file = format!("{name}.yaml");
    if let Some(content) = spec_content.as_deref() {
        write_spec_file(&spec_file, content)?;
    }

    let auth_discriminator = auth_type_discriminator(&auth_type).to_string();

    integrations::save_integration(
        Integration {
            name: name.clone(),
            display_name: display_name.clone(),
            base_url: base_url.clone(),
            auth_type,
            spec_file: spec_file.clone(),
            enabled,
        },
        api_key,
    )?;

    let row = IntegrationRow {
        id,
        name: name.clone(),
        display_name,
        base_url,
        auth_type: auth_discriminator,
        spec_file,
        enabled: if enabled { 1 } else { 0 },
        last_used_at: None,        // ignored by UPDATE statement
        created_at: String::new(), // ignored by UPDATE statement
    };
    queries::update_integration(&pool, &row).await?;

    queries::get_integration_by_name(&pool, &name)
        .await?
        .ok_or_else(|| "integration atualizada não foi encontrada".into())
}

/// Idempotent removal: drops the SQLite row, the `[integrations.<name>]`
/// TOML block, and the on-disk spec file. Failures on the spec unlink
/// are swallowed — the file may not exist, and the rest of the cleanup
/// has already succeeded by then.
#[tauri::command]
pub async fn remove_integration(
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    let Some(row) = queries::get_integration_by_name(&pool, &name).await? else {
        return Ok(());
    };

    queries::delete_integration(&pool, &row.id).await?;
    integrations::remove_integration(&name)?;
    let _ = fs::remove_file(spec_path(&row.spec_file));
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct TestIntegrationResult {
    pub ok: bool,
    pub status: u16,
    pub message: String,
}

/// Smoke-test an integration: GET base_url with the configured auth
/// scheme, return the HTTP status. Does NOT bump `last_used_at` —
/// that's reserved for real @-mention invocations.
///
/// Reads the full AuthType (with header_name / param_name) from the
/// TOML, since the SQLite row only carries the discriminator.
#[tauri::command]
pub async fn test_integration(
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<TestIntegrationResult, String> {
    let row = queries::get_integration_by_name(&pool, &name)
        .await?
        .ok_or_else(|| format!("integration `{name}` não encontrada"))?;
    let api_key = integrations::get_api_key(&name)?
        .ok_or_else(|| format!("api_key ausente para `{name}` em config.toml"))?;
    let full = integrations::load_integrations()?
        .into_iter()
        .find(|i| i.name == name)
        .ok_or_else(|| format!("integration `{name}` não está no config.toml"))?;

    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("falha ao criar HTTP client: {e}"))?;

    let mut req = client.get(&row.base_url);
    match full.auth_type {
        AuthType::Bearer => {
            req = req.bearer_auth(&api_key);
        }
        AuthType::Header { header_name } => {
            req = req.header(header_name.as_str(), &api_key);
        }
        AuthType::Query { param_name } => {
            req = req.query(&[(param_name.as_str(), api_key.as_str())]);
        }
    }

    let resp = req.send().await.map_err(|e| format!("HTTP error: {e}"))?;
    let status_code = resp.status();
    Ok(TestIntegrationResult {
        ok: status_code.is_success(),
        status: status_code.as_u16(),
        message: format!(
            "HTTP {} {}",
            status_code.as_u16(),
            status_code.canonical_reason().unwrap_or("")
        ),
    })
}

// ── helpers ─────────────────────────────────────────────────────────────────

fn auth_type_discriminator(a: &AuthType) -> &'static str {
    match a {
        AuthType::Bearer => "bearer",
        AuthType::Header { .. } => "header",
        AuthType::Query { .. } => "query",
    }
}

fn integrations_dir() -> PathBuf {
    config_dir().join("integrations")
}

fn spec_path(spec_file: &str) -> PathBuf {
    integrations_dir().join(spec_file)
}

fn write_spec_file(spec_file: &str, content: &str) -> Result<(), String> {
    let dir = integrations_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    let path = dir.join(spec_file);
    fs::write(&path, content).map_err(|e| format!("failed to write {}: {e}", path.display()))
}
