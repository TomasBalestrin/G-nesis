//! Agentes internos — skills invisíveis ao usuário com system prompt
//! próprio, invocadas via IPC `agent_chat`. Diferente do orquestrador
//! GPT (que executa skills do catálogo do usuário), agentes deste
//! módulo são embutidos no app e reservados pra fluxos editoriais
//! (criar skill, editar workflow, etc).
//!
//! O primeiro agente é o **Skill Architect** — conduz a criação de
//! uma skill v2 via conversa. Adicionar novos agentes: implemente
//! `Agent`, registre no `lookup` deste módulo.

pub mod skill_architect;

use serde::Deserialize;

use crate::ai::client::{Message, OpenAIClient};
use crate::config;

/// Trait que todo agente interno implementa. `name` é o handle
/// usado pelo IPC; `system_prompt` injeta o prompt no `OpenAIClient::
/// chat_completion`. Flags `can_*` documentam capacidades — o caller
/// (frontend) usa pra mostrar/ocultar UI auxiliar (ex: botão de
/// "Pesquisar na web" só faz sentido quando `can_web_search`).
pub trait Agent {
    fn name(&self) -> &'static str;
    fn system_prompt(&self) -> String;
    fn can_web_search(&self) -> bool;
    fn can_write_files(&self) -> bool;
}

/// Resolve um agente pelo nome. Retorna `None` quando o handle não
/// bate com nenhum agente registrado — caller transforma em erro
/// user-actionable.
pub fn lookup(name: &str) -> Option<Box<dyn Agent + Send + Sync>> {
    match name {
        "skill-architect" => Some(Box::new(skill_architect::SkillArchitect)),
        _ => None,
    }
}

/// Turn de chat exposto via IPC. Subset do `ai::client::Message` —
/// agentes só lidam com user/assistant text (sem tool_calls,
/// sem multimodal).
#[derive(Debug, Clone, Deserialize)]
pub struct AgentChatTurn {
    pub role: String,
    pub content: String,
}

impl AgentChatTurn {
    fn into_message(self) -> Message {
        match self.role.as_str() {
            "assistant" => Message::assistant(self.content),
            "system" => Message::system(self.content),
            _ => Message::user(self.content),
        }
    }
}

/// Roda um turno do agente: resolve por nome, monta system prompt +
/// histórico + mensagem nova, manda pro OpenAI e retorna o texto.
/// Retry/backoff já mora dentro de `chat_completion`.
async fn run_agent_chat(
    agent_name: &str,
    message: &str,
    history: Vec<AgentChatTurn>,
) -> Result<String, String> {
    let agent = lookup(agent_name)
        .ok_or_else(|| format!("agente desconhecido: `{agent_name}`"))?;

    let system = agent.system_prompt();
    let mut messages: Vec<Message> = history
        .into_iter()
        .map(AgentChatTurn::into_message)
        .collect();
    messages.push(Message::user(message));

    let client = build_openai_client()?;
    client
        .chat_completion(&system, &messages)
        .await
        .map_err(|e| e.user_message())
}

fn build_openai_client() -> Result<OpenAIClient, String> {
    let cfg = config::load_config()?;
    let key = cfg.openai_api_key.ok_or_else(|| {
        "OPENAI_API_KEY não configurada. Abra Settings e cole sua key.".to_string()
    })?;
    OpenAIClient::new(key).map_err(|e| e.user_message())
}

// ── Tauri command ─────────────────────────────────────────────────────────

/// IPC entry-point. Frontend invoca com `invoke("agent_chat", { agent,
/// message, history })`. Erro vira string descritiva pro toast.
#[tauri::command]
pub async fn agent_chat(
    agent: String,
    message: String,
    history: Vec<AgentChatTurn>,
) -> Result<String, String> {
    run_agent_chat(&agent, &message, history).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_finds_skill_architect() {
        let agent = lookup("skill-architect").expect("registrado");
        assert_eq!(agent.name(), "skill-architect");
        assert!(agent.can_web_search());
        assert!(agent.can_write_files());
        assert!(!agent.system_prompt().trim().is_empty());
    }

    #[test]
    fn lookup_returns_none_for_unknown() {
        assert!(lookup("ghost-agent").is_none());
    }

    #[test]
    fn turn_into_message_maps_roles() {
        let m = AgentChatTurn {
            role: "assistant".into(),
            content: "oi".into(),
        }
        .into_message();
        assert_eq!(m.role, "assistant");

        let m = AgentChatTurn {
            role: "system".into(),
            content: "regra".into(),
        }
        .into_message();
        assert_eq!(m.role, "system");

        // Roles desconhecidos caem em user — seguro pro round-trip.
        let m = AgentChatTurn {
            role: "ghost".into(),
            content: "x".into(),
        }
        .into_message();
        assert_eq!(m.role, "user");
    }
}
