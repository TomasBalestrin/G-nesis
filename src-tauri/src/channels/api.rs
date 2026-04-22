//! HTTP API channel: performs HTTP requests via reqwest and returns status + body.
//!
//! Placeholder: real implementation will parse request spec (method, URL,
//! headers, body) from the skill's step payload.

use async_trait::async_trait;

use crate::channels::{Channel, ChannelError, ChannelInput, ChannelOutput};

pub struct ApiChannel;

impl ApiChannel {
    pub fn new() -> Self {
        Self
    }
}

impl Default for ApiChannel {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Channel for ApiChannel {
    fn name(&self) -> &'static str {
        "api"
    }

    async fn execute(&self, _input: ChannelInput) -> Result<ChannelOutput, ChannelError> {
        // TODO(channel-api): reqwest HTTP request from input.command spec.
        Ok(ChannelOutput::default())
    }
}
