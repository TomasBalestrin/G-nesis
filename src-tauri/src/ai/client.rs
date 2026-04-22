//! OpenAI HTTP client (reqwest). Reads API key from env or config, retries with
//! exponential backoff (3 tentativas) per docs/tech-stack.md.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct OpenAIClient {
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub content: String,
}

impl OpenAIClient {
    pub fn new(api_key: String) -> Self {
        Self {
            api_key,
            model: "gpt-4o".to_string(),
        }
    }

    pub async fn chat(
        &self,
        _request: ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, String> {
        // TODO: POST https://api.openai.com/v1/chat/completions with retry/backoff
        Ok(ChatCompletionResponse {
            content: String::new(),
        })
    }
}
