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
pub mod web_search;

use serde::Deserialize;

use crate::ai::client::{
    FunctionDefinition, Message, OpenAIClient, ToolCall, ToolDefinition,
};
use crate::config;

/// Limite de web_searches por turno do agente. Cada call adiciona
/// ~1k tokens de tool result; 3 cobre research razoável sem deixar
/// o modelo loopar infinito por engano (B2 spec).
const MAX_WEB_SEARCHES_PER_TURN: usize = 3;

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
/// histórico + mensagem nova, manda pro OpenAI. Quando o agente
/// declara `can_web_search()`, expõe o tool `web_search` e roda um
/// loop curto (cap [`MAX_WEB_SEARCHES_PER_TURN`]) reinjetando os
/// resultados — mesmo padrão do orquestrador principal e do flow
/// de @integrations.
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

    if !agent.can_web_search() {
        return client
            .chat_completion(&system, &messages)
            .await
            .map_err(|e| e.user_message());
    }

    // Web-search habilitada → loop tool-aware.
    let tools = vec![web_search_tool_definition()];
    let brave_key = brave_api_key();
    let mut searches_used = 0usize;

    loop {
        let out = client
            .chat_completion_with_tools(&system, &messages, &tools)
            .await
            .map_err(|e| e.user_message())?;

        if out.tool_calls.is_empty() {
            return Ok(out.content);
        }

        // Modelo pediu um ou mais tool_calls — append a turn de assistant
        // com os tool_calls intactos e despacha cada um. Pra OpenAI, o
        // turn assistant precisa preceder os messages role="tool".
        messages.push(Message::assistant_with_tool_calls(out.tool_calls.clone()));

        for call in out.tool_calls {
            let result_text = match call.function.name.as_str() {
                "web_search" => {
                    if searches_used >= MAX_WEB_SEARCHES_PER_TURN {
                        format!(
                            "limite de {MAX_WEB_SEARCHES_PER_TURN} web_searches por turno atingido — \
                             use os resultados anteriores ou peça ao usuário."
                        )
                    } else {
                        searches_used += 1;
                        dispatch_web_search(&call, brave_key.as_deref()).await
                    }
                }
                other => format!("Tool desconhecida: `{other}`"),
            };
            messages.push(Message::tool_result(call.id, result_text));
        }
    }
}

fn web_search_tool_definition() -> ToolDefinition {
    ToolDefinition {
        tool_type: "function".to_string(),
        function: FunctionDefinition {
            name: "web_search".to_string(),
            description:
                "Pesquisa na web (Brave Search) quando o domínio exige info \
                 que você não tem certeza. Use só pra validar nome de \
                 ferramenta CLI, formato de arquivo, ou doc específica. \
                 Não use pra perguntas genéricas — limite de 3 buscas por \
                 turno."
                    .to_string(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Termo de busca em inglês ou português, \
                            máximo ~10 palavras."
                    }
                },
                "required": ["query"]
            }),
        },
    }
}

async fn dispatch_web_search(call: &ToolCall, api_key: Option<&str>) -> String {
    #[derive(Deserialize)]
    struct Args {
        query: String,
    }
    let args: Args = match serde_json::from_str(&call.function.arguments) {
        Ok(a) => a,
        Err(e) => return format!("web_search: argumentos inválidos ({e})"),
    };
    let key = match api_key {
        Some(k) if !k.trim().is_empty() => k,
        _ => {
            return "BRAVE_API_KEY não configurada — peça ao usuário pra adicionar \
                em ~/.genesis/config.toml [search] brave_api_key, ou siga sem o \
                resultado."
                .to_string();
        }
    };
    match web_search::web_search(&args.query, key).await {
        Ok(hits) if hits.is_empty() => {
            format!("Nenhum resultado pra `{}`. Tente reformular.", args.query)
        }
        Ok(hits) => serde_json::to_string(&hits)
            .unwrap_or_else(|_| "[]".to_string()),
        Err(e) => format!("web_search falhou: {e}"),
    }
}

fn brave_api_key() -> Option<String> {
    config::load_config()
        .ok()
        .and_then(|c| c.search.brave_api_key)
        .filter(|k| !k.trim().is_empty())
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
