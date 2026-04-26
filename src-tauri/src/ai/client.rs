//! Multi-provider chat completions client.
//!
//! Two concrete clients (`OpenAIClient`, `AnthropicClient`) share a retry/
//! backoff policy and an `AiError` taxonomy. The `AiClient` enum dispatches
//! `chat_completion` to the right one based on the model picked by the user
//! (chat.rs reads `active_model_id` from app_state and uses
//! `AiClient::for_model`).
//!
//! Retry policy (docs/PRD.md §5): 3 tentativas, delays 1s/2s/4s para 429 e
//! 5xx. 401 aborta imediatamente (chave inválida não melhora com retry).
//! Timeout de 30s por requisição (docs/security.md §6).

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

use crate::ai::models::{ModelConfig, Provider};

const DEFAULT_MODEL: &str = "gpt-4o";
const OPENAI_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const ANTHROPIC_MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const TIMEOUT_SECS: u64 = 30;
const MAX_RETRIES: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

// ── unified error ───────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum AiError {
    MissingApiKey {
        provider: Provider,
    },
    Unauthorized {
        provider: Provider,
    },
    RateLimited {
        provider: Provider,
    },
    ServerError {
        provider: Provider,
        status: u16,
    },
    Timeout {
        provider: Provider,
    },
    Network {
        provider: Provider,
        message: String,
    },
    Decode {
        provider: Provider,
        message: String,
    },
    EmptyResponse {
        provider: Provider,
    },
    BadRequest {
        provider: Provider,
        message: String,
    },
}

/// Backwards-compat alias — older code paths spell this `OpenAIError`. New
/// code should prefer `AiError`.
pub type OpenAIError = AiError;

fn provider_label(p: Provider) -> &'static str {
    match p {
        Provider::OpenAi => "OpenAI",
        Provider::Anthropic => "Anthropic",
    }
}

fn provider_settings_hint(p: Provider) -> &'static str {
    match p {
        Provider::OpenAi => "Abra Settings e cole sua OPENAI_API_KEY.",
        Provider::Anthropic => "Defina ANTHROPIC_API_KEY em ~/.genesis/config.toml.",
    }
}

impl AiError {
    fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::RateLimited { .. }
                | Self::ServerError { .. }
                | Self::Timeout { .. }
                | Self::Network { .. }
        )
    }

    /// Provider that originated the error — useful for surfacing the right
    /// settings hint or routing to a fallback.
    pub fn provider(&self) -> Provider {
        match self {
            Self::MissingApiKey { provider }
            | Self::Unauthorized { provider }
            | Self::RateLimited { provider }
            | Self::ServerError { provider, .. }
            | Self::Timeout { provider }
            | Self::Network { provider, .. }
            | Self::Decode { provider, .. }
            | Self::EmptyResponse { provider }
            | Self::BadRequest { provider, .. } => *provider,
        }
    }

    /// Human-readable message safe to show the user (no key leakage).
    pub fn user_message(&self) -> String {
        let label = provider_label(self.provider());
        match self {
            Self::MissingApiKey { provider } => format!(
                "API key da {label} não configurada. {}",
                provider_settings_hint(*provider)
            ),
            Self::Unauthorized { provider } => format!(
                "{label} API key inválida ou sem acesso. {}",
                provider_settings_hint(*provider)
            ),
            Self::RateLimited { .. } => format!(
                "Rate limit da {label} excedido. Tente novamente em alguns segundos."
            ),
            Self::ServerError { status, .. } => format!(
                "{label} API indisponível ({status}). Tente novamente mais tarde."
            ),
            Self::Timeout { .. } => format!(
                "Timeout ao chamar {label} ({TIMEOUT_SECS}s). Verifique sua conexão."
            ),
            Self::Network { message, .. } => {
                format!("Erro de rede ao chamar {label}: {message}")
            }
            Self::Decode { message, .. } => {
                format!("Falha ao decodificar resposta da {label}: {message}")
            }
            Self::EmptyResponse { .. } => format!("{label} retornou resposta vazia."),
            Self::BadRequest { message, .. } => {
                format!("Erro na requisição à {label}: {message}")
            }
        }
    }
}

