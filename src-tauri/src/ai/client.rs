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

/// System prompt for `OpenAIClient::generate_knowledge_summary`. Lives here
/// (instead of `ai::prompts`) because the spec keeps the summarizer
/// self-contained on the client. Tweak with care — the structure (5
/// numbered topics, terceira pessoa, sem invenção) is what downstream
/// `build_system_prompt` flows expect.
const KNOWLEDGE_SUMMARY_SYSTEM_PROMPT: &str = "Você vai receber documentos sobre um funcionário de uma empresa. Esses documentos descrevem quem ele é, o que faz, seus processos de trabalho, ferramentas que usa, dores e rotinas.

Gere um resumo compacto (máximo 500 palavras) que cubra:
1. Quem é essa pessoa (nome, cargo, área, responsabilidades principais)
2. Processos que ela executa no dia a dia (listar cada um com tempo estimado se mencionado)
3. Ferramentas e softwares que usa
4. Onde perde mais tempo ou tem mais dificuldade (gargalos, tarefas manuais repetitivas)
5. O que já foi automatizado ou otimizado (se mencionado)

Escreva em terceira pessoa, direto ao ponto, sem introdução nem conclusão. Seja preciso. Não invente informações que não estão nos documentos.";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
    /// Tool calls emitted by an assistant turn — present when the model
    /// chose to invoke tools instead of (or alongside) plain text. Set
    /// only on assistant messages; serialized only when non-empty so
    /// existing single-turn calls round-trip unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    /// Set on `role: "tool"` messages — links the result back to the
    /// `tool_calls[i].id` from the assistant turn that requested it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Optional name field used by OpenAI for tool messages (mirrors the
    /// function name). Kept Option so it round-trips cleanly when
    /// absent — most assistant/user/system messages don't set it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Message {
    /// Helper for `role: "user"` messages — the workhorse of every
    /// caller that builds a one-off request from a string. Other
    /// fields default to None so existing call sites stay terse.
    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user".to_string(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    /// Helper for `role: "system"` messages.
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system".to_string(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    /// Helper for `role: "assistant"` plain-text messages (no tool
    /// calls). Use [`Message::assistant_with_tool_calls`] when the
    /// assistant turn invoked tools.
    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }
    }

    /// Helper for tool result messages. `tool_call_id` must match the
    /// id from the preceding assistant `tool_calls[i].id` — OpenAI
    /// rejects orphan tool results with a 400.
    pub fn tool_result(tool_call_id: String, content: impl Into<String>) -> Self {
        Self {
            role: "tool".to_string(),
            content: content.into(),
            tool_calls: None,
            tool_call_id: Some(tool_call_id),
            name: None,
        }
    }

    /// Helper for the assistant turn that requests tool execution. The
    /// content stays empty — OpenAI permits empty content when the
    /// turn carries tool_calls. The orchestrator loop then runs each
    /// call and feeds back tool_result messages.
    pub fn assistant_with_tool_calls(tool_calls: Vec<ToolCall>) -> Self {
        Self {
            role: "assistant".to_string(),
            content: String::new(),
            tool_calls: Some(tool_calls),
            tool_call_id: None,
            name: None,
        }
    }
}

// ── tool definitions + responses ────────────────────────────────────────────

/// OpenAI function-calling tool definition. `tool_type` is always
/// `"function"` today — the `type` discriminator exists at the API
/// level for forward compatibility with future tool kinds.
#[derive(Serialize, Clone, Debug)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: FunctionDefinition,
}

#[derive(Serialize, Clone, Debug)]
pub struct FunctionDefinition {
    pub name: String,
    pub description: String,
    /// JSON Schema describing the function's parameters. Built with
    /// `serde_json::json!` at the call site so each tool can declare
    /// its own shape inline — no per-tool struct required.
    pub parameters: serde_json::Value,
}

/// Single tool invocation requested by the assistant. `id` is opaque
/// (OpenAI-generated) and must round-trip back as
/// `tool_call_id` on the resulting `Message::tool_result(...)`.
#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Deserialize, Debug, Clone, Serialize)]
pub struct FunctionCall {
    pub name: String,
    /// JSON-stringified arguments — OpenAI doesn't pre-parse, so the
    /// dispatcher uses `serde_json::from_str` against a per-tool DTO.
    pub arguments: String,
}

/// Output of a single tool-aware completion turn. The loop in
/// `chat.rs::send_chat_message` reads `tool_calls` to decide whether
/// to dispatch tools and re-prompt, or to surface `content` to the
/// user as the final assistant turn.
#[derive(Debug, Clone, Default)]
pub struct ChatWithToolsOutput {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
}

