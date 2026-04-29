//! HTTP API channel.
//!
//! Maps skill step fields (method/url/headers/body) to a reqwest request and
//! returns the response as a [`ChannelOutput`] with `status_code`,
//! `duration_ms` and the body in `stdout`. Timeout comes from
//! `input.timeout_secs` (default 300s via [`DEFAULT_TIMEOUT_SECS`]) and
//! reqwest enforces it on the whole request lifecycle.
//!
//! `exit_code` is aliased to `0` on 2xx and `1` otherwise so validators
//! written against bash/claude-code (which use `exit_code == 0`) keep
//! working without special-casing api.

use std::time::{Duration, Instant};

use async_trait::async_trait;
use reqwest::{Client, Method};

use crate::channels::{Channel, ChannelError, ChannelInput, ChannelOutput, DEFAULT_TIMEOUT_SECS};

pub struct ApiChannel;

impl ApiChannel {
    pub fn new() -> Self {
        Self
    }

    fn parse_method(raw: Option<&str>) -> Result<Method, ChannelError> {
        let upper = raw.unwrap_or("GET").trim().to_uppercase();
        if upper.is_empty() {
            return Ok(Method::GET);
        }
        Method::from_bytes(upper.as_bytes())
            .map_err(|e| ChannelError::Spawn(format!("método HTTP inválido `{upper}`: {e}")))
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

    async fn execute(&self, input: ChannelInput) -> Result<ChannelOutput, ChannelError> {
        if input.command.trim().is_empty() {
            return Err(ChannelError::Spawn("URL vazia".into()));
        }

        let method = Self::parse_method(input.http_method.as_deref())?;

        let timeout = Duration::from_secs(input.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS));
        let client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|e| ChannelError::Spawn(format!("reqwest builder: {e}")))?;

        let mut req = client.request(method, &input.command);
        for (key, value) in &input.headers {
            req = req.header(key, value);
        }
        if let Some(body) = input.body.as_ref() {
            req = req.body(body.clone());
        }

        let started = Instant::now();
        let response = req.send().await.map_err(|e| {
            if e.is_timeout() {
                ChannelError::Timeout
            } else {
                ChannelError::Io(e.to_string())
            }
        })?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| ChannelError::Io(format!("falha ao ler corpo: {e}")))?;
        let duration_ms = started.elapsed().as_millis() as u64;

        let stderr = if status.is_success() {
            String::new()
        } else {
            format!(
                "HTTP {} {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or(""),
            )
        };

        Ok(ChannelOutput {
            stdout: body,
            stderr,
            exit_code: Some(if status.is_success() { 0 } else { 1 }),
            status_code: Some(status.as_u16()),
            duration_ms: Some(duration_ms),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn empty_url_rejected() {
        let err = ApiChannel::new()
            .execute(ChannelInput::default())
            .await
            .unwrap_err();
        assert!(matches!(err, ChannelError::Spawn(msg) if msg.contains("URL vazia")),);
    }

    #[tokio::test]
    async fn invalid_method_rejected() {
        let err = ApiChannel::new()
            .execute(ChannelInput {
                command: "https://example.com".into(),
                http_method: Some("BAD METHOD!".into()),
                ..Default::default()
            })
            .await
            .unwrap_err();
        assert!(matches!(err, ChannelError::Spawn(msg) if msg.to_lowercase().contains("método")),);
    }

    #[test]
    fn method_defaults_to_get_when_none() {
        assert_eq!(ApiChannel::parse_method(None).unwrap(), Method::GET);
        assert_eq!(ApiChannel::parse_method(Some("")).unwrap(), Method::GET);
    }

    #[test]
    fn method_case_insensitive() {
        assert_eq!(
            ApiChannel::parse_method(Some("post")).unwrap(),
            Method::POST
        );
        assert_eq!(
            ApiChannel::parse_method(Some("DELETE")).unwrap(),
            Method::DELETE
        );
        assert_eq!(
            ApiChannel::parse_method(Some(" patch ")).unwrap(),
            Method::PATCH
        );
    }
}