impl std::fmt::Display for AiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.user_message())
    }
}

impl std::error::Error for AiError {}

// ── shared retry helper ─────────────────────────────────────────────────────

async fn with_retry<F, Fut>(provider: Provider, mut send: F) -> Result<String, AiError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<String, AiError>>,
{
    let mut last_err: Option<AiError> = None;
    for attempt in 0..MAX_RETRIES {
        match send().await {
            Ok(content) => return Ok(content),
            Err(err) if !err.is_retryable() => return Err(err),
            Err(err) if attempt + 1 == MAX_RETRIES => return Err(err),
            Err(err) => {
                last_err = Some(err);
                let delay_ms = 1000u64 << attempt; // 1s, 2s, 4s
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    }
    Err(last_err.unwrap_or(AiError::EmptyResponse { provider }))
}

fn http_client() -> Result<Client, AiError> {
    Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| AiError::Network {
            provider: Provider::OpenAi,
            message: e.to_string(),
        })
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

pub struct OpenAIClient {
    client: Client,
    api_key: String,
    model: String,
}

impl OpenAIClient {
    pub fn new(api_key: String) -> Result<Self, AiError> {
        if api_key.trim().is_empty() {
            return Err(AiError::MissingApiKey {
                provider: Provider::OpenAi,
            });
        }
        Ok(Self {
            client: http_client()?,
            api_key,
            model: DEFAULT_MODEL.to_string(),
        })
    }

    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    pub async fn chat_completion(
        &self,
        system: &str,
        history: &[Message],
    ) -> Result<String, AiError> {
        let mut messages: Vec<Message> = Vec::with_capacity(history.len() + 1);
        if !system.is_empty() {
            messages.push(Message {
                role: "system".to_string(),
                content: system.to_string(),
            });
        }
        messages.extend_from_slice(history);

        with_retry(Provider::OpenAi, || self.send_once(&messages)).await
    }

    async fn send_once(&self, messages: &[Message]) -> Result<String, AiError> {
        let body = OpenAiChatRequest {
            model: &self.model,
            messages,
        };

        let resp = self
            .client
            .post(OPENAI_COMPLETIONS_URL)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AiError::Timeout {
                        provider: Provider::OpenAi,
                    }
                } else {
                    AiError::Network {
                        provider: Provider::OpenAi,
                        message: e.to_string(),
                    }
                }
            })?;

        decode_openai(resp).await
    }
}

async fn decode_openai(resp: reqwest::Response) -> Result<String, AiError> {
    let status = resp.status();
    let provider = Provider::OpenAi;
    match status {
        StatusCode::OK => {
            let parsed: OpenAiChatResponse =
                resp.json().await.map_err(|e| AiError::Decode {
                    provider,
                    message: e.to_string(),
                })?;
            parsed
                .choices
                .into_iter()
                .next()
                .map(|c| c.message.content)
                .filter(|s| !s.trim().is_empty())
                .ok_or(AiError::EmptyResponse { provider })
        }
        StatusCode::UNAUTHORIZED => Err(AiError::Unauthorized { provider }),
        StatusCode::TOO_MANY_REQUESTS => Err(AiError::RateLimited { provider }),
        code if code.is_server_error() => Err(AiError::ServerError {
            provider,
            status: code.as_u16(),
        }),
        code if code.is_client_error() => {
            let text = resp.text().await.unwrap_or_default();
            Err(AiError::BadRequest {
                provider,
                message: format!("http {code}: {text}"),
            })
        }
        code => {
            let text = resp.text().await.unwrap_or_default();
            Err(AiError::Network {
                provider,
                message: format!("http {code}: {text}"),
            })
        }
    }
}

