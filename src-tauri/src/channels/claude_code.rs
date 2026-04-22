//! Claude Code CLI channel: spawns `claude -p "<prompt>"` and parses JSON output.
//!
//! Placeholder trait impl — real spawn + JSON parsing lives in E2.

use async_trait::async_trait;

use crate::channels::{Channel, ChannelError, ChannelInput, ChannelOutput};

pub struct ClaudeCodeChannel;

impl ClaudeCodeChannel {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ClaudeCodeChannel {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Channel for ClaudeCodeChannel {
    fn name(&self) -> &'static str {
        "claude-code"
    }

    async fn execute(&self, _input: ChannelInput) -> Result<ChannelOutput, ChannelError> {
        // TODO(channel-claude-code): spawn `claude -p` with JSON output.
        Ok(ChannelOutput::default())
    }
}
