//! App configuration. Persisted at `~/.genesis/config.toml`.
//!
//! Precedence: config file wins over env vars for `openai_api_key` (users
//! edit Settings and expect that to take effect even if a stale env var is
//! exported in their shell). Env vars only fill values the config leaves
//! empty. `GENESIS_SKILLS_DIR` still overrides the file since skill path is
//! more of a dev knob than a credential.
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

    #[serde(default = "default_workflows_dir")]
    pub workflows_dir: String,

    #[serde(default = "default_db_path")]
    pub db_path: String,

    /// Optional Anthropic API key. Empty/absent disables the
    /// claude-* model entries in the chat router. Same precedence rules
    /// as `openai_api_key`: file wins, env (`ANTHROPIC_API_KEY`) is
    /// fallback only.
    #[serde(default)]
    pub anthropic_api_key: Option<String>,

    /// Optional explicit path to the `claude` CLI. When set, the
    /// claude-code channel skips PATH discovery and uses this binary
    /// directly — useful when the user has a non-standard install
    /// (asdf, rbenv-style version managers) that the default lookup misses.
    #[serde(default)]
    pub claude_cli_path: Option<String>,

    /// Web-search providers consumidos pelo módulo `agents` quando o
    /// agente tem `can_web_search() == true`. Section opcional —
    /// quando ausente, agentes que pedirem `web_search` recebem erro
    /// user-actionable e o loop continua sem o resultado. Hoje só
    /// Brave Search está suportado (B2 — 2k queries/mês grátis).
    #[serde(default)]
    pub search: SearchConfig,

    /// True when no API key is configured — the UI should show the setup screen.
    /// Never serialized: recomputed after every load from the final merged state.
    #[serde(default, skip_deserializing)]
    pub needs_setup: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchConfig {
    /// Brave Search API token. Mesma política das outras keys: file
    /// ganha do env (`BRAVE_API_KEY`); env só preenche quando o
    /// arquivo está vazio.
    #[serde(default)]
    pub brave_api_key: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            openai_api_key: None,
            skills_dir: default_skills_dir(),
            workflows_dir: default_workflows_dir(),
            db_path: default_db_path(),
            anthropic_api_key: None,
            claude_cli_path: None,
            search: SearchConfig::default(),
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

fn default_workflows_dir() -> String {
    config_dir()
        .join("workflows")
        .to_string_lossy()
        .into_owned()
}

fn default_db_path() -> String {
    config_dir()
        .join("genesis.db")
        .to_string_lossy()
        .into_owned()
}

// ── load / save ─────────────────────────────────────────────────────────────

/// Load config with this precedence:
/// 1. `~/.genesis/config.toml` (wins for `openai_api_key`)
/// 2. Env fallback: `OPENAI_API_KEY` fills the key ONLY when the file is
///    empty; `GENESIS_SKILLS_DIR` overrides `skills_dir` either way
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
    ensure_dir(Path::new(&cfg.workflows_dir))?;

    Ok(cfg)
}

/// Persist `openai_api_key` + `skills_dir` to `~/.genesis/config.toml`, then
/// reload so env var overrides and `needs_setup` stay consistent.
///
/// `db_path` is not user-configurable here — it's always
/// `~/.genesis/genesis.db` to match the SQLite setup in `db::init_db`.
pub fn save_config(openai_api_key: Option<String>, skills_dir: String) -> Result<Config, String> {
    // Preserve fields the Settings UI doesn't expose yet — naive save would
    // silently wipe the user's TOML overrides.
    let preserved = read_config_file(&config_path()).ok();
    let preserved_claude_path = preserved.as_ref().and_then(|c| c.claude_cli_path.clone());
    let preserved_workflows_dir = preserved
        .as_ref()
        .map(|c| c.workflows_dir.clone())
        .filter(|d| !d.is_empty())
        .unwrap_or_else(default_workflows_dir);
    let preserved_anthropic_key = preserved.as_ref().and_then(|c| c.anthropic_api_key.clone());
    let preserved_search = preserved.map(|c| c.search).unwrap_or_default();

    let to_write = Config {
        openai_api_key: openai_api_key.filter(|k| !k.is_empty()),
        skills_dir,
        workflows_dir: preserved_workflows_dir,
        db_path: default_db_path(),
        anthropic_api_key: preserved_anthropic_key,
        claude_cli_path: preserved_claude_path,
        search: preserved_search,
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
        Ok(s) => toml::from_str(&s).map_err(|e| format!("invalid {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

fn apply_env_overrides(cfg: &mut Config) {
    // openai_api_key: env is only a FALLBACK — the saved config wins so that
    // editing Settings always takes effect, even with a stale shell-exported
    // OPENAI_API_KEY still around.
    if cfg
        .openai_api_key
        .as_deref()
        .map(str::is_empty)
        .unwrap_or(true)
    {
        if let Ok(k) = std::env::var("OPENAI_API_KEY") {
            if !k.is_empty() {
                cfg.openai_api_key = Some(k);
            }
        }
    }
    // anthropic_api_key: same fallback policy — env fills only when file is empty.
    if cfg
        .anthropic_api_key
        .as_deref()
        .map(str::is_empty)
        .unwrap_or(true)
    {
        if let Ok(k) = std::env::var("ANTHROPIC_API_KEY") {
            if !k.is_empty() {
                cfg.anthropic_api_key = Some(k);
            }
        }
    }
    // brave_api_key: mesma política — env só preenche quando o arquivo
    // está vazio. UI de Settings não expõe (B2 ainda não tem campo);
    // por hora user edita config.toml direto.
    if cfg
        .search
        .brave_api_key
        .as_deref()
        .map(str::is_empty)
        .unwrap_or(true)
    {
        if let Ok(k) = std::env::var("BRAVE_API_KEY") {
            if !k.is_empty() {
                cfg.search.brave_api_key = Some(k);
            }
        }
    }
    // skills_dir: env DOES override (dev knob, not a credential).
    if let Ok(d) = std::env::var("GENESIS_SKILLS_DIR") {
        if !d.is_empty() {
            cfg.skills_dir = d;
        }
    }
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("cannot create {}: {e}", path.display()))
}