#[derive(Serialize)]
struct OpenAiChatRequest<'a> {
    model: &'a str,
    messages: &'a [Message],
}

#[derive(Deserialize)]
struct OpenAiChatResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Deserialize)]
struct OpenAiResponseMessage {
    content: String,
}

// ── Anthropic ───────────────────────────────────────────────────────────────

pub struct AnthropicClient {
    client: Client,
    api_key: String,
    model: String,
    max_tokens: u32,
    /// When `Some`, the streaming variant enables Anthropic's extended
    /// thinking mode with this token budget. `None` = thinking disabled
    /// (model doesn't support it or caller didn't opt in).
    thinking_budget: Option<u32>,
}

impl AnthropicClient {
    pub fn new(api_key: String, model: impl Into<String>, max_tokens: u32) -> Result<Self, AiError> {
        if api_key.trim().is_empty() {
            return Err(AiError::MissingApiKey {
                provider: Provider::Anthropic,
            });
        }
        Ok(Self {
            client: http_client()?,
            api_key,
            model: model.into(),
            max_tokens,
            thinking_budget: None,
        })
    }

    /// Enable extended thinking for streaming calls. `budget` must be
    /// strictly less than `max_tokens` (Anthropic 400s otherwise) — the
    /// caller is expected to pass `max_tokens / 2` or similar.
    pub fn with_thinking_budget(mut self, budget: u32) -> Self {
        self.thinking_budget = Some(budget);
        self
    }

    pub async fn chat_completion(
        &self,
        system: &str,
        history: &[Message],
    ) -> Result<String, AiError> {
        // Anthropic Messages API rejects "system" inside `messages` (it's a
        // top-level field) and disallows consecutive same-role turns. We
        // also skip empty assistants since OpenAI retries can leave those.
        let normalized = normalize_for_anthropic(history);
        with_retry(Provider::Anthropic, || self.send_once(system, &normalized)).await
    }

    async fn send_once(
        &self,
        system: &str,
        messages: &[Message],
    ) -> Result<String, AiError> {
        let body = AnthropicMessagesRequest {
            model: &self.model,
            max_tokens: self.max_tokens,
            system: if system.is_empty() { None } else { Some(system) },
            messages,
            stream: None,
            thinking: None,
        };

        let resp = self
            .client
            .post(ANTHROPIC_MESSAGES_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AiError::Timeout {
                        provider: Provider::Anthropic,
                    }
                } else {
                    AiError::Network {
                        provider: Provider::Anthropic,
                        message: e.to_string(),
                    }
                }
            })?;

        decode_anthropic(resp).await
    }

    /// Streaming variant. Issues a `stream: true` request and parses
    /// Anthropic's SSE protocol, routing thinking_delta events to `sink`
    /// and accumulating both thinking + text into the returned
    /// `ChatOutput`. Single-shot (no retry) since partial streams can't
    /// be safely replayed mid-token.
    pub async fn chat_completion_streaming(
        &self,
        system: &str,
        history: &[Message],
        sink: Option<&dyn ThinkingSink>,
    ) -> Result<ChatOutput, AiError> {
        let normalized = normalize_for_anthropic(history);

        let thinking_block = self.thinking_budget.map(|budget| AnthropicThinkingConfig {
            kind: "enabled",
            budget_tokens: budget,
        });

        let body = AnthropicMessagesRequest {
            model: &self.model,
            max_tokens: self.max_tokens,
            system: if system.is_empty() { None } else { Some(system) },
            messages: &normalized,
            stream: Some(true),
            thinking: thinking_block,
        };

        let resp = self
            .client
            .post(ANTHROPIC_MESSAGES_URL)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .json(&body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    AiError::Timeout {
                        provider: Provider::Anthropic,
                    }
                } else {
                    AiError::Network {
                        provider: Provider::Anthropic,
                        message: e.to_string(),
                    }
                }
            })?;

        // Status check before streaming — surface 401/429/5xx with the
        // same error taxonomy as the non-streaming path.
        let status = resp.status();
        let provider = Provider::Anthropic;
        match status {
            StatusCode::OK => {}
            StatusCode::UNAUTHORIZED => return Err(AiError::Unauthorized { provider }),
            StatusCode::TOO_MANY_REQUESTS => return Err(AiError::RateLimited { provider }),
            code if code.is_server_error() => {
                return Err(AiError::ServerError {
                    provider,
                    status: code.as_u16(),
                });
            }
            code if code.is_client_error() => {
                let text = resp.text().await.unwrap_or_default();
                return Err(AiError::BadRequest {
                    provider,
                    message: format!("http {code}: {text}"),
                });
            }
            code => {
                let text = resp.text().await.unwrap_or_default();
                return Err(AiError::Network {
                    provider,
                    message: format!("http {code}: {text}"),
                });
            }
        }

        consume_anthropic_stream(resp, sink).await
    }
}

