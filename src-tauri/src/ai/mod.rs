//! AI integration. Provides a unified `AiClient` over OpenAI + Anthropic
//! and the static model catalog the chat router dispatches against.

pub mod client;
pub mod models;
pub mod prompts;
