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

use std::time::Instant;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::db::models::IntegrationRow;
use crate::db::queries;
use crate::integrations::{
    self, AuthConfig, AuthType, HealthStatus, Integration, IntegrationClient,
};

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

/// Register a new integration. Wizard-simplified IPC: caller passes
/// only the 4 essentials — `name`, `base_url`, `api_key`, optional
/// `spec_content`. Auth defaults to Bearer (the common case);
/// integrations with header / query auth need to be configured by
/// editing `~/.genesis/config.toml` directly for now. `display_name`
/// is derived by capitalizing the first letter of `name`.
///
/// Order of writes (best-effort consistency on failure):
///   1. spec file (optional) → `~/.genesis/integrations/<name>.md`
///      via `specs::save_spec`.
///   2. config.toml — saves auth payload + api_key.
///   3. SQLite — inserts metadata row (`spec_file = "<name>.md"`).
#[tauri::command]
pub async fn add_integration(
    name: String,
    base_url: String,
    api_key: String,
    spec_content: Option<String>,
    pool: State<'_, SqlitePool>,
) -> Result<IntegrationRow, String> {
    let name = name.trim().to_string();
    let base_url = base_url.trim().to_string();
    validate_slug(&name)?;
    validate_https_url(&base_url)?;
    if api_key.trim().is_empty() {
        return Err("api_key não pode ser vazio".into());
    }
    if queries::get_integration_by_name(&pool, &name)
        .await?
        .is_some()
    {
        return Err(format!("integration `{name}` já existe"));
    }

    let display_name = capitalize_first(&name);
    let auth_type = AuthType::Bearer;
    let spec_file = format!("{name}.md");

    if let Some(content) = spec_content.as_deref() {
        integrations::save_spec(&name, content)?;
    }

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
        auth_type: "bearer".to_string(),
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

/// Capitalize só o primeiro caractere ASCII, mantém o resto. Slugs
/// lowercase virando display names: "perpetuohq" → "Perpetuohq",
/// "my-api" → "My-api". Sufficient pra label automático sem heurística
/// de title-case que erraria em nomes técnicos.
fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
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

    let spec_file = format!("{name}.md");
    if let Some(content) = spec_content.as_deref() {
        integrations::save_spec(&name, content)?;
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

/// Idempotent best-effort removal — limpa **todos** os 3 storages em
/// que uma integration vive, na ordem files → TOML → SQLite (do menos
/// pro mais autoritativo). Cada etapa que falhar é logada em stderr
/// mas NÃO bloqueia as próximas — a meta é que o usuário consiga
/// re-criar com o mesmo nome mesmo se um dos artefatos ficou trancado
/// (permissão, FS read-only, etc.). Só erro de SQLite (o último passo)
/// vira `Err` — aí o row ainda está lá pra retry.
#[tauri::command]
pub async fn remove_integration(
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    let Some(row) = queries::get_integration_by_name(&pool, &name).await? else {
        return Ok(());
    };

    // 1) Spec file (.md — convenção pós-wizard).
    if let Err(err) = integrations::delete_spec(&name) {
        eprintln!("[integrations] remove `{name}`: delete_spec falhou: {err}");
    }
    // 1a) Orphan .yaml de antes do wizard (A3 inline write_spec_file).
    //     Best-effort: arquivo pode não existir (caso normal pós-wizard).
    let yaml_orphan = integrations::specs_dir().join(format!("{name}.yaml"));
    if yaml_orphan.exists() {
        if let Err(err) = std::fs::remove_file(&yaml_orphan) {
            eprintln!(
                "[integrations] remove `{name}`: cleanup .yaml órfão em {} falhou: {err}",
                yaml_orphan.display()
            );
        }
    }

    // 2) Bloco [integrations.<name>] do config.toml (inclui api_key).
    if let Err(err) = integrations::remove_integration(&name) {
        eprintln!(
            "[integrations] remove `{name}`: limpeza do config.toml falhou: {err}"
        );
    }

    // 3) SQLite (ÚLTIMO — se algo acima falhou, o row ainda está lá
    //    pra ser retentado; quando este passo falha, propagamos Err
    //    pro frontend re-tentar).
    queries::delete_integration(&pool, &row.id).await?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct TestIntegrationResult {
    /// 4-state outcome (Connected / AuthFailed / ServerReachable /
    /// Unreachable). Frontend wizard reads this directly to decide
    /// whether to advance to step 2, show "API key inválida" toast, or
    /// "Não foi possível conectar". Discriminated string via serde
    /// (snake_case): "connected" | "auth_failed" | "server_reachable"
    /// | "unreachable".
    pub health: HealthStatus,
    pub elapsed_ms: u128,
    /// Convenience boolean — `true` for Connected | ServerReachable
    /// (server is up, can advance), `false` otherwise. Kept for
    /// pre-existing callers that branched on `.ok` (IntegrationsSection
    /// card "Testar" button) — they keep working without reading the
    /// new `health` field.
    pub ok: bool,
    /// PT-BR human label paired with `health`. Pre-existing callers
    /// continue to use this; new wizard prefers the typed `health` enum.
    pub message: String,
}

/// Smoke-test an integration: lookup row + key, build IntegrationClient,
/// run `health_check()`. On any reachable outcome (Connected,
/// AuthFailed, ServerReachable) bumps `last_used_at` — the integration
/// IS in active use even if the key turned out invalid. `Err` is
/// reserved for config-level problems the user must fix in Settings
/// before retrying (integration not found, api_key ausente).
#[tauri::command]
pub async fn test_integration(
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<TestIntegrationResult, String> {
    let started = Instant::now();
    let (_row, client) = build_client(&name, &pool).await?;

    let health = client.health_check().await;
    let elapsed = started.elapsed();

    if let Err(err) = queries::touch_integration_last_used(&pool, &name).await {
        eprintln!("[integrations] touch last_used `{name}` falhou: {err}");
    }
    eprintln!(
        "[integrations] test `{name}` → {health:?} em {} ms",
        elapsed.as_millis()
    );

    let (ok, message) = match health {
        HealthStatus::Connected => (true, format!("Conectado! ({} ms)", elapsed.as_millis())),
        HealthStatus::AuthFailed => (false, "API key inválida.".into()),
        HealthStatus::ServerReachable => (
            true,
            "Servidor responde — endpoints serão validados no primeiro uso.".into(),
        ),
        HealthStatus::Unreachable => {
            (false, "Não foi possível conectar. Verifique a URL.".into())
        }
    };

    Ok(TestIntegrationResult {
        health,
        elapsed_ms: elapsed.as_millis(),
        ok,
        message,
    })
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
            // IntegrationError::Display já é PT-BR amigável (F2).
            return Err(err.to_string());
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

// ── input validation ────────────────────────────────────────────────────────

/// Slug rules pro `name` (handle do `@`-mention): primeiro char
/// alfanumérico, depois letras minúsculas / dígitos / hífens. Espelha
/// a regex que o frontend AddIntegrationModal usa — defesa em profundidade.
fn validate_slug(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("nome não pode ser vazio".into());
    }
    let first = name.chars().next().unwrap();
    if !(first.is_ascii_alphanumeric() && first.is_ascii_lowercase()
        || first.is_ascii_digit())
    {
        return Err(format!(
            "nome inválido: `{name}` precisa começar com letra minúscula ou dígito"
        ));
    }
    let valid = name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if !valid {
        return Err(format!(
            "nome inválido: `{name}` aceita só letras minúsculas, dígitos e hífens"
        ));
    }
    Ok(())
}

/// `base_url` precisa ser absoluto e começar com `https://` (ou `http://`
/// pra dev local). Match com o frontend AddIntegrationModal — backend
/// rejeita o resto pra evitar storage de URLs malformadas que iam
/// quebrar o IntegrationClient depois.
fn validate_https_url(url: &str) -> Result<(), String> {
    if url.is_empty() {
        return Err("base_url não pode ser vazia".into());
    }
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!(
            "base_url inválida: `{url}` precisa começar com https:// (http:// só pra dev)"
        ));
    }
    // Sanity: garante que tem hostname depois do protocolo.
    let after_proto = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or("");
    if after_proto.trim().is_empty() || after_proto.starts_with('/') {
        return Err(format!("base_url inválida: `{url}` sem hostname"));
    }
    Ok(())
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
    fn capitalize_first_handles_common_cases() {
        assert_eq!(capitalize_first("github"), "Github");
        assert_eq!(capitalize_first("perpetuohq"), "Perpetuohq");
        assert_eq!(capitalize_first("my-api"), "My-api");
        assert_eq!(capitalize_first(""), "");
        assert_eq!(capitalize_first("a"), "A");
    }

    #[test]
    fn validate_slug_accepts_lowercase_alnum_hyphen() {
        assert!(validate_slug("github").is_ok());
        assert!(validate_slug("perpetuohq").is_ok());
        assert!(validate_slug("my-api-v2").is_ok());
        assert!(validate_slug("api2").is_ok());
        assert!(validate_slug("0nine").is_ok());
    }

    #[test]
    fn validate_slug_rejects_invalid() {
        assert!(validate_slug("").is_err());
        assert!(validate_slug("GitHub").is_err()); // uppercase
        assert!(validate_slug("-leading").is_err()); // hyphen first
        assert!(validate_slug("inv@lid").is_err()); // special char
        assert!(validate_slug("with space").is_err());
        assert!(validate_slug("under_score").is_err());
    }

    #[test]
    fn validate_https_url_accepts_https_and_http() {
        assert!(validate_https_url("https://api.github.com").is_ok());
        assert!(validate_https_url("https://api.github.com/v3").is_ok());
        assert!(validate_https_url("http://localhost:8080").is_ok());
    }

    #[test]
    fn validate_https_url_rejects_invalid() {
        assert!(validate_https_url("").is_err());
        assert!(validate_https_url("api.github.com").is_err()); // sem protocol
        assert!(validate_https_url("ftp://x").is_err());
        assert!(validate_https_url("https://").is_err()); // sem hostname
        assert!(validate_https_url("https:///path").is_err()); // sem hostname
    }
}