/// Reads the Anthropic SSE stream chunk by chunk, parses events, and
/// returns the assembled `ChatOutput`. `sink` (if any) receives
/// `ThinkingDelta` for each `thinking_delta` and one `ThinkingComplete`
/// when the thinking content_block ends.
async fn consume_anthropic_stream(
    mut resp: reqwest::Response,
    sink: Option<&dyn ThinkingSink>,
) -> Result<ChatOutput, AiError> {
    let provider = Provider::Anthropic;
    let mut buf = SseBuffer::new();
    // Indexed by content_block index — Anthropic interleaves blocks.
    let mut block_kinds: std::collections::HashMap<u64, &'static str> =
        std::collections::HashMap::new();
    let mut content = String::new();
    let mut thinking = String::new();
    let mut thinking_emitted_complete = false;

    while let Some(chunk) = resp.chunk().await.map_err(|e| AiError::Network {
        provider,
        message: format!("stream chunk: {e}"),
    })? {
        let text = std::str::from_utf8(&chunk).map_err(|e| AiError::Decode {
            provider,
            message: e.to_string(),
        })?;

        for evt in buf.push(text) {
            // Only `data:` payloads carry useful info; `event:` is mirrored
            // by the JSON's `type` field so we lean on that.
            let parsed: AnthropicStreamEvent = match serde_json::from_str(&evt.data) {
                Ok(p) => p,
                // Skip unparseable lines; Anthropic occasionally adds new
                // event types we don't model. Don't crash on those.
                Err(_) => continue,
            };

            match parsed {
                AnthropicStreamEvent::ContentBlockStart {
                    index,
                    content_block,
                } => {
                    let kind = match content_block.kind.as_str() {
                        "thinking" => "thinking",
                        "text" => "text",
                        _ => "other",
                    };
                    block_kinds.insert(index, kind);
                }
                AnthropicStreamEvent::ContentBlockDelta { index, delta } => {
                    let kind = block_kinds.get(&index).copied().unwrap_or("other");
                    match (kind, delta) {
                        ("thinking", AnthropicDelta::ThinkingDelta { thinking: chunk }) => {
                            thinking.push_str(&chunk);
                            if let Some(sink) = sink {
                                sink.thinking_delta(&chunk);
                            }
                        }
                        ("text", AnthropicDelta::TextDelta { text }) => {
                            content.push_str(&text);
                        }
                        _ => {}
                    }
                }
                AnthropicStreamEvent::ContentBlockStop { index } => {
                    if !thinking_emitted_complete && block_kinds.get(&index).copied() == Some("thinking") {
                        thinking_emitted_complete = true;
                        let summary = derive_thinking_summary(&thinking);
                        if let Some(sink) = sink {
                            sink.thinking_complete(&summary);
                        }
                    }
                }
                AnthropicStreamEvent::MessageStop => break,
                AnthropicStreamEvent::Error { error } => {
                    return Err(AiError::BadRequest {
                        provider,
                        message: format!("anthropic stream error: {} ({})", error.message, error.kind),
                    });
                }
                _ => {}
            }
        }
    }

    if content.trim().is_empty() && thinking.trim().is_empty() {
        return Err(AiError::EmptyResponse { provider });
    }

    let thinking_summary = if thinking.is_empty() {
        None
    } else {
        Some(derive_thinking_summary(&thinking))
    };

    Ok(ChatOutput {
        content,
        thinking: if thinking.is_empty() { None } else { Some(thinking) },
        thinking_summary,
    })
}

