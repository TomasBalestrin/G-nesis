//! OpenAI chat completions client.
//!
//! Implements the retry/backoff policy from docs/PRD.md §5: 3 tentativas com
//! delays 1s/2s/4s para 429 e 5xx. 401 aborta imediatamente (key inválida não
//! melhora com retry). Timeout de 30s por requisição (docs/security.md §6).

use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

const DEFAULT_MODEL: &str = "gpt-4o";
const COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_SECS: u64 = 30;
const MAX_RETRIES: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug)]
pub enum OpenAIError {
    MissingApiKey,
    Unauthorized,
    RateLimited,
    ServerError(u16),
    Timeout,
    Network(String),
    Decode(String),
    EmptyResponse,
    BadRequest(String),
}

impl OpenAIError {
    fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::RateLimited | Self::ServerError(_) | Self::Timeout | Self::Network(_)
        )
    }

    /// Human-readable message safe to show the user (no key leakage).
    pub fn user_message(&self) -> String {
        match self {
            Self::MissingApiKey => {
                "OPENAI_API_KEY não configurada. Abra Settings e cole sua key.".into()
            }
            Self::Unauthorized => {
                "OpenAI API key inválida ou sem acesso. Verifique em Settings.".into()
            }
            Self::RateLimited => {
                "Rate limit da OpenAI excedido. Tente novamente em alguns segundos.".into()
            }
            Self::ServerError(code) => {
                format!("OpenAI API indisponível ({code}). Tente novamente mais tarde.")
            }
            Self::Timeout => "Timeout ao chamar OpenAI (30s). Verifique sua conexão.".into(),
            Self::Network(msg) => format!("Erro de rede ao chamar OpenAI: {msg}"),
            Self::Decode(msg) => format!("Falha ao decodificar resposta da OpenAI: {msg}"),
            Self::EmptyResponse => "OpenAI retornou resposta vazia.".into(),
            Self::BadRequest(msg) => format!("Erro na requisição à OpenAI: {msg}"),
        }
    }
}

impl std::fmt::Display for OpenAIError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.user_message())
    }
}

impl std::error::Error for OpenAIError {}

pub struct OpenAIClient {
    client: Client,
    api_key: String,
    model: String,
}

impl OpenAIClient {
    pub fn new(api_key: String) -> Result<Self, OpenAIError> {
        if api_key.trim().is_empty() {
            return Err(OpenAIError::MissingApiKey);
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(TIMEOUT_SECS))
            .build()
            .map_err(|e| OpenAIError::Network(e.to_string()))?;
        Ok(Self {
            client,
            api_key,
            model: DEFAULT_MODEL.to_string(),
        })
    }

    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    /// Send a chat completion with an optional system prompt + conversation history.
    /// Applies retry/backoff on retryable errors (429, 5xx, timeout, network).
    pub async fn chat_completion(
        &self,
        system: &str,
        history: &[Message],
    ) -> Result<String, OpenAIError> {
        let mut messages: Vec<Message> = Vec::with_capacity(history.len() + 1);
        if !system.is_empty() {
            messages.push(Message {
                role: "system".to_string(),
                content: system.to_string(),
            });
        }
        messages.extend_from_slice(history);

        let body = ChatRequest {
            model: &self.model,
            messages: &messages,
        };

        let mut last_err: Option<OpenAIError> = None;
        for attempt in 0..MAX_RETRIES {
            match self.send_once(&body).await {
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
        Err(last_err.unwrap_or(OpenAIError::EmptyResponse))
    }

    async fn send_once(&self, body: &ChatRequest<'_>) -> Result<String, OpenAIError> {
        let resp = self
            .client
            .post(COMPLETIONS_URL)
            .bearer_auth(&self.api_key)
            .json(body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    OpenAIError::Timeout
                } else {
                    OpenAIError::Network(e.to_string())
                }
            })?;

        let status = resp.status();
        match status {
            StatusCode::OK => {
                let parsed: ChatResponse = resp
                    .json()
                    .await
                    .map_err(|e| OpenAIError::Decode(e.to_string()))?;
                parsed
                    .choices
                    .into_iter()
                    .next()
                    .map(|c| c.message.content)
                    .filter(|s| !s.trim().is_empty())
                    .ok_or(OpenAIError::EmptyResponse)
            }
            StatusCode::UNAUTHORIZED => Err(OpenAIError::Unauthorized),
            StatusCode::TOO_MANY_REQUESTS => Err(OpenAIError::RateLimited),
            code if code.is_server_error() => Err(OpenAIError::ServerError(code.as_u16())),
            code if code.is_client_error() => {
                let text = resp.text().await.unwrap_or_default();
                Err(OpenAIError::BadRequest(format!("http {code}: {text}")))
            }
            code => {
                let text = resp.text().await.unwrap_or_default();
                Err(OpenAIError::Network(format!("http {code}: {text}")))
            }
        }
    }
}

// ── request/response DTOs ───────────────────────────────────────────────────

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [Message],
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    message: ResponseMessage,
}

#[derive(Deserialize)]
struct ResponseMessage {
    content: String,
}
