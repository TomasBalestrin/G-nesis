//! Execution channels: Claude Code CLI, bash, HTTP API.
//!
//! A step in a skill is dispatched to one of these channels via the
//! [`Channel`] trait. Every implementation produces a [`ChannelOutput`] with
//! stdout/stderr/exit_code so the validator (docs/architecture.md §Validator)
//! can inspect it uniformly regardless of which channel ran.

pub mod api;
pub mod bash;
pub mod claude_code;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Default per-step timeout when the skill does not override it
/// (docs/security.md §3 "Timeout obrigatório por step (default 300s)").
pub const DEFAULT_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChannelInput {
    /// Channel-specific payload — a shell command for bash, a prompt for
    /// claude-code, a URL for api.
    pub command: String,
    /// Working directory; validated by the caller to exist.
    pub cwd: Option<String>,
    /// Per-step timeout (seconds). None → [`DEFAULT_TIMEOUT_SECS`].
    pub timeout_secs: Option<u64>,
    /// Extra environment variables to pass to child processes. The parent
    /// env is inherited; this list only adds/overrides.
    pub env: Vec<(String, String)>,
    /// Paths of files the channel should surface as context. Used by
    /// claude-code to prepend a "# Arquivos de contexto" block to the prompt
    /// so the model knows which files to Read. Bash/api ignore this.
    pub context_files: Vec<String>,
    /// HTTP method for the api channel (GET/POST/…). Defaults to GET when
    /// None. Ignored by bash/claude-code.
    pub http_method: Option<String>,
    /// HTTP headers as (key, value) pairs. Ignored by bash/claude-code.
    pub headers: Vec<(String, String)>,
    /// HTTP request body. Ignored by bash/claude-code.
    pub body: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChannelOutput {
    /// Primary output — stdout for bash/claude-code, response body for api.
    pub stdout: String,
    pub stderr: String,
    /// `None` when the process was terminated by a signal (e.g. killed after timeout).
    /// For api: `Some(0)` on 2xx, `Some(1)` otherwise, so validators that check
    /// `exit_code == 0` still work uniformly.
    pub exit_code: Option<i32>,
    /// HTTP status code for the api channel. None for bash/claude-code.
    pub status_code: Option<u16>,
    /// Wall-clock duration of the call in milliseconds. Currently populated
    /// by api; bash/claude-code leave it None (future polish).
    pub duration_ms: Option<u64>,
}

#[derive(Debug)]
pub enum ChannelError {
    /// Spawn failed (binary not found, permissions, malformed command, …).
    Spawn(String),
    /// I/O error after spawn (pipe closed, wait failed).
    Io(String),
    /// Child ran longer than the configured timeout.
    Timeout,
}

impl std::fmt::Display for ChannelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(msg) => write!(f, "falha ao spawnar processo: {msg}"),
            Self::Io(msg) => write!(f, "erro de I/O no canal: {msg}"),
            Self::Timeout => write!(f, "canal excedeu o timeout"),
        }
    }
}

impl std::error::Error for ChannelError {}

#[async_trait]
pub trait Channel: Send + Sync {
    fn name(&self) -> &'static str;
    async fn execute(&self, input: ChannelInput) -> Result<ChannelOutput, ChannelError>;
}