/// One-line summary of a thinking block — first non-empty line, trimmed
/// and capped to ~80 chars. Used by the UI's collapsed-accordion header.
fn derive_thinking_summary(thinking: &str) -> String {
    let first = thinking
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("");
    let mut cap = String::new();
    for ch in first.chars().take(80) {
        cap.push(ch);
    }
    if first.chars().count() > 80 {
        cap.push('…');
    }
    cap
}

// ── streaming sink + outputs ────────────────────────────────────────────────

/// Output of a chat completion. `thinking` is `None` for providers/models
/// that don't expose reasoning.
#[derive(Debug, Clone, Default)]
pub struct ChatOutput {
    pub content: String,
    pub thinking: Option<String>,
    pub thinking_summary: Option<String>,
}

/// Receiver for live thinking events — implemented by chat.rs to forward
/// each delta to the WebView via `Emitter::emit`.
pub trait ThinkingSink: Send + Sync {
    fn thinking_delta(&self, delta: &str);
    fn thinking_complete(&self, summary: &str);
}

// ── SSE parser ──────────────────────────────────────────────────────────────

struct SseBuffer {
    buf: String,
}

struct SseEvent {
    #[allow(dead_code)]
    name: String,
    data: String,
}

impl SseBuffer {
    fn new() -> Self {
        Self { buf: String::new() }
    }

    /// Push raw bytes from the stream and return any complete events
    /// (those terminated by a blank line per the SSE spec).
    fn push(&mut self, chunk: &str) -> Vec<SseEvent> {
        self.buf.push_str(chunk);
        let mut out = Vec::new();
        while let Some(idx) = self.buf.find("\n\n") {
            let raw: String = self.buf.drain(..idx + 2).collect();
            if let Some(evt) = parse_sse_block(raw.trim_end_matches('\n')) {
                out.push(evt);
            }
        }
        out
    }
}

fn parse_sse_block(raw: &str) -> Option<SseEvent> {
    let mut name = String::new();
    let mut data = String::new();
    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("event: ") {
            name = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data: ") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest);
        }
        // Comments (lines starting with `:`) and other fields are ignored.
    }
    if data.is_empty() {
        return None;
    }
    Some(SseEvent { name, data })
}

// ── Anthropic stream event DTOs ─────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicStreamEvent {
    MessageStart,
    ContentBlockStart {
        index: u64,
        content_block: AnthropicStreamContentBlock,
    },
    ContentBlockDelta {
        index: u64,
        delta: AnthropicDelta,
    },
    ContentBlockStop {
        index: u64,
    },
    MessageDelta,
    MessageStop,
    Ping,
    Error {
        error: AnthropicStreamError,
    },
}

