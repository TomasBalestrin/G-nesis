//! Tauri IPC handlers for chat messages and OpenAI orchestration.
//!
//! Messages starting with `/` are treated as skill activation commands and
//! handled entirely in Rust (no GPT roundtrip): parse the skill, generate a
//! confirmation preview listing the steps, or — if the name is unknown — a
//! "Skill não encontrada" reply with the available catalog. The user-facing
//! "Executar" button (future frontend task) calls `execute_skill`.
//!
//! Regular conversation flows through GPT-4o with the current skill catalog
//! injected into the system prompt via `ai::prompts::with_skill_catalog`,
//! so the model can answer questions like "quais skills existem?" without a
//! tool call.

use std::fs;
use std::path::PathBuf;

use sqlx::SqlitePool;
use tauri::State;

use crate::ai::client::{Message, OpenAIClient};
use crate::ai::prompts::{self, ORCHESTRATOR_SYSTEM_PROMPT};
use crate::config;
use crate::db::models::{ChatMessage, Conversation};
use crate::db::queries;
use crate::orchestrator::skill_parser::{self, ParsedSkill, SkillMeta, SkillStep};

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn openai_client() -> Result<OpenAIClient, String> {
    let cfg = config::load_config()?;
    let key = cfg.openai_api_key.ok_or_else(|| {
        "OPENAI_API_KEY não configurada. Abra Settings e cole sua key.".to_string()
    })?;
    OpenAIClient::new(key).map_err(|e| e.user_message())
}

// ── slash command handling ──────────────────────────────────────────────────

/// Extract the skill name from a message starting with `/`. Returns None if
/// the trimmed message doesn't start with `/` or has no name after it.
fn extract_slash_command(content: &str) -> Option<&str> {
    let trimmed = content.trim();
    let rest = trimmed.strip_prefix('/')?;
    let name = rest.split_whitespace().next()?;
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

fn skills_dir() -> Result<PathBuf, String> {
    Ok(PathBuf::from(config::load_config()?.skills_dir))
}

fn skill_md_path(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("nome de skill inválido: `{name}`"));
    }
    let dir = skills_dir()?;
    let file_name = if name.ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    };
    Ok(dir.join(file_name))
}

/// Load every `.md` under `skills_dir` and parse it. Broken files are
/// skipped with a stderr warning — mirror of `commands::skills::list_skills`
/// without cross-module borrowing through a `#[tauri::command]`.
fn load_skill_catalog() -> Vec<SkillMeta> {
    let Ok(dir) = skills_dir() else { return Vec::new() };
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };

    let mut metas: Vec<SkillMeta> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            if let Ok(content) = fs::read_to_string(&path) {
                match skill_parser::parse_skill(&content) {
                    Ok(skill) => metas.push(skill.meta),
                    Err(err) => eprintln!(
                        "[chat] pulando {} ao listar catálogo: {err}",
                        path.display()
                    ),
                }
            }
        }
    }
    metas.sort_by(|a, b| a.name.cmp(&b.name));
    metas
}

fn format_step_line(index: usize, step: &SkillStep) -> String {
    let payload_preview = step
        .command
        .as_deref()
        .or(step.prompt.as_deref())
        .unwrap_or("")
        .lines()
        .next()
        .unwrap_or("")
        .trim();
    let snippet = if payload_preview.chars().count() > 80 {
        let cut: String = payload_preview.chars().take(77).collect();
        format!("{cut}...")
    } else {
        payload_preview.to_string()
    };
    if snippet.is_empty() {
        format!("{}. **{}** (`{}`)\n", index + 1, step.id, step.tool)
    } else {
        format!(
            "{}. **{}** (`{}`): `{}`\n",
            index + 1,
            step.id,
            step.tool,
            snippet,
        )
    }
}

fn render_confirmation(skill: &ParsedSkill) -> String {
    let description = if skill.meta.description.is_empty() {
        "(sem descrição)"
    } else {
        skill.meta.description.as_str()
    };
    let mut msg = format!(
        "Encontrei a skill **`{}`** — {}\n\n",
        skill.meta.name, description,
    );

    if skill.steps.is_empty() {
        msg.push_str("_Skill sem steps definidos._\n");
    } else {
        msg.push_str("## Steps\n\n");
        for (i, step) in skill.steps.iter().enumerate() {
            msg.push_str(&format_step_line(i, step));
        }
    }

    if !skill.inputs.is_empty() {
        msg.push_str("\n## Inputs esperados\n\n");
        for input in &skill.inputs {
            msg.push_str(&format!("- `{{{{{input}}}}}`\n"));
        }
    }

    msg.push_str(
        "\n---\n\nSelecione um projeto e use o botão **Executar** para iniciar.",
    );
    msg
}

