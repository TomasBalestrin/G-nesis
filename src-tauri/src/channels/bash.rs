//! Bash/shell channel: spawns arbitrary shell commands with captured I/O.
//! NEVER build commands by string interpolation — use args arrays (see CLAUDE.md NÃO Fazer).

use crate::channels::{Channel, ChannelError, ChannelInput, ChannelOutput};

pub struct BashChannel;

impl BashChannel {
    pub fn new() -> Self {
        Self
    }

    pub async fn execute(
        &self,
        _input: ChannelInput,
    ) -> Result<ChannelOutput, ChannelError> {
        // TODO: Command::new with args array, capture stdout/stderr/exit_code
        Ok(ChannelOutput::default())
    }
}

impl Default for BashChannel {
    fn default() -> Self {
        Self::new()
    }
}

impl Channel for BashChannel {
    fn name(&self) -> &'static str {
        "bash"
    }
}