#[derive(Deserialize)]
struct AnthropicStreamContentBlock {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AnthropicDelta {
    TextDelta { text: String },
    ThinkingDelta { thinking: String },
    InputJsonDelta,
    SignatureDelta,
}

#[derive(Deserialize)]
struct AnthropicStreamError {
    #[serde(rename = "type")]
    kind: String,
    message: String,
}

fn normalize_for_anthropic(history: &[Message]) -> Vec<Message> {
    history
        .iter()
        .filter(|m| m.role != "system" && !m.content.trim().is_empty())
        .cloned()
        .collect()
}

async fn decode_anthropic(resp: reqwest::Response) -> Result<String, AiError> {
    let status = resp.status();
    let provider = Provider::Anthropic;
    match status {
        StatusCode::OK => {
            let parsed: AnthropicMessagesResponse =
                resp.json().await.map_err(|e| AiError::Decode {
                    provider,
                    message: e.to_string(),
                })?;
            parsed
                .content
                .into_iter()
                .filter_map(|block| match block {
                    AnthropicBlock::Text { text } => Some(text),
                })
                .reduce(|mut acc, next| {
                    acc.push_str(&next);
                    acc
                })
                .filter(|s| !s.trim().is_empty())
                .ok_or(AiError::EmptyResponse { provider })
        }
        StatusCode::UNAUTHORIZED => Err(AiError::Unauthorized { provider }),
        StatusCode::TOO_MANY_REQUESTS => Err(AiError::RateLimited { provider }),
        code if code.is_server_error() => Err(AiError::ServerError {
            provider,
            status: code.as_u16(),
        }),
        code if code.is_client_error() => {
            let text = resp.text().await.unwrap_or_default();
            Err(AiError::BadRequest {
                provider,
                message: format!("http {code}: {text}"),
            })
        }
        code => {
            let text = resp.text().await.unwrap_or_default();
            Err(AiError::Network {
                provider,
                message: format!("http {code}: {text}"),
            })
        }
    }
}

#[derive(Serialize)]
struct AnthropicMessagesRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<&'a str>,
    messages: &'a [Message],
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking: Option<AnthropicThinkingConfig>,
}

#[derive(Serialize)]
struct AnthropicThinkingConfig {
    #[serde(rename = "type")]
    kind: &'static str,
    budget_tokens: u32,
}

#[derive(Deserialize)]
struct AnthropicMessagesResponse {
    content: Vec<AnthropicBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum AnthropicBlock {
    Text { text: String },
}

// ── unified dispatch ────────────────────────────────────────────────────────

/// Provider-agnostic client. Built by the chat router from a `ModelConfig`
/// and the loaded `Config`; dispatches `chat_completion` to the right
/// concrete client.
pub enum AiClient {
    OpenAi(OpenAIClient),
    Anthropic(AnthropicClient),
}

impl AiClient {
    /// Build the right client for `model`. Reads the API key from the
    /// already-loaded config (caller-provided so we don't re-read the TOML
    /// on every chat turn).
    pub fn for_model(
        model: &ModelConfig,
        openai_key: Option<&str>,
        anthropic_key: Option<&str>,
    ) -> Result<Self, AiError> {
        match model.provider {
            Provider::OpenAi => {
                let key = openai_key
                    .filter(|k| !k.is_empty())
                    .ok_or(AiError::MissingApiKey {
                        provider: Provider::OpenAi,
                    })?;
                Ok(AiClient::OpenAi(
                    OpenAIClient::new(key.to_string())?.with_model(model.id),
                ))
            }
            Provider::Anthropic => {
                let key = anthropic_key
                    .filter(|k| !k.is_empty())
                    .ok_or(AiError::MissingApiKey {
                        provider: Provider::Anthropic,
                    })?;
                let mut client = AnthropicClient::new(
                    key.to_string(),
                    model.id,
                    model.max_tokens,
                )?;
                if model.supports_thinking {
                    // Half of max_tokens, floored at 1024 so the thinking
                    // budget is meaningful even on small ceilings. Anthropic
                    // requires budget < max_tokens.
                    let budget = (model.max_tokens / 2).max(1024).min(model.max_tokens.saturating_sub(1));
                    client = client.with_thinking_budget(budget);
                }
                Ok(AiClient::Anthropic(client))
            }
        }
    }

    pub async fn chat_completion(
        &self,
        system: &str,
        history: &[Message],
    ) -> Result<String, AiError> {
        match self {
            AiClient::OpenAi(c) => c.chat_completion(system, history).await,
            AiClient::Anthropic(c) => c.chat_completion(system, history).await,
        }
    }

