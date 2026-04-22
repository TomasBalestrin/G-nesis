//! Claude Code CLI channel: spawns `claude -p "<prompt>"` and parses JSON output.

use crate::channels::{Channel, ChannelError, ChannelInput, ChannelOutput};

pub struct ClaudeCodeChannel;

impl ClaudeCodeChannel {
    pub fn new() -> Self {
        Self
    }

    pub async fn execute(
        &self,
        _input: ChannelInput,
    ) -> Result<ChannelOutput, ChannelError> {
        // TODO: spawn `claude -p "prompt" --output-format json --allowedTools "Bash,Read,Edit"`
        Ok(ChannelOutput::default())
    }
}

impl Default for ClaudeCodeChannel {
    fn default() -> Self {
        Self::new()
    }
}

impl Channel for ClaudeCodeChannel {
    fn name(&self) -> &'static str {
        "claude-code"
    }
}
