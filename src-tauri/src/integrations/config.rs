//! TOML <-> Rust mapping for `[integrations.<name>]` entries.
//!
//! Layout in `~/.genesis/config.toml`:
//!
//! ```toml
//! [integrations.github]
//! display_name = "GitHub"
//! base_url = "https://api.github.com"
//! spec_file = "github.yaml"
//! enabled = true
//! api_key = "ghp_xxxxx"        # secret — never on the public struct
//! auth_type = { type = "bearer" }
//!
//! [integrations.slack]
//! display_name = "Slack"
//! base_url = "https://slack.com/api"
//! spec_file = "slack.yaml"
//! enabled = true
//! api_key = "xoxb-xxxxx"
//! auth_type = { type = "header", header_name = "Authorization" }
//! ```
//!
//! Writes are surgical: we read the file as an untyped `toml::Table`, replace
//! only the `[integrations]` sub-table, write back. That way none of the other
//! Config fields (openai_api_key, skills_dir, ...) get clobbered when we save
//! or remove a single integration entry.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config::{config_dir, config_path};

/// Where the API key gets injected when Genesis fires a request:
///   - `Bearer`  → `Authorization: Bearer <key>`
///   - `Header`  → `<header_name>: <key>` (raw value, no prefix)
///   - `Query`   → `?<param_name>=<key>`
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthType {
    Bearer,
    Header { header_name: String },
    Query { param_name: String },
}

/// One integration. `name` mirrors the TOML table key so callers can
/// pass an `Integration` around without holding a separate id alongside.
/// `api_key` is intentionally absent — read it via [`get_api_key`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Integration {
    pub name: String,
    pub display_name: String,
    pub base_url: String,
    pub auth_type: AuthType,
    pub spec_file: String,
    pub enabled: bool,
}

/// On-disk shape for a single `[integrations.<name>]` entry. Two
/// differences from the public `Integration`:
///   - no `name` field (it's the table key on disk)
///   - includes the secret `api_key` field
/// Kept private to this module so the secret can't leak via IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct IntegrationEntry {
    display_name: String,
    base_url: String,
    auth_type: AuthType,
    spec_file: String,
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default)]
    api_key: Option<String>,
}

fn default_enabled() -> bool {
    true
}

/// Subset of the config file we care about. Deserializing the whole
/// Config here would couple us to its layout; instead we just pull
/// `[integrations.*]` and ignore everything else.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct ConfigSlice {
    #[serde(default)]
    integrations: BTreeMap<String, IntegrationEntry>,
}

// ── public API ──────────────────────────────────────────────────────────────

/// Read every `[integrations.<name>]` entry into the public shape.
/// Sorted by name for deterministic UI ordering. Returns an empty vec
/// when the file is missing or has no `[integrations.*]` tables.
pub fn load_integrations() -> Result<Vec<Integration>, String> {
    let slice = read_slice()?;
    let mut out: Vec<Integration> = slice
        .integrations
        .into_iter()
        .map(|(name, e)| Integration {
            name,
            display_name: e.display_name,
            base_url: e.base_url,
            auth_type: e.auth_type,
            spec_file: e.spec_file,
            enabled: e.enabled,
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Pull the API key for an integration. `None` when the entry is
/// missing OR the entry exists with no `api_key` field set OR the
/// stored key is empty. Caller decides how to surface "missing key" —
/// usually as a config error before firing any request.
pub fn get_api_key(name: &str) -> Result<Option<String>, String> {
    let slice = read_slice()?;
    Ok(slice
        .integrations
        .get(name)
        .and_then(|e| e.api_key.clone())
        .filter(|k| !k.is_empty()))
}

/// Upsert one integration. The `api_key` argument is OPTIONAL:
///   - `Some(key)`  → write/replace the stored key.
///   - `None`       → preserve whatever key was already on disk.
/// Lets the caller edit metadata (rename, toggle enabled, swap auth)
/// without forcing the user to re-enter the secret.
pub fn save_integration(integration: Integration, api_key: Option<String>) -> Result<(), String> {
    let mut slice = read_slice()?;

    let preserved_key = slice
        .integrations
        .get(&integration.name)
        .and_then(|e| e.api_key.clone());

    let entry = IntegrationEntry {
        display_name: integration.display_name,
        base_url: integration.base_url,
        auth_type: integration.auth_type,
        spec_file: integration.spec_file,
        enabled: integration.enabled,
        api_key: api_key.or(preserved_key),
    };

    slice.integrations.insert(integration.name, entry);
    write_slice(&slice)
}

/// Delete an integration by name. Idempotent — a no-op (returns Ok)
/// when the integration doesn't exist.
pub fn remove_integration(name: &str) -> Result<(), String> {
    let mut slice = read_slice()?;
    if slice.integrations.remove(name).is_none() {
        return Ok(());
    }
    write_slice(&slice)
}

// ── internals ───────────────────────────────────────────────────────────────

fn read_slice() -> Result<ConfigSlice, String> {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(s) => toml::from_str(&s).map_err(|e| format!("invalid {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ConfigSlice::default()),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

/// Surgical write: parse the existing file as untyped TOML, replace
/// only the top-level `integrations` key, write back. Other keys
/// (openai_api_key, skills_dir, ...) survive untouched.
fn write_slice(slice: &ConfigSlice) -> Result<(), String> {
    let path = config_path();
    let existing = fs::read_to_string(&path).unwrap_or_default();

    let mut root: toml::Table = if existing.trim().is_empty() {
        toml::Table::new()
    } else {
        existing
            .parse()
            .map_err(|e| format!("invalid {}: {e}", path.display()))?
    };

    let serialized = toml::to_string(slice)
        .map_err(|e| format!("failed to serialize integrations: {e}"))?;
    let parsed: toml::Table = serialized
        .parse()
        .map_err(|e| format!("internal: integrations slice round-trip: {e}"))?;

    match parsed.get("integrations") {
        Some(value) => {
            root.insert("integrations".to_string(), value.clone());
        }
        None => {
            root.remove("integrations");
        }
    }

    ensure_dir(&config_dir())?;

    let body = toml::to_string_pretty(&root)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    fs::write(&path, body).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("cannot create {}: {e}", path.display()))
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_type_round_trip_bearer() {
        let toml_in = r#"type = "bearer""#;
        let parsed: AuthType = toml::from_str(toml_in).unwrap();
        assert_eq!(parsed, AuthType::Bearer);
        let back = toml::to_string(&parsed).unwrap();
        let again: AuthType = toml::from_str(&back).unwrap();
        assert_eq!(again, AuthType::Bearer);
    }

    #[test]
    fn auth_type_round_trip_header() {
        let parsed: AuthType = toml::from_str(
            r#"type = "header"
header_name = "Authorization""#,
        )
        .unwrap();
        assert_eq!(
            parsed,
            AuthType::Header {
                header_name: "Authorization".into()
            }
        );
    }

    #[test]
    fn auth_type_round_trip_query() {
        let parsed: AuthType = toml::from_str(
            r#"type = "query"
param_name = "api_key""#,
        )
        .unwrap();
        assert_eq!(
            parsed,
            AuthType::Query {
                param_name: "api_key".into()
            }
        );
    }

    #[test]
    fn slice_default_is_empty() {
        let s = ConfigSlice::default();
        assert!(s.integrations.is_empty());
    }
}