fn render_not_found(name: &str, catalog: &[SkillMeta]) -> String {
    let mut msg = format!("Skill `{name}` não encontrada.\n\n");
    if catalog.is_empty() {
        msg.push_str(
            "Nenhuma skill no `skills_dir`. Crie a primeira em **Skills → Nova Skill**.",
        );
    } else {
        msg.push_str("## Skills disponíveis\n\n");
        for skill in catalog {
            let desc = if skill.description.is_empty() {
                "(sem descrição)"
            } else {
                skill.description.as_str()
            };
            msg.push_str(&format!("- `/{}` — {}\n", skill.name, desc));
        }
    }
    msg
}

/// Try to produce a confirmation reply for `/skill-name`. Returns Some with
/// the markdown body when the skill was resolved (found or not found) — the
/// slash prefix is always fully handled here. Returns None if the skill
/// parse unexpectedly failed (the caller falls back to the GPT path so the
/// user still gets a reply).
fn try_slash_reply(skill_name: &str) -> String {
    let catalog = load_skill_catalog();
    let path = match skill_md_path(skill_name) {
        Ok(p) => p,
        Err(err) => return format!("{err}"),
    };

    match fs::read_to_string(&path) {
        Ok(content) => match skill_parser::parse_skill(&content) {
            Ok(skill) => render_confirmation(&skill),
            Err(err) => format!(
                "Skill `{skill_name}` existe mas está inválida: {err}\n\n\
                 Corrija em **Skills → {skill_name}**.",
            ),
        },
        Err(_) => render_not_found(skill_name, &catalog),
    }
}

// ── commands ────────────────────────────────────────────────────────────────

const TITLE_GEN_MAX_CHARS: usize = 30;
const DEFAULT_CONVERSATION_TITLE: &str = "Nova conversa";

/// Persist the user's message, decide between slash handling or GPT
/// completion, persist the assistant reply, and return it.
///
/// `conversation_id` scopes the history window passed to GPT and the row
/// storage — messages from other threads never leak in. On the very first
/// user message of a conversation (title still "Nova conversa") we ask GPT
/// for a short title in a side call and rename the row.
#[tauri::command]
pub async fn send_chat_message(
    content: String,
    execution_id: Option<String>,
    conversation_id: Option<String>,
    pool: State<'_, SqlitePool>,
) -> Result<ChatMessage, String> {
    let user_msg = ChatMessage {
        id: new_id(),
        execution_id: execution_id.clone(),
        conversation_id: conversation_id.clone(),
        role: "user".to_string(),
        content: content.clone(),
        created_at: now_iso(),
    };

    // Snapshot of the conversation row BEFORE we insert the user message —
    // if the title is still the default and there are no prior user messages,
    // this is the thread's first turn and we should auto-name it.
    let pre_insert_convo: Option<Conversation> = match conversation_id.as_deref() {
        Some(id) => queries::get_conversation(&pool, id).await?,
        None => None,
    };

    queries::insert_message(&pool, &user_msg).await?;

    let reply_content = if let Some(skill_name) = extract_slash_command(&content) {
        try_slash_reply(skill_name)
    } else {
        let history = history_for(&pool, execution_id.as_deref(), conversation_id.as_deref())
            .await?;
        let messages: Vec<Message> = history
            .iter()
            .map(|m| Message {
                role: m.role.clone(),
                content: m.content.clone(),
            })
            .collect();

        let catalog = load_skill_catalog();
        let system_prompt = prompts::with_skill_catalog(ORCHESTRATOR_SYSTEM_PROMPT, &catalog);

        let client = openai_client()?;
        client
            .chat_completion(&system_prompt, &messages)
            .await
            .map_err(|e| e.user_message())?
    };

    let assistant_msg = ChatMessage {
        id: new_id(),
        execution_id,
        conversation_id: conversation_id.clone(),
        role: "assistant".to_string(),
        content: reply_content,
        created_at: now_iso(),
    };
    queries::insert_message(&pool, &assistant_msg).await?;

    if let Some(id) = conversation_id.as_deref() {
        // Touch floats the thread to the top of the sidebar list even when
        // the auto-title step below is skipped.
        let _ = queries::touch_conversation(&pool, id).await;

        if should_auto_title(pre_insert_convo.as_ref()) {
            maybe_autotitle(&pool, id, &content).await;
        }
    }

    Ok(assistant_msg)
}