    /// Streaming variant that surfaces thinking blocks via `sink`. OpenAI
    /// today doesn't expose reasoning via this client (o1/o3 hide it
    /// server-side), so for OpenAI this falls back to a non-streaming call
    /// with `thinking: None`. Anthropic uses real SSE streaming when the
    /// model supports thinking.
    pub async fn chat_completion_with_thinking(
        &self,
        system: &str,
        history: &[Message],
        sink: Option<&dyn ThinkingSink>,
    ) -> Result<ChatOutput, AiError> {
        match self {
            AiClient::OpenAi(c) => {
                let content = c.chat_completion(system, history).await?;
                Ok(ChatOutput {
                    content,
                    thinking: None,
                    thinking_summary: None,
                })
            }
            AiClient::Anthropic(c) => c.chat_completion_streaming(system, history, sink).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_key_produces_provider_specific_error() {
        let err = match OpenAIClient::new(String::new()) {
            Ok(_) => panic!("expected error for empty key"),
            Err(e) => e,
        };
        assert!(matches!(
            err,
            AiError::MissingApiKey {
                provider: Provider::OpenAi
            }
        ));

        let err = match AnthropicClient::new(String::new(), "claude-sonnet-4-5", 8192) {
            Ok(_) => panic!("expected error for empty key"),
            Err(e) => e,
        };
        assert!(matches!(
            err,
            AiError::MissingApiKey {
                provider: Provider::Anthropic
            }
        ));
    }

    #[test]
    fn user_message_includes_provider_name() {
        let err = AiError::Unauthorized {
            provider: Provider::Anthropic,
        };
        assert!(err.user_message().contains("Anthropic"));

        let err = AiError::RateLimited {
            provider: Provider::OpenAi,
        };
        assert!(err.user_message().contains("OpenAI"));
    }

    #[test]
    fn derive_thinking_summary_takes_first_line_capped() {
        let s = derive_thinking_summary("");
        assert!(s.is_empty());

        let s = derive_thinking_summary("\n\n  primeira linha real \nsegunda\n");
        assert_eq!(s, "primeira linha real");

        let long = "a".repeat(200);
        let s = derive_thinking_summary(&long);
        // 80 chars + ellipsis
        assert_eq!(s.chars().count(), 81);
        assert!(s.ends_with('…'));
    }

    #[test]
    fn sse_buffer_assembles_events_across_chunks() {
        let mut buf = SseBuffer::new();
        let evts = buf.push("event: foo\ndata: {\"a\":");
        assert!(evts.is_empty());

        let evts = buf.push("1}\n\nevent: bar\ndata: x\n\n");
        assert_eq!(evts.len(), 2);
        assert_eq!(evts[0].name, "foo");
        assert_eq!(evts[0].data, "{\"a\":1}");
        assert_eq!(evts[1].name, "bar");
        assert_eq!(evts[1].data, "x");
    }

    #[test]
    fn anthropic_client_with_thinking_budget_chains() {
        let c = match AnthropicClient::new("sk-ant-1234".into(), "claude-sonnet-4-5", 8192) {
            Ok(c) => c.with_thinking_budget(4000),
            Err(_) => panic!("constructor with non-empty key should succeed"),
        };
        assert_eq!(c.thinking_budget, Some(4000));
    }

    #[test]
    fn normalize_for_anthropic_strips_system_and_empty() {
        let history = vec![
            Message {
                role: "system".into(),
                content: "ignore".into(),
            },
            Message {
                role: "user".into(),
                content: "oi".into(),
            },
            Message {
                role: "assistant".into(),
                content: "  ".into(),
            },
            Message {
                role: "assistant".into(),
                content: "olá".into(),
            },
        ];
        let out = normalize_for_anthropic(&history);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "user");
        assert_eq!(out[1].content, "olá");
    }
}
