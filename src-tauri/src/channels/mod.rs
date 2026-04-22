//! Execution channels: Claude Code CLI, bash, HTTP API.
//!
//! Each step in a skill is dispatched to one of these channels via the
//! [`Channel`] trait. Output captures stdout/stderr + exit code so the
//! validator can inspect it.

pub mod api;
pub mod bash;
pub mod claude_code;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelInput {
    pub prompt: String,
    pub context: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

#[derive(Debug)]
pub enum ChannelError {
    Io(String),
    Timeout,
    Spawn(String),
}

impl std::fmt::Display for ChannelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(s) => write!(f, "channel io error: {s}"),
            Self::Timeout => write!(f, "channel timed out"),
            Self::Spawn(s) => write!(f, "failed to spawn channel process: {s}"),
        }
    }
}

impl std::error::Error for ChannelError {}

pub trait Channel: Send + Sync {
    fn name(&self) -> &'static str;
}