fn should_auto_title(pre: Option<&Conversation>) -> bool {
    match pre {
        Some(c) => c.title.trim() == DEFAULT_CONVERSATION_TITLE,
        None => false,
    }
}

/// Best-effort GPT call to coin a <=30 char title. Silent on failure — the
/// user can always rename manually via the sidebar.
async fn maybe_autotitle(pool: &SqlitePool, conversation_id: &str, first_message: &str) {
    let Ok(client) = openai_client() else { return };

    let prompt = format!(
        "Gere um título curto (máximo {TITLE_GEN_MAX_CHARS} caracteres, em português, \
         sem aspas, sem ponto final) que resuma o assunto da seguinte mensagem:\n\n{first_message}"
    );
    let messages = vec![Message {
        role: "user".to_string(),
        content: prompt,
    }];
    let Ok(raw) = client.chat_completion("", &messages).await else {
        return;
    };

    let title: String = raw
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '.' || c == ' ')
        .chars()
        .take(TITLE_GEN_MAX_CHARS)
        .collect();

    if title.is_empty() {
        return;
    }
    let _ = queries::rename_conversation(pool, conversation_id, &title).await;
}

/// Return the prior history for GPT context. Precedence: conversation_id
/// (new multi-thread path) over execution_id (legacy scope). Messages
/// inserted just before the call are included since list_messages_by_*
/// reads the fresh row.
async fn history_for(
    pool: &SqlitePool,
    execution_id: Option<&str>,
    conversation_id: Option<&str>,
) -> Result<Vec<ChatMessage>, String> {
    if let Some(id) = conversation_id {
        queries::list_messages_by_conversation(pool, id).await
    } else {
        queries::list_messages(pool, execution_id).await
    }
}

/// Low-level passthrough. Does not persist to chat history.
#[tauri::command]
pub async fn call_openai(prompt: String) -> Result<String, String> {
    let client = openai_client()?;
    let messages = vec![Message {
        role: "user".to_string(),
        content: prompt,
    }];
    client
        .chat_completion("", &messages)
        .await
        .map_err(|e| e.user_message())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_slash_command_basic() {
        assert_eq!(extract_slash_command("/criar-sistema"), Some("criar-sistema"));
        assert_eq!(
            extract_slash_command("  /criar-sistema com argumentos"),
            Some("criar-sistema"),
        );
    }

    #[test]
    fn extract_slash_command_rejects_non_slash() {
        assert_eq!(extract_slash_command("criar-sistema"), None);
        assert_eq!(extract_slash_command("bom dia"), None);
        assert_eq!(extract_slash_command(""), None);
        assert_eq!(extract_slash_command("   "), None);
    }

    #[test]
    fn extract_slash_command_rejects_empty_name() {
        assert_eq!(extract_slash_command("/"), None);
        assert_eq!(extract_slash_command("/   "), None);
    }

    #[test]
    fn render_not_found_lists_catalog() {
        let catalog = vec![
            SkillMeta {
                name: "a".into(),
                description: "first".into(),
                ..Default::default()
            },
            SkillMeta {
                name: "b".into(),
                description: String::new(),
                ..Default::default()
            },
        ];
        let msg = render_not_found("missing", &catalog);
        assert!(msg.contains("`missing` não encontrada"));
        assert!(msg.contains("- `/a` — first"));
        assert!(msg.contains("- `/b` — (sem descrição)"));
    }

    #[test]
    fn render_not_found_empty_catalog_has_cta() {
        let msg = render_not_found("x", &[]);
        assert!(msg.contains("Nova Skill"));
    }

    #[test]
    fn render_confirmation_lists_steps_and_inputs() {
        let skill = ParsedSkill {
            meta: SkillMeta {
                name: "demo".into(),
                description: "teste".into(),
                ..Default::default()
            },
            inputs: vec!["briefing".into()],
            steps: vec![SkillStep {
                id: "step_1".into(),
                tool: "bash".into(),
                command: Some("echo hi".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let msg = render_confirmation(&skill);
        assert!(msg.contains("**`demo`**"));
        assert!(msg.contains("1. **step_1** (`bash`): `echo hi`"));
        assert!(msg.contains("{{briefing}}"));
        assert!(msg.contains("Executar"));
    }
}
