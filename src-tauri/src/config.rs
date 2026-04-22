//! App configuration. Loaded from `~/.genesis/config.toml` + environment
//! variables (see docs/tech-stack.md §6).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub openai_api_key: Option<String>,
    pub skills_dir: String,
    pub db_path: String,
    pub logs_dir: String,
    pub default_project: Option<String>,
    pub theme: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            openai_api_key: None,
            skills_dir: "~/.genesis/skills".to_string(),
            db_path: "~/.genesis/genesis.db".to_string(),
            logs_dir: "~/.genesis/logs".to_string(),
            default_project: None,
            theme: "blue-dark".to_string(),
        }
    }
}

impl Config {
    pub fn load() -> Result<Self, String> {
        // TODO: ler config.toml + merge com env vars (OPENAI_API_KEY)
        Ok(Self::default())
    }
}
