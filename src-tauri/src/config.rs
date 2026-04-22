//! App configuration. Persisted at `~/.genesis/config.toml`, overridable by
//! `OPENAI_API_KEY` and `GENESIS_SKILLS_DIR` env vars (env wins over file).
//!
//! Per docs/security.md, the API key is NEVER committed to source control —
//! the TOML lives in the user's home directory.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub openai_api_key: Option<String>,

    #[serde(default = "default_skills_dir")]
    pub skills_dir: String,

    #[serde(default = "default_db_path")]
    pub db_path: String,

    /// True when no API key is configured — the UI should show the setup screen.
    /// Never serialized: recomputed after every load from the final merged state.
    #[serde(default, skip_deserializing)]
    pub needs_setup: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            openai_api_key: None,
            skills_dir: default_skills_dir(),
            db_path: default_db_path(),
            needs_setup: true,
        }
    }
}

// ── paths ───────────────────────────────────────────────────────────────────

fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn config_dir() -> PathBuf {
    home_dir().join(".genesis")
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.toml")
}

fn default_skills_dir() -> String {
    config_dir().join("skills").to_string_lossy().into_owned()
}

fn default_db_path() -> String {
    config_dir().join("genesis.db").to_string_lossy().into_owned()
}

// ── load / save ─────────────────────────────────────────────────────────────

/// Load config with this precedence:
/// 1. `~/.genesis/config.toml` (if it exists)
/// 2. Overrides from `OPENAI_API_KEY` and `GENESIS_SKILLS_DIR` env vars
/// 3. Defaults
///
/// Also creates the skills directory if missing so skill listing doesn't fail
/// on first run.
pub fn load_config() -> Result<Config, String> {
    let mut cfg: Config = read_config_file(&config_path())?;

    apply_env_overrides(&mut cfg);

    cfg.needs_setup = cfg
        .openai_api_key
        .as_deref()
        .map(str::is_empty)
        .unwrap_or(true);

    ensure_dir(Path::new(&cfg.skills_dir))?;

    Ok(cfg)
}

/// Persist `openai_api_key` + `skills_dir` to `~/.genesis/config.toml`, then
/// reload so env var overrides and `needs_setup` stay consistent.
///
/// `db_path` is not user-configurable here — it's always
/// `~/.genesis/genesis.db` to match the SQLite setup in `db::init_db`.
pub fn save_config(openai_api_key: Option<String>, skills_dir: String) -> Result<Config, String> {
    let to_write = Config {
        openai_api_key: openai_api_key.filter(|k| !k.is_empty()),
        skills_dir,
        db_path: default_db_path(),
        needs_setup: false,
    };

    ensure_dir(&config_dir())?;

    let toml_str = toml::to_string_pretty(&to_write)
        .map_err(|e| format!("failed to serialize config: {e}"))?;

    fs::write(config_path(), toml_str)
        .map_err(|e| format!("failed to write {}: {e}", config_path().display()))?;

    load_config()
}

// ── internals ───────────────────────────────────────────────────────────────

fn read_config_file(path: &Path) -> Result<Config, String> {
    match fs::read_to_string(path) {
        Ok(s) => toml::from_str(&s)
            .map_err(|e| format!("invalid {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

fn apply_env_overrides(cfg: &mut Config) {
    if let Ok(k) = std::env::var("OPENAI_API_KEY") {
        if !k.is_empty() {
            cfg.openai_api_key = Some(k);
        }
    }
    if let Ok(d) = std::env::var("GENESIS_SKILLS_DIR") {
        if !d.is_empty() {
            cfg.skills_dir = d;
        }
    }
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|e| format!("cannot create {}: {e}", path.display()))
}
