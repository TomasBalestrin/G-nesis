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
use std::time::Instant;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::config::config_dir;
use crate::db::models::IntegrationRow;
use crate::db::queries;
use crate::integrations::{self, AuthConfig, AuthType, Integration, IntegrationClient, IntegrationError};

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
    pub elapsed_ms: u128,
    pub message: String,
}

/// Smoke-test an integration: lookup row + key, build IntegrationClient,
/// run `health_check()`. On success bumps `last_used_at` so the picker
/// surfaces the integration as "verified recently". Always returns
/// `Ok(TestIntegrationResult)` for reachable integrations — the
/// `ok` flag tells the frontend whether to render success or a
/// friendly error toast. `Err` is reserved for "integration not
/// found" / "api_key ausente" — config-level problems the user
/// must fix in Settings before retrying.
#[tauri::command]
pub async fn test_integration(
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<TestIntegrationResult, String> {
    let started = Instant::now();
    let (_row, client) = build_client(&name, &pool).await?;

    match client.health_check().await {
        Ok(_) => {
            let elapsed = started.elapsed();
            // Touch is best-effort — failure here doesn't change the
            // success the user just got from the upstream API.
            if let Err(err) = queries::touch_integration_last_used(&pool, &name).await {
                eprintln!("[integrations] touch last_used `{name}` falhou: {err}");
            }
            eprintln!(
                "[integrations] test `{name}` OK em {} ms",
                elapsed.as_millis()
            );
            Ok(TestIntegrationResult {
                ok: true,
                status: 200,
                elapsed_ms: elapsed.as_millis(),
                message: format!("Conexão OK ({} ms)", elapsed.as_millis()),
            })
        }
        Err(err) => {
            let elapsed = started.elapsed();
            eprintln!(
                "[integrations] test `{name}` falhou em {} ms: {err}",
                elapsed.as_millis()
            );
            Ok(TestIntegrationResult {
                ok: false,
                status: status_from_err(&err),
                elapsed_ms: elapsed.as_millis(),
                message: friendly_error(&err),
            })
        }
    }
}

/// Hard cap on the JSON returned to the chat — bigger payloads OOM
/// the bubble + cost tokens for nothing. Truncation appends a
/// `... [truncated]` marker so the orchestrator knows to ask for a
/// narrower endpoint or paginate.
const MAX_RESPONSE_BYTES: usize = 50 * 1024;

/// Real invocation: GET `<base_url>/<endpoint>` with optional query
/// params. Verifies the integration is enabled before firing the
/// request. Response JSON is serialized back to a String so the chat
/// router can drop it into the model context as-is. On success, bumps
/// `last_used_at`.
///
/// Logs a one-line timing summary to stderr (name, endpoint, elapsed,
/// payload size) — the api_key is NEVER part of the log message,
/// neither directly nor via reqwest's URL (`IntegrationError` from
/// http.rs scrubs URLs before stringifying).
#[tauri::command]
pub async fn call_integration(
    name: String,
    endpoint: String,
    query_params: Option<Vec<(String, String)>>,
    pool: State<'_, SqlitePool>,
) -> Result<String, String> {
    let started = Instant::now();
    let (row, client) = build_client(&name, &pool).await?;

    if row.enabled == 0 {
        return Err(format!("integration `{name}` está desabilitada"));
    }

    let value = match client
        .get(&endpoint, query_params.as_deref())
        .await
    {
        Ok(v) => v,
        Err(err) => {
            let elapsed = started.elapsed();
            eprintln!(
                "[integrations] call `{name} {endpoint}` falhou em {} ms: {err}",
                elapsed.as_millis()
            );
            return Err(friendly_error(&err));
        }
    };

    let json = serde_json::to_string(&value)
        .map_err(|e| format!("failed to serialize JSON: {e}"))?;
    let raw_len = json.len();
    let body = if raw_len > MAX_RESPONSE_BYTES {
        let prefix = take_byte_prefix(&json, MAX_RESPONSE_BYTES);
        format!(
            "{prefix}\n... [truncated; full response was {raw_len} bytes]"
        )
    } else {
        json
    };

    if let Err(err) = queries::touch_integration_last_used(&pool, &name).await {
        eprintln!("[integrations] touch last_used `{name}` falhou: {err}");
    }

    let elapsed = started.elapsed();
    eprintln!(
        "[integrations] call `{name} {endpoint}` OK em {} ms, {raw_len} bytes{}",
        elapsed.as_millis(),
        if raw_len > MAX_RESPONSE_BYTES {
            " (truncado)"
        } else {
            ""
        }
    );
    Ok(body)
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Resolve `name` → (DB row, ready-to-use `IntegrationClient`). The TOML
/// is the source-of-truth for the api_key + the full auth payload
/// (header_name, param_name); the SQLite row gives us `base_url` and
/// confirms the integration exists for this user.
async fn build_client(
    name: &str,
    pool: &SqlitePool,
) -> Result<(IntegrationRow, IntegrationClient), String> {
    let row = queries::get_integration_by_name(pool, name)
        .await?
        .ok_or_else(|| format!("integration `{name}` não encontrada"))?;
    let api_key = integrations::get_api_key(name)?
        .ok_or_else(|| format!("api_key ausente para `{name}` em config.toml"))?;
    let full = integrations::load_integrations()?
        .into_iter()
        .find(|i| i.name == name)
        .ok_or_else(|| format!("integration `{name}` não está no config.toml"))?;

    let auth = match full.auth_type {
        AuthType::Bearer => AuthConfig::Bearer(api_key),
        AuthType::Header { header_name } => AuthConfig::Header {
            name: header_name,
            value: api_key,
        },
        AuthType::Query { param_name } => AuthConfig::Query {
            param: param_name,
            value: api_key,
        },
    };

    let client = IntegrationClient::new(&row.base_url, auth)
        .map_err(|e| format!("falha ao criar HTTP client: {e}"))?;
    Ok((row, client))
}

/// Map an `IntegrationError` to an HTTP-ish status code for the
/// frontend toast. `0` means "didn't reach the server" (DNS, timeout,
/// parse) — the UI surfaces those distinctly from real upstream codes.
fn status_from_err(e: &IntegrationError) -> u16 {
    match e {
        IntegrationError::Server { status, .. } => *status,
        IntegrationError::Auth(_) => 401,
        IntegrationError::NotFound(_) => 404,
        IntegrationError::Timeout
        | IntegrationError::Network(_)
        | IntegrationError::Parse(_) => 0,
    }
}

/// Portuguese, user-actionable error messages. The internal `Display`
/// of `IntegrationError` is fine for logs but a bit terse for toasts.
fn friendly_error(e: &IntegrationError) -> String {
    match e {
        IntegrationError::Auth(_) => {
            "API key inválida ou sem permissão pra esse endpoint.".into()
        }
        IntegrationError::NotFound(_) => "Endpoint não encontrado (HTTP 404).".into(),
        IntegrationError::Timeout => "Timeout — a API não respondeu em 15s.".into(),
        IntegrationError::Network(msg) => format!("Falha de rede: {msg}"),
        IntegrationError::Server { status, body } => {
            if body.is_empty() {
                format!("Servidor retornou erro HTTP {status}.")
            } else {
                format!("Servidor retornou HTTP {status}: {body}")
            }
        }
        IntegrationError::Parse(_) => "Resposta da API não é JSON válido.".into(),
    }
}

/// Cut a UTF-8 string at byte index `max_bytes` rounded down to the
/// nearest char boundary, so `String` slicing never panics on a
/// multi-byte split.
fn take_byte_prefix(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn take_byte_prefix_keeps_short() {
        assert_eq!(take_byte_prefix("hello", 50), "hello");
    }

    #[test]
    fn take_byte_prefix_clips_at_char_boundary() {
        // 'á' is 2 bytes in UTF-8; cutting in the middle would panic.
        let s = "aá".repeat(40); // 120 bytes
        let cut = take_byte_prefix(&s, 51);
        // Result must be valid UTF-8 and at most 51 bytes.
        assert!(cut.len() <= 51);
        assert!(std::str::from_utf8(cut.as_bytes()).is_ok());
    }

    #[test]
    fn status_from_err_maps_categories() {
        assert_eq!(
            status_from_err(&IntegrationError::Auth("x".into())),
            401
        );
        assert_eq!(
            status_from_err(&IntegrationError::NotFound("x".into())),
            404
        );
        assert_eq!(status_from_err(&IntegrationError::Timeout), 0);
        assert_eq!(
            status_from_err(&IntegrationError::Network("x".into())),
            0
        );
        assert_eq!(
            status_from_err(&IntegrationError::Server {
                status: 502,
                body: String::new()
            }),
            502
        );
    }

    #[test]
    fn friendly_error_returns_portuguese_strings() {
        assert!(friendly_error(&IntegrationError::Timeout).contains("15s"));
        assert!(
            friendly_error(&IntegrationError::Auth("x".into())).contains("API key")
        );
        assert!(friendly_error(&IntegrationError::Server {
            status: 502,
            body: "bad gateway".into()
        })
        .contains("502"));
    }
}
