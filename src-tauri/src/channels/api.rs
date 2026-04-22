//! HTTP API channel: performs HTTP requests via reqwest and returns status + body.

use crate::channels::{Channel, ChannelError, ChannelInput, ChannelOutput};

pub struct ApiChannel;

impl ApiChannel {
    pub fn new() -> Self {
        Self
    }

    pub async fn execute(
        &self,
        _input: ChannelInput,
    ) -> Result<ChannelOutput, ChannelError> {
        // TODO: reqwest HTTP request, capture status + body
        Ok(ChannelOutput::default())
    }
}

impl Default for ApiChannel {
    fn default() -> Self {
        Self::new()
    }
}

impl Channel for ApiChannel {
    fn name(&self) -> &'static str {
        "api"
    }
}
