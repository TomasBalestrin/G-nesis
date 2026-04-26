//! Static model catalog for the chat router.
//!
//! Each entry binds a model id (the wire string sent to the provider's API)
//! to:
//!   - a `Provider` discriminant so the router knows which client to build
//!   - the env var name we'd read as a fallback when config.toml lacks the key
//!   - capability flags (`supports_thinking`) and the soft `max_tokens` cap
//!     used when the provider's body requires it (Anthropic Messages API).
//!
//! Frontend exposes a curated subset via the ModelSelector dropdown; the
//! selection persists via `app_state.active_model_id` and chat.rs looks it
//! up here to dispatch.

use serde::{Deserialize, Serialize};

/// Discriminator for the AI provider behind a given model id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    OpenAi,
    Anthropic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    /// Wire id sent to the provider (`"gpt-4o"`, `"claude-sonnet-4-5"`, …).
    pub id: &'static str,
    /// Human-readable label for UIs that want it (the frontend has its own,
    /// but Settings/debug surfaces can pull from here).
    pub name: &'static str,
    pub provider: Provider,
    /// Env var name read as fallback when the config TOML key is empty.
    pub api_key_env: &'static str,
    /// True for models with extended thinking support. Frontend can surface
    /// a "thinking" indicator and the client may opt into the relevant
    /// request flags (Anthropic's `thinking` block).
    pub supports_thinking: bool,
    /// Hard cap for `max_tokens` in the request body. OpenAI ignores it
    /// (we omit the field), but Anthropic Messages API requires it.
    pub max_tokens: u32,
}

const MODELS: &[ModelConfig] = &[
    ModelConfig {
        id: "gpt-4o",
        name: "GPT-4o",
        provider: Provider::OpenAi,
        api_key_env: "OPENAI_API_KEY",
        supports_thinking: false,
        max_tokens: 4096,
    },
    ModelConfig {
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        provider: Provider::OpenAi,
        api_key_env: "OPENAI_API_KEY",
        supports_thinking: false,
        max_tokens: 4096,
    },
    ModelConfig {
        id: "gpt-4-turbo",
        name: "GPT-4 Turbo",
        provider: Provider::OpenAi,
        api_key_env: "OPENAI_API_KEY",
        supports_thinking: false,
        max_tokens: 4096,
    },
    ModelConfig {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5",
        provider: Provider::Anthropic,
        api_key_env: "ANTHROPIC_API_KEY",
        supports_thinking: true,
        max_tokens: 8192,
    },
    ModelConfig {
        id: "claude-opus-4-1",
        name: "Claude Opus 4.1",
        provider: Provider::Anthropic,
        api_key_env: "ANTHROPIC_API_KEY",
        supports_thinking: true,
        max_tokens: 8192,
    },
];

/// Default model used when `app_state.active_model_id` is empty/unknown.
/// Stays in sync with the seed in migration 003.
pub const DEFAULT_MODEL_ID: &str = "gpt-4o";

pub fn all_models() -> &'static [ModelConfig] {
    MODELS
}

pub fn find_model(id: &str) -> Option<&'static ModelConfig> {
    MODELS.iter().find(|m| m.id == id)
}

/// Resolve the user's pick or fall back to the default. Empty string and
/// unknown ids both fall back so a stale `active_model_id` never breaks chat.
pub fn resolve_model(id: &str) -> &'static ModelConfig {
    find_model(id)
        .or_else(|| find_model(DEFAULT_MODEL_ID))
        .expect("DEFAULT_MODEL_ID must exist in MODELS")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_resolves() {
        let model = resolve_model(DEFAULT_MODEL_ID);
        assert_eq!(model.id, "gpt-4o");
        assert!(matches!(model.provider, Provider::OpenAi));
    }

    #[test]
    fn unknown_id_falls_back_to_default() {
        let model = resolve_model("nonexistent-model");
        assert_eq!(model.id, DEFAULT_MODEL_ID);
    }

    #[test]
    fn anthropic_models_are_listed() {
        assert!(MODELS
            .iter()
            .any(|m| matches!(m.provider, Provider::Anthropic)));
    }

    #[test]
    fn every_model_has_nonzero_max_tokens() {
        for m in MODELS {
            assert!(m.max_tokens > 0, "model {} has zero max_tokens", m.id);
        }
    }
}