// ── unified error ───────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum AiError {
    MissingApiKey { provider: Provider },
    Unauthorized { provider: Provider },
    RateLimited { provider: Provider },
    ServerError { provider: Provider, status: u16 },
    Timeout { provider: Provider },
    Network { provider: Provider, message: String },
    Decode { provider: Provider, message: String },
    EmptyResponse { provider: Provider },
    BadRequest { provider: Provider, message: String },
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
            Self::RateLimited { .. } => {
                format!("Rate limit da {label} excedido. Tente novamente em alguns segundos.")
            }
            Self::ServerError { status, .. } => {
                format!("{label} API indisponível ({status}). Tente novamente mais tarde.")
            }
            Self::Timeout { .. } => {
                format!("Timeout ao chamar {label} ({TIMEOUT_SECS}s). Verifique sua conexão.")
            }
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
                // 429: backoff flat de 3s — provedores tipicamente
                // querem que o cliente segure por alguns segundos
                // antes de tentar de novo, e exponencial agressivo
                // (1s/2s/4s) já estourou o budget em rajadas curtas.
                // Outros erros retryáveis (Network/Timeout/5xx)
                // mantêm exponencial 1s/2s/4s — eles costumam
                // resolver rápido se o problema for transiente.
                let delay_ms = match err {
                    AiError::RateLimited { .. } => 3000u64,
                    _ => 1000u64 << attempt,
                };
                last_err = Some(err);
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
            messages.push(Message::system(system));
        }
        messages.extend_from_slice(history);

        with_retry(Provider::OpenAi, || self.send_once(&messages)).await
    }

    /// Tool-aware completion. Sends `tools` to OpenAI and returns
    /// either the text reply (when the model finished) or the list of
    /// `tool_calls` to dispatch (when the model wants to invoke
    /// functions). Caller drives the loop — see
    /// `chat.rs::send_chat_message`. No retry/backoff at this layer
    /// since the loop itself is the retry surface and tool-call IDs
    /// are not safely replayable.
    pub async fn chat_completion_with_tools(
        &self,
        system: &str,
        history: &[Message],
        tools: &[ToolDefinition],
    ) -> Result<ChatWithToolsOutput, AiError> {
        let mut messages: Vec<Message> = Vec::with_capacity(history.len() + 1);
        if !system.is_empty() {
            messages.push(Message::system(system));
        }
        messages.extend_from_slice(history);

        self.send_once_with_tools(&messages, Some(tools)).await
    }

    /// Compress a concatenation of the user's knowledge-base markdown
    /// files into a single ~500 word digest. Always uses OpenAI on this
    /// client (Anthropic has its own path); the caller is expected to
    /// build the input by gluing every `KnowledgeFile.content` together
    /// (with separators). The returned text is what the system prompt
    /// builder injects so the assistant has context about the user.
    ///
    /// Mirrors `chat_completion` in transport / retry / error handling —
    /// only the prompt and call shape differ.
    pub async fn generate_knowledge_summary(&self, all_content: &str) -> Result<String, AiError> {
        let messages = vec![
            Message::system(KNOWLEDGE_SUMMARY_SYSTEM_PROMPT),
            Message::user(all_content),
        ];
        with_retry(Provider::OpenAi, || self.send_once(&messages)).await
    }

    /// Plain (no-tools) call — wrapper around the unified
    /// `send_once_with_tools` that drops `tool_calls` and returns just
    /// the text. Existing call sites (`chat_completion`,
    /// `generate_knowledge_summary`) keep their `Result<String, _>`
    /// signature untouched.
    async fn send_once(&self, messages: &[Message]) -> Result<String, AiError> {
        let out = self.send_once_with_tools(messages, None).await?;
        if out.content.trim().is_empty() {
            return Err(AiError::EmptyResponse {
                provider: Provider::OpenAi,
            });
        }
        Ok(out.content)
    }

    /// Single-shot completion that surfaces both the text content and
    /// any tool_calls. When `tools` is `None`, behaves exactly like a
    /// classic chat call (omits the `tools` field from the JSON so the
    /// API doesn't surprise older models).
    async fn send_once_with_tools(
        &self,
        messages: &[Message],
        tools: Option<&[ToolDefinition]>,
    ) -> Result<ChatWithToolsOutput, AiError> {
        let body = OpenAiChatRequest {
            model: &self.model,
            messages,
            tools,
            tool_choice: None,
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

async fn decode_openai(resp: reqwest::Response) -> Result<ChatWithToolsOutput, AiError> {
    let status = resp.status();
    let provider = Provider::OpenAi;
    match status {
        StatusCode::OK => {
            let parsed: OpenAiChatResponse = resp.json().await.map_err(|e| AiError::Decode {
                provider,
                message: e.to_string(),
            })?;
            let choice = parsed
                .choices
                .into_iter()
                .next()
                .ok_or(AiError::EmptyResponse { provider })?;
            let content = choice.message.content.unwrap_or_default();
            let tool_calls = choice.message.tool_calls;
            // Empty body AND no tool calls means the model returned
            // nothing usable — surface as EmptyResponse so callers can
            // retry. Tool-only responses are valid (content stays
            // empty by design when the model invokes functions).
            if content.trim().is_empty() && tool_calls.is_empty() {
                return Err(AiError::EmptyResponse { provider });
            }
            Ok(ChatWithToolsOutput {
                content,
                tool_calls,
            })
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
    /// Tool definitions when the caller is using function calling. Skipped
    /// from the JSON when None so plain chat requests look identical to
    /// the pre-tools shape — the API tolerates the field but older
    /// model snapshots do not.
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<&'a [ToolDefinition]>,
    /// `"auto"` (default), `"required"`, or a specific function spec.
    /// Left unset for now — `auto` is what every caller wants.
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<&'a str>,
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
    /// Optional because tool-only assistant turns omit `content`. The
    /// caller treats `None`/empty as "no text body" and falls through
    /// to checking `tool_calls`.
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<ToolCall>,
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
    pub fn new(
        api_key: String,
        model: impl Into<String>,
        max_tokens: u32,
    ) -> Result<Self, AiError> {
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

    async fn send_once(&self, system: &str, messages: &[Message]) -> Result<String, AiError> {
        let body = AnthropicMessagesRequest {
            model: &self.model,
            max_tokens: self.max_tokens,
            system: if system.is_empty() {
                None
            } else {
                Some(system)
            },
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
            system: if system.is_empty() {
                None
            } else {
                Some(system)
            },
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
                    if !thinking_emitted_complete
                        && block_kinds.get(&index).copied() == Some("thinking")
                    {
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
                        message: format!(
                            "anthropic stream error: {} ({})",
                            error.message, error.kind
                        ),
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
        thinking: if thinking.is_empty() {
            None
        } else {
            Some(thinking)
        },
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
                let key =
                    anthropic_key
                        .filter(|k| !k.is_empty())
                        .ok_or(AiError::MissingApiKey {
                            provider: Provider::Anthropic,
                        })?;
                let mut client = AnthropicClient::new(key.to_string(), model.id, model.max_tokens)?;
                if model.supports_thinking {
                    // Half of max_tokens, floored at 1024 so the thinking
                    // budget is meaningful even on small ceilings. Anthropic
                    // requires budget < max_tokens.
                    let budget = (model.max_tokens / 2)
                        .max(1024)
                        .min(model.max_tokens.saturating_sub(1));
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
            Message::system("ignore"),
            Message::user("oi"),
            Message::assistant("  "),
            Message::assistant("olá"),
        ];
        let out = normalize_for_anthropic(&history);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].role, "user");
        assert_eq!(out[1].content, "olá");
    }

    /// `OpenAiChatRequest` must serialize the `tools` field when
    /// present and skip it when None — older model snapshots reject
    /// the field even with an empty array.
    #[test]
    fn chat_request_serializes_tools_only_when_present() {
        let messages = [Message::user("oi")];
        let tools = [ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "noop".to_string(),
                description: "".to_string(),
                parameters: serde_json::json!({"type": "object"}),
            },
        }];

        let with_tools = OpenAiChatRequest {
            model: "gpt-4o",
            messages: &messages,
            tools: Some(&tools),
            tool_choice: None,
        };
        let json = serde_json::to_string(&with_tools).unwrap();
        assert!(json.contains("\"tools\":["), "expected tools array: {json}");
        assert!(json.contains("\"name\":\"noop\""));
        assert!(!json.contains("tool_choice"));

        let without = OpenAiChatRequest {
            model: "gpt-4o",
            messages: &messages,
            tools: None,
            tool_choice: None,
        };
        let json = serde_json::to_string(&without).unwrap();
        assert!(!json.contains("tools"), "tools must be skipped: {json}");
    }

    /// Response with tool_calls (no content) must decode and surface
    /// the calls so the dispatcher can run them. Mirrors the OpenAI
    /// 2024 response shape.
    #[test]
    fn response_with_tool_calls_deserializes() {
        let raw = r#"{
            "choices": [{
                "message": {
                    "tool_calls": [{
                        "id": "call_abc",
                        "type": "function",
                        "function": {
                            "name": "list_skills",
                            "arguments": "{}"
                        }
                    }]
                }
            }]
        }"#;
        let parsed: OpenAiChatResponse = serde_json::from_str(raw).unwrap();
        let msg = &parsed.choices[0].message;
        assert!(
            msg.content.as_deref().unwrap_or("").is_empty(),
            "tool-only turns omit content"
        );
        assert_eq!(msg.tool_calls.len(), 1);
        assert_eq!(msg.tool_calls[0].id, "call_abc");
        assert_eq!(msg.tool_calls[0].function.name, "list_skills");
    }

    /// Plain text response without tool_calls is the existing happy
    /// path — must still decode cleanly with the new struct shape.
    #[test]
    fn response_without_tool_calls_deserializes() {
        let raw = r#"{
            "choices": [{
                "message": {
                    "content": "olá"
                }
            }]
        }"#;
        let parsed: OpenAiChatResponse = serde_json::from_str(raw).unwrap();
        let msg = &parsed.choices[0].message;
        assert_eq!(msg.content.as_deref(), Some("olá"));
        assert!(msg.tool_calls.is_empty());
    }

    /// `Message::tool_result` must produce role="tool" and embed the
    /// id — OpenAI 400s on tool messages without a matching id.
    #[test]
    fn tool_result_helper_sets_role_and_id() {
        let m = Message::tool_result("call_xyz".into(), "ok");
        assert_eq!(m.role, "tool");
        assert_eq!(m.tool_call_id.as_deref(), Some("call_xyz"));
        assert_eq!(m.content, "ok");
        assert!(m.tool_calls.is_none());
    }
}
