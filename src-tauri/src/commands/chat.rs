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
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, State};

use crate::ai::client::{
    AiClient, ChatOutput, FunctionDefinition, Message, OpenAIClient, ThinkingSink, ToolCall,
    ToolDefinition,
};
use crate::ai::models::{self, ModelConfig};
// System prompt now composed via prompts::build_system_prompt(...) which
// pulls user_name + company_name from app_state and the knowledge_summary
// singleton row. Substitutes the {{...}} placeholders before the prompt
// reaches GPT, so the model gets a fully resolved system prompt instead
// of literal template tokens.
use crate::ai::prompts;
use crate::config;
use crate::db::models::{ChatMessage, Conversation, IntegrationRow};
use crate::db::queries;
use crate::orchestrator::skill_parser::{self, ParsedSkill, SkillMeta, SkillStep};
use crate::orchestrator::ExecutionRegistry;

const ACTIVE_MODEL_KEY: &str = "active_model_id";

// ── thinking event sink ─────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
struct ThinkingDeltaEvent {
    conversation_id: Option<String>,
    delta: String,
}

#[derive(Clone, Serialize)]
struct ThinkingCompleteEvent {
    conversation_id: Option<String>,
    summary: String,
}

/// Forwards thinking events from the AI client to the WebView. Lives only
/// for the duration of one `send_chat_message` call. Errors from `emit`
/// are swallowed: a missing window or dropped channel can't impact the
/// chat completion itself.
struct AppHandleSink {
    app: AppHandle,
    conversation_id: Option<String>,
}

impl ThinkingSink for AppHandleSink {
    fn thinking_delta(&self, delta: &str) {
        let _ = self.app.emit(
            "chat:thinking_delta",
            ThinkingDeltaEvent {
                conversation_id: self.conversation_id.clone(),
                delta: delta.to_string(),
            },
        );
    }

    fn thinking_complete(&self, summary: &str) {
        let _ = self.app.emit(
            "chat:thinking_complete",
            ThinkingCompleteEvent {
                conversation_id: self.conversation_id.clone(),
                summary: summary.to_string(),
            },
        );
    }
}

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

/// Build the right `AiClient` for `model`. Reads both API keys from the
/// config TOML so the same clientless caller can route to OpenAI or
/// Anthropic without inspecting the model itself.
fn ai_client_for_model(model: &ModelConfig) -> Result<AiClient, String> {
    let cfg = config::load_config()?;
    AiClient::for_model(
        model,
        cfg.openai_api_key.as_deref(),
        cfg.anthropic_api_key.as_deref(),
    )
    .map_err(|e| e.user_message())
}

/// Resolve the user's currently-picked model from `app_state`. Falls back to
/// the static default if the row is missing or carries an unknown id.
async fn active_model(pool: &sqlx::SqlitePool) -> &'static ModelConfig {
    let row = queries::get_state(pool, ACTIVE_MODEL_KEY)
        .await
        .ok()
        .flatten();
    let id = row.map(|s| s.value).unwrap_or_default();
    models::resolve_model(&id)
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

/// Find an integration invocation anywhere in the message — Slack /
/// Discord-style mention. Returns `(name, query)` where `name` is the
/// matched slug and `query` is the message with the `@<name>` token
/// stripped (so the model receives a clean question).
///
/// Pattern: `(?:^|\s)@([a-z0-9-]+)`. The look-behind on whitespace OR
/// start-of-string blocks false positives like `email@host` (no
/// whitespace before `@`) — same anchoring used by `at_mention_re`
/// for capability mentions.
///
/// Returns the FIRST match. Multi-mention messages
/// (`@github @perpetuohq foo`) collapse to the first; the second
/// integration is left in the query as plain text. Multi-integration
/// support would need a different protocol.
fn extract_at_integration(content: &str) -> Option<(String, String)> {
    let caps = at_integration_re().captures(content)?;
    let name = caps.get(1)?.as_str().to_string();
    let full = caps.get(0)?;
    let before = content[..full.start()].trim();
    let after = content[full.end()..].trim();
    let query = match (before.is_empty(), after.is_empty()) {
        (true, true) => String::new(),
        (false, true) => before.to_string(),
        (true, false) => after.to_string(),
        (false, false) => format!("{before} {after}"),
    };
    Some((name, query))
}

fn at_integration_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?:^|\s)@([a-z0-9-]+)").unwrap())
}

// ── integration_call extraction & dispatch ──────────────────────────────────

/// Parsed `{"integration_call": {...}}` envelope. Lives only inside
/// the chat post-processing path; the `commands/integrations.rs`
/// crate has its own (different) IntegrationCallRequest if/when it
/// needs one.
#[derive(Debug, Clone)]
struct IntegrationCallRequest {
    endpoint: String,
    /// Resolved query params. Stringified at extraction time so the
    /// HTTP layer can drop them straight into reqwest's `.query()`.
    params: Option<Vec<(String, String)>>,
}

#[derive(Deserialize)]
struct CallEnvelope {
    integration_call: CallInner,
}

#[derive(Deserialize)]
struct CallInner {
    endpoint: String,
    #[serde(default)]
    params: Option<serde_json::Map<String, serde_json::Value>>,
}

/// Detect the integration_call protocol in a model response. Aceita
/// 4 formatos comuns que o GPT emite na prática:
///   - JSON puro:      `{"integration_call": {...}}`
///   - Fenced:         `` ```json\n{"integration_call":...}\n``` ``
///   - Texto + JSON:   `"Vou providenciar... {"integration_call":...}"`
///   - JSON + texto:   `"{"integration_call":...} Conferindo agora."`
///
/// Estratégia: localizar o substring `"integration_call"`, andar pra
/// trás até a `{` mais próxima (a abertura do envelope), depois fazer
/// um scan forward com depth + estado de string-literal (com `\`
/// escapes) pra achar o `}` de fechamento correto. Esse path lida com
/// `{` / `}` dentro de strings JSON (ex: `"endpoint": "/path/{id}"`)
/// sem desbalancear a contagem.
///
/// `None` quando não há marker, JSON malformado ou shape errada
/// (`integration_call` precisa apontar pra um objeto com `endpoint`
/// string).
fn extract_integration_call(response: &str) -> Option<IntegrationCallRequest> {
    let json_str = find_envelope(response)?;
    let envelope: CallEnvelope = serde_json::from_str(json_str).ok()?;
    Some(IntegrationCallRequest {
        endpoint: envelope.integration_call.endpoint,
        params: envelope.integration_call.params.map(|m| {
            m.into_iter()
                .map(|(k, v)| (k, json_value_to_param(v)))
                .collect()
        }),
    })
}

/// Find the substring of `response` that brackets a balanced
/// `{ ... "integration_call" ... }` envelope. ASCII-byte scan with
/// string-literal awareness (so `{` / `}` inside `"..."` don't
/// mis-balance). Returns `None` quando não há marker ou quando o
/// envelope não fecha corretamente.
fn find_envelope(response: &str) -> Option<&str> {
    const MARKER: &str = "\"integration_call\"";
    let marker_pos = response.find(MARKER)?;
    let prefix = &response[..marker_pos];
    let start = prefix.rfind('{')?;

    let bytes = response.as_bytes();
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escape_next = false;
    let mut end: Option<usize> = None;

    for i in start..bytes.len() {
        let b = bytes[i];
        if escape_next {
            escape_next = false;
            continue;
        }
        if in_string {
            match b {
                b'\\' => escape_next = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    end = Some(i + 1);
                    break;
                }
            }
            _ => {}
        }
    }

    let end = end?;
    Some(&response[start..end])
}

/// Stringify a JSON value for use as a query-string param. Strings
/// pass through verbatim; null becomes empty; numbers/bools/objects
/// fall back to JSON encoding so the model can pass nested structures
/// when the API expects them serialized.
fn json_value_to_param(v: serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s,
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[derive(Clone, Serialize)]
struct IntegrationLoadingEvent {
    conversation_id: Option<String>,
    integration_name: String,
    endpoint: String,
}

#[derive(Clone, Serialize)]
struct IntegrationLoadedEvent {
    conversation_id: Option<String>,
    integration_name: String,
    endpoint: String,
    success: bool,
}

/// Soft cap on the API JSON dropped into the second GPT call. Same
/// 50 KiB limit used by `commands::integrations::call_integration` —
/// keeping the two in sync prevents the chat path from accidentally
/// exposing more bytes to the model than the IPC handler does.
const INTEGRATION_RESPONSE_MAX_BYTES: usize = 50 * 1024;

/// Execute the integration_call HTTP request, mirroring the build
/// path used by `commands::integrations::call_integration` (B2):
/// resolve api_key + auth from the TOML, build IntegrationClient,
/// GET the endpoint, truncate at 50 KiB, bump last_used_at on success.
///
/// Lives in chat.rs (rather than reusing the IPC handler) because
/// `#[tauri::command]` handlers take `State<'_, _>` which doesn't
/// compose well outside the IPC boundary; the duplication is
/// intentional and small.
async fn run_integration_request(
    integration: &IntegrationRow,
    call: &IntegrationCallRequest,
    pool: &SqlitePool,
) -> Result<String, String> {
    use crate::integrations::{self, AuthConfig, AuthType, IntegrationClient};

    let api_key = integrations::get_api_key(&integration.name)?
        .ok_or_else(|| format!("api_key ausente pra `{}`", integration.name))?;
    let full = integrations::load_integrations()?
        .into_iter()
        .find(|i| i.name == integration.name)
        .ok_or_else(|| {
            format!(
                "integration `{}` não está em config.toml",
                integration.name
            )
        })?;

    let auth = match full.auth_type {
        AuthType::Bearer => AuthConfig::Bearer(api_key),
        AuthType::Header { header_name } => AuthConfig::Header {
            name: header_name,
            value: api_key,
        },
        AuthType::Query { param_name } => AuthConfig::Query {
            param: param_name,
            value: api_key,
        },
    };

    let client = IntegrationClient::new(&integration.base_url, auth)
        .map_err(|e| format!("HTTP client: {e}"))?;

    // IntegrationError já tem Display em PT-BR (B1+F2) — passa direto
    // pra String pra surface do chat usar como canned reply.
    let value = client
        .get(&call.endpoint, call.params.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    let _ = queries::touch_integration_last_used(pool, &integration.name).await;

    let json = serde_json::to_string(&value)
        .map_err(|e| format!("serialize JSON: {e}"))?;
    let raw_len = json.len();
    if raw_len > INTEGRATION_RESPONSE_MAX_BYTES {
        let mut end = INTEGRATION_RESPONSE_MAX_BYTES;
        while end > 0 && !json.is_char_boundary(end) {
            end -= 1;
        }
        Ok(format!(
            "{}\n... [truncated; full was {raw_len} bytes]",
            &json[..end]
        ))
    } else {
        Ok(json)
    }
}

/// Apply the integration_call protocol on top of a raw model reply.
///
/// Two pass-through cases (no extra GPT call):
///   1. `active_integration` is None — user didn't @-prefix the turn.
///   2. The reply isn't an `integration_call` envelope — model decided
///      it had enough context to answer in text. Surface the raw reply.
///
/// When the envelope is detected, runs a **loop de até 5 rounds**: cada
/// round dispara o HTTP, reinjeta o resultado como turn `user`, e chama
/// o GPT de novo. Sai do loop quando:
///   - GPT responde sem `integration_call` (resposta final pro usuário).
///   - HTTP falha (canned PT-BR substitui a resposta).
///   - Cap de 5 rounds atingido (msg de fallback explica que não foi
///     possível obter os dados).
///
/// Permite chains tipo "GET /perpetuos → pega ID → GET /perpetuos/:id →
/// pega planilha → GET .../planilhas/:pid" sem o GPT precisar adivinhar
/// IDs. Eventos `integration:loading`/`loaded` são emitidos uma vez
/// (no início do round 1 e no fim do loop) — UI mostra spinner único
/// mesmo durante chains multi-round.
/// Cap em 3 rounds: cobre o caso típico de chain (lista → detail →
/// sub-recurso) mantendo budget contra rate limit. APIs que exigem
/// mais hops esbarram no fallback "não consegui obter todos os dados".
const MAX_INTEGRATION_ROUNDS: usize = 3;

/// Delay entre rounds pra suavizar o burst de calls que estourava o
/// rate limit da OpenAI em chains de integration_calls. 2s combina
/// com o retry de 3s no with_retry: se um round dispara 429, o
/// retry da OpenAI segura 3s e o delay do round seguinte segura
/// outros 2s — total ~5s de oxigênio antes da próxima request.
const ROUND_DELAY_SECS: u64 = 2;

async fn post_process_integration_call(
    raw: (String, Option<String>, Option<String>),
    active_integration: Option<&IntegrationRow>,
    client: &AiClient,
    system_prompt: &str,
    messages: &[Message],
    pool: &SqlitePool,
    app: &AppHandle,
    conversation_id: Option<&str>,
) -> Result<(String, Option<String>, Option<String>), String> {
    let Some(integration) = active_integration else {
        return Ok(raw);
    };
    println!(
        ">>> [INTEGRATION] post_process: GPT raw response (len={}):\n--- BEGIN ---\n{}\n--- END ---",
        raw.0.len(),
        raw.0
    );
    if extract_integration_call(&raw.0).is_none() {
        println!(
            ">>> [INTEGRATION] post_process: extract_integration_call=None no round 0 → texto puro vai pro usuário"
        );
        return Ok(raw);
    }

    // Loading emitido UMA vez no início (igual UX do execução de skill).
    // Endpoint inicial = primeiro call detectado; rounds subsequentes
    // mantêm o mesmo spinner ativo até o loaded final.
    let mut next_messages: Vec<Message> = messages.to_vec();
    let mut current_reply = raw.0;
    let mut last_success = true;
    let mut emitted_loading = false;

    for round in 1..=MAX_INTEGRATION_ROUNDS {
        let Some(call) = extract_integration_call(&current_reply) else {
            // GPT respondeu sem envelope → resposta final pro usuário.
            println!(
                ">>> [INTEGRATION] post_process: round {round} convergiu (resposta final pro usuário)"
            );
            break;
        };
        println!(
            ">>> [INTEGRATION] post_process round {round}: endpoint=`{}` params={:?}",
            call.endpoint, call.params
        );

        if !emitted_loading {
            let _ = app.emit(
                "integration:loading",
                IntegrationLoadingEvent {
                    conversation_id: conversation_id.map(str::to_string),
                    integration_name: integration.name.clone(),
                    endpoint: call.endpoint.clone(),
                },
            );
            emitted_loading = true;
        }

        match run_integration_request(integration, &call, pool).await {
            Ok(json) => {
                last_success = true;
                // Log requested em E3 follow-up: round + endpoint +
                // tamanho do payload da API. Útil pra confirmar que
                // o GPT está realmente progredindo na chain (lista
                // → detail → totals) em vez de parar cedo.
                println!(
                    ">>> ROUND {round}: endpoint={} response_size={}",
                    call.endpoint,
                    json.len()
                );
                // Push assistant turn (envelope JSON) + synthetic user
                // turn carregando o resultado da API. O prompt do user
                // turn deixa claro que round adicional é OK se o GPT
                // ainda precisa de mais dados.
                next_messages.push(Message::assistant(current_reply.clone()));
                let context_msg = format!(
                    "Resultado da chamada à integração `@{name}` no endpoint `{endpoint}` (round {round}):\n\n```json\n{json}\n```\n\nSe a pergunta original pediu DADOS AGREGADOS (faturamento, lucro, métricas) e este resultado é APENAS uma lista (sem totals/agregados), você AINDA não terminou — faça outra `integration_call` pra abrir o item específico e pegar os números. Se já tem tudo que precisa, responda ao usuário em português conciso, com valores formatados (R$ X, X%) — sem JSON cru, sem devolver IDs.",
                    name = integration.name,
                    endpoint = call.endpoint,
                );
                next_messages.push(Message::user(context_msg));

                // Throttle entre GPT calls pra suavizar o burst que
                // estourava rate limit da OpenAI em chains de 3
                // rounds. O 1s é entre o GPT inicial e o round 1
                // também (o burst começa aí).
                tokio::time::sleep(std::time::Duration::from_secs(
                    ROUND_DELAY_SECS,
                ))
                .await;

                current_reply = client
                    .chat_completion(system_prompt, &next_messages)
                    .await
                    .map_err(|e| e.user_message())?;
                println!(
                    ">>> [INTEGRATION] post_process round {round} → next GPT reply ({} bytes)",
                    current_reply.len()
                );
            }
            Err(err) => {
                last_success = false;
                println!(
                    ">>> [INTEGRATION] post_process round {round} HTTP falhou: {err}"
                );
                current_reply = format!(
                    "Não consegui consultar `@{name}` agora: {err}",
                    name = integration.name,
                );
                break;
            }
        }

        if round == MAX_INTEGRATION_ROUNDS {
            // O loop fecha naturalmente após esse iteration; se ainda
            // tem envelope no current_reply, capamos com mensagem
            // explícita pra não esconder o problema.
            if extract_integration_call(&current_reply).is_some() {
                println!(
                    ">>> [INTEGRATION] post_process atingiu MAX_INTEGRATION_ROUNDS={MAX_INTEGRATION_ROUNDS} sem convergir"
                );
                current_reply = "Desculpe, não consegui obter todos os dados necessários em tempo razoável. Tente uma pergunta mais específica.".to_string();
                last_success = false;
            }
        }
    }

    if emitted_loading {
        let _ = app.emit(
            "integration:loaded",
            IntegrationLoadedEvent {
                conversation_id: conversation_id.map(str::to_string),
                integration_name: integration.name.clone(),
                endpoint: String::new(),
                success: last_success,
            },
        );
    }

    Ok((current_reply, None, None))
}

// ── @ and # mention extraction ──────────────────────────────────────────────

/// Lazy compile and cache the @-mention regex. Pattern: a word boundary
/// (start of string OR a whitespace) followed by `@` and a name made
/// of `[a-z0-9-]+`. The boundary check stops false positives like
/// `email@host` from matching as `@host`. Match group 1 captures the
/// name. Rust's `regex` crate has no lookbehind, so we anchor on the
/// boundary char inside the same pattern.
fn at_mention_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?:^|\s)@([a-z0-9-]+)").unwrap())
}

fn hash_mention_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?:^|\s)#([a-z0-9-]+)").unwrap())
}

/// Pull every `@name` token from the user's message. Order is
/// preserved (left-to-right), duplicates removed — re-mentioning the
/// same capability shouldn't inject its doc twice.
pub fn extract_at_mentions(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for cap in at_mention_re().captures_iter(content) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().to_string();
            if seen.insert(name.clone()) {
                out.push(name);
            }
        }
    }
    out
}

/// Pull every `#name` token from the user's message. Same dedup +
/// ordering rules as [`extract_at_mentions`].
pub fn extract_hash_mentions(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for cap in hash_mention_re().captures_iter(content) {
        if let Some(m) = cap.get(1) {
            let name = m.as_str().to_string();
            if seen.insert(name.clone()) {
                out.push(name);
            }
        }
    }
    out
}

/// Resolve `@name` mentions against the capabilities table. Skips
/// rows that don't exist or are disabled (`enabled = 0`) — the model
/// shouldn't see docs for capabilities the user can't actually
/// invoke. Returns `(name, doc_ai)` pairs in mention order.
async fn resolve_at_mentions(pool: &SqlitePool, names: &[String]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::with_capacity(names.len());
    for name in names {
        match queries::get_capability_by_name(pool, name).await {
            Ok(Some(cap)) if cap.enabled == 1 => {
                out.push((cap.name, cap.doc_ai));
            }
            _ => {}
        }
    }
    out
}

/// Resolve `#name` mentions against the projects/caminhos table.
/// Fetches the full project list once and filters in-memory — cheap
/// for the typical handful of projects a user keeps. Returns
/// `(name, repo_path)` pairs in mention order; unknown names drop
/// silently so the model doesn't get confused by half-resolved data.
async fn resolve_hash_mentions(pool: &SqlitePool, names: &[String]) -> Vec<(String, String)> {
    if names.is_empty() {
        return Vec::new();
    }
    let projects = queries::list_projects(pool).await.unwrap_or_default();
    let mut out: Vec<(String, String)> = Vec::with_capacity(names.len());
    for name in names {
        if let Some(p) = projects.iter().find(|p| p.name.as_str() == name.as_str()) {
            out.push((p.name.clone(), p.repo_path.clone()));
        }
    }
    out
}

/// Format the resolved mentions as a markdown block to append after
/// the system prompt. Empty when neither list has matches — caller
/// should skip the join in that case.
fn format_mentions_block(
    capabilities: &[(String, String)],
    caminhos: &[(String, String)],
) -> String {
    if capabilities.is_empty() && caminhos.is_empty() {
        return String::new();
    }
    let mut s = String::new();
    if !capabilities.is_empty() {
        s.push_str("## Capabilities mencionadas nesta mensagem\n\n");
        s.push_str(
            "O usuário invocou as capabilities abaixo. \
             Use as instruções de cada uma como referência principal \
             pra escolher como executar o pedido.\n\n",
        );
        for (name, doc) in capabilities {
            s.push_str(&format!("### @{name}\n\n{doc}\n\n"));
        }
    }
    if !caminhos.is_empty() {
        if !s.is_empty() {
            s.push('\n');
        }
        s.push_str("## Caminhos mencionados nesta mensagem\n\n");
        s.push_str(
            "O usuário referenciou as pastas locais abaixo. \
             Use o `repo_path` como `cwd` quando rodar comandos \
             relacionados a cada uma.\n\n",
        );
        for (name, path) in caminhos {
            s.push_str(&format!("### #{name}\n- Path: `{path}`\n\n"));
        }
    }
    s.trim_end().to_string()
}

fn skills_dir() -> Result<PathBuf, String> {
    Ok(PathBuf::from(config::load_config()?.skills_dir))
}

/// Resolve o caminho do `SKILL.md` v2 de uma skill. `skill_dir()`
/// valida `name` contra `..` / separators / vazio. Retorna o path
/// mesmo que o arquivo não exista — caller (`render_skill_md`,
/// `render_confirmation`) faz `fs::read_to_string` e cai em
/// `render_not_found` na falha. v1 (.md solto) foi removido em F2.
fn resolve_skill_md(name: &str) -> Result<PathBuf, String> {
    let dir = crate::skills::storage::skill_dir(name)?;
    Ok(dir.join("SKILL.md"))
}

/// Filenames (sem path) das references de uma skill v2. Vazio quando
/// não é v2 ou quando references/ não existe / está vazia. Caller
/// usa pra montar o bloco "References disponíveis: ..." mostrado
/// ao usuário no canned reply do slash + ao GPT em prompts futuros
/// que carreguem skill context.
fn list_skill_reference_names(name: &str) -> Vec<String> {
    crate::skills::storage::list_references(name)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from))
        .collect()
}

/// Filenames dos scripts de uma skill v2 (qualquer extensão — `.sh`,
/// `.py`, `.js`, etc.). Mesma semântica da `list_skill_reference_names`,
/// mas pra `<package>/scripts/`.
fn list_skill_script_names(name: &str) -> Vec<String> {
    crate::skills::storage::list_scripts(name)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from))
        .collect()
}

/// Load every `.md` under `skills_dir` and parse it. Walks the top level
/// plus immediate subdirectories (e.g. `skills/meta/criar-skill.md`) so
/// curated meta-skills stay discoverable without polluting the user's
/// flat skill list. Deeper nesting is intentionally ignored to keep the
/// scan cheap and avoid surprises.
///
/// Broken files are skipped with a stderr warning — one bad file should
/// not hide the rest.
fn load_skill_catalog() -> Vec<SkillMeta> {
    let Ok(dir) = skills_dir() else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut metas: Vec<SkillMeta> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // One level deep — meta/, drafts/, etc.
            if let Ok(sub_entries) = fs::read_dir(&path) {
                for sub in sub_entries.flatten() {
                    push_skill_meta(&sub.path(), &mut metas);
                }
            }
        } else {
            push_skill_meta(&path, &mut metas);
        }
    }
    metas.sort_by(|a, b| a.name.cmp(&b.name));
    metas
}

fn push_skill_meta(path: &std::path::Path, metas: &mut Vec<SkillMeta>) {
    if path.extension().map(|e| e == "md").unwrap_or(false) {
        if let Ok(content) = fs::read_to_string(path) {
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

/// Slash commands whose response must come from the AI instead of the
/// canned skill-preview path. `/criar-skill` is the only entry today —
/// the orchestrator system prompt has the multi-turn guided flow that
/// drives Phase 1 onward as a regular GPT response.
fn is_ai_routed_slash_command(name: &str) -> bool {
    matches!(name, "criar-skill")
}

/// Substring triggers that activate the skill-authoring agent without
/// the user typing `/criar-skill`. Tight allowlist — broader phrases
/// (e.g. "automatizar isso") would catch generic conversation and
/// flip the model into the wrong role. Add only patterns that
/// unambiguously mean "I want to create/save a skill".
const SKILL_AGENT_TRIGGERS: &[&str] = &[
    "criar skill",
    "criar uma skill",
    "criar nova skill",
    "fazer skill",
    "fazer uma skill",
    "nova skill",
    "skill nova",
];

/// Decides whether this turn should run with `PROMPT_SKILL_AGENT`
/// appended to the system prompt. Active when:
///   - the user typed `/criar-skill`, OR
///   - the user typed plain text matching any trigger above.
///
/// A different slash (`/algo`) is NOT treated as a skill-agent
/// trigger even if the body contains a trigger phrase — the slash
/// owns the routing.
fn is_skill_agent_active(content: &str, slash_command: Option<&str>) -> bool {
    if slash_command == Some("criar-skill") {
        return true;
    }
    if slash_command.is_some() {
        return false;
    }
    let lowered = content.to_lowercase();
    SKILL_AGENT_TRIGGERS.iter().any(|t| lowered.contains(t))
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

fn render_confirmation(
    skill: &ParsedSkill,
    references: &[String],
    scripts: &[String],
) -> String {
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

    // Lazy-load: listamos só os filenames (não o conteúdo) pra
    // economizar tokens no prompt do GPT. A instrução "peça pelo
    // nome" dá hook protocolar pro modelo solicitar via tools
    // `read_skill_reference` / `read_skill_script`.
    if !references.is_empty() {
        msg.push_str("\n## References disponíveis\n\n");
        msg.push_str(&references.join(", "));
        msg.push_str(
            "\n\n_Se precisar do conteúdo de alguma reference específica, peça pelo nome \
             (ferramenta `read_skill_reference`)._",
        );
    }

    if !scripts.is_empty() {
        msg.push_str("\n## Scripts disponíveis\n\n");
        msg.push_str(&scripts.join(", "));
        msg.push_str(
            "\n\n_Se precisar inspecionar um script antes de executar, peça pelo nome \
             (ferramenta `read_skill_script`)._",
        );
    }

    msg.push_str("\n---\n\nSelecione um projeto e use o botão **Executar** para iniciar.");
    msg
}

fn render_not_found(name: &str, catalog: &[SkillMeta]) -> String {
    let mut msg = format!("Skill `{name}` não encontrada.\n\n");
    if catalog.is_empty() {
        msg.push_str("Nenhuma skill no `skills_dir`. Crie a primeira em **Skills → Nova Skill**.");
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
    // resolve_skill_md aponta sempre pro SKILL.md v2; arquivo ausente
    // cai em fs::read_to_string Err → render_not_found.
    let path = match resolve_skill_md(skill_name) {
        Ok(p) => p,
        Err(err) => return format!("{err}"),
    };

    match fs::read_to_string(&path) {
        Ok(content) => match skill_parser::parse_skill(&content) {
            Ok(skill) => {
                let refs = list_skill_reference_names(skill_name);
                let scripts = list_skill_script_names(skill_name);
                render_confirmation(&skill, &refs, &scripts)
            }
            Err(err) => format!(
                "Skill `{skill_name}` existe mas está inválida: {err}\n\n\
                 Corrija em **Skills → {skill_name}**.",
            ),
        },
        Err(_) => render_not_found(skill_name, &catalog),
    }
}

// ── system-state snapshot ───────────────────────────────────────────────────

/// Per-step error/output snippet cap when surfacing failed steps in the
/// system-state block. Big stderr blobs would bloat the prompt and the
/// model only needs the first lines to diagnose; keep it tight.
const SYSTEM_STATE_SNIPPET_CHARS: usize = 200;

/// Build the runtime payload that fills `{{INJECT:SYSTEM_STATE}}` in
/// `PROMPT_SYSTEM_STATE`. Reads:
///   - active project   (most recent execution → fallback last created)
///   - skills catalog   (already passed in, no duplicate fs walk)
///   - running execution (status='running', plus any failed steps)
///   - last finished execution (any status, finished_at NOT NULL)
///
/// Db errors degrade to "nenhum"/"nenhuma" lines instead of bubbling —
/// the chat turn must succeed even if the snapshot is partial. The model
/// will still get PROMPT_CORE / RULES / etc. and can answer generic
/// questions.
async fn collect_system_state(pool: &SqlitePool, skills: &[SkillMeta]) -> String {
    let mut lines: Vec<String> = Vec::with_capacity(6);

    let active_project = queries::get_active_project(pool).await.ok().flatten();
    lines.push(match active_project {
        Some(p) => format!("Projeto ativo: {} ({})", p.name, p.repo_path),
        None => "Projeto ativo: nenhum".to_string(),
    });

    if skills.is_empty() {
        lines.push("Skills disponíveis: nenhuma".to_string());
    } else {
        let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        lines.push(format!("Skills disponíveis: {}", names.join(", ")));
    }

    let running = queries::get_running_execution(pool).await.ok().flatten();
    match running {
        Some(exec) => {
            lines.push(format!(
                "Execução ativa: {} (step {}/{})",
                exec.skill_name, exec.completed_steps, exec.total_steps,
            ));
            let failed = queries::list_steps_for_execution(pool, &exec.id)
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|s| s.status == "failed")
                .collect::<Vec<_>>();
            if !failed.is_empty() {
                lines.push("  Falhas:".to_string());
                for step in failed {
                    let detail = step
                        .error
                        .as_deref()
                        .or(step.output.as_deref())
                        .unwrap_or("(sem output)")
                        .lines()
                        .next()
                        .unwrap_or("")
                        .chars()
                        .take(SYSTEM_STATE_SNIPPET_CHARS)
                        .collect::<String>();
                    lines.push(format!("    - {}: {}", step.step_id, detail));
                }
            }
        }
        None => lines.push("Execução ativa: nenhuma".to_string()),
    }

    let last = queries::get_last_finished_execution(pool)
        .await
        .ok()
        .flatten();
    lines.push(match last {
        Some(exec) => {
            let when = exec.finished_at.as_deref().unwrap_or("?");
            format!(
                "Última execução: {} — {} ({})",
                exec.skill_name, exec.status, when
            )
        }
        None => "Última execução: nenhuma".to_string(),
    });

    lines.join("\n")
}

// ── tool calling ────────────────────────────────────────────────────────────

/// Cap on the assistant ↔ tool ping-pong inside one chat turn. The
/// loop terminates either when the model responds without tool_calls
/// or after this many iterations. Hit-limit means the model got stuck
/// in a tool loop and we surface a generic message so the user can
/// re-prompt.
const MAX_TOOL_ITERATIONS: u32 = 10;

/// Cap on the tail of files surfaced to the model via `read_file`.
/// The whole point is to keep tool results small enough that the
/// loop's context window doesn't explode after a few iterations.
const READ_FILE_MAX_BYTES: usize = 10_240;

/// Tools advertised to the GPT orchestrator. JSON schemas are inline
/// `serde_json::json!` literals so each tool's contract reads top to
/// bottom — no per-tool DTO struct. Names match what
/// `execute_tool` dispatches on; mismatch is the only way a tool
/// silently fails.
fn genesis_tools() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "execute_skill".to_string(),
                description: "Executa uma skill no projeto ativo. Retorna o execution_id.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "skill_name": {
                            "type": "string",
                            "description": "Nome exato da skill (ex: 'legendar-videos')"
                        }
                    },
                    "required": ["skill_name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "list_skills".to_string(),
                description: "Lista todas as skills disponíveis com nome e descrição.".to_string(),
                parameters: serde_json::json!({"type": "object", "properties": {}}),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "read_skill".to_string(),
                description: "Lê o conteúdo .md de uma skill específica.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "skill_name": {"type": "string"}
                    },
                    "required": ["skill_name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "save_skill".to_string(),
                description: "Cria ou atualiza uma skill .md. Opcionalmente salva um script .sh em ~/.genesis/scripts/.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "skill_name": {"type": "string"},
                        "skill_content": {"type": "string", "description": "Conteúdo completo do .md (frontmatter + steps)"},
                        "script_name": {"type": "string", "description": "Nome do script .sh (opcional)"},
                        "script_content": {"type": "string", "description": "Conteúdo do script .sh (opcional)"}
                    },
                    "required": ["skill_name", "skill_content"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "read_skill_reference".to_string(),
                description: "Lê um módulo .md em <skill>/references/ sob demanda. \
                    Use quando a skill ativada listou references e você precisa de \
                    contexto específico de um deles. Não chame em massa — só o que \
                    for relevante pra resposta atual."
                    .to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "skill_name": {"type": "string"},
                        "reference_name": {
                            "type": "string",
                            "description": "Filename relativo (ex: 'iron-man.md'). Sem path traversal."
                        }
                    },
                    "required": ["skill_name", "reference_name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "read_skill_script".to_string(),
                description: "Lê um script em <skill>/scripts/ sob demanda — útil pra \
                    inspecionar lógica antes de pedir execução. Mesma política \
                    lazy-load das references."
                    .to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "skill_name": {"type": "string"},
                        "script_name": {
                            "type": "string",
                            "description": "Filename relativo (ex: 'parse.sh'). Sem path traversal."
                        }
                    },
                    "required": ["skill_name", "script_name"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "read_file".to_string(),
                description: "Lê um arquivo do disco. Limite de 10KB. Path absoluto.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {"type": "string", "description": "Caminho absoluto do arquivo"}
                    },
                    "required": ["path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "list_files".to_string(),
                description: "Lista arquivos de um diretório. Pattern simples como '*.mp4' (apenas sufixo) é aceito.".to_string(),
                parameters: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "pattern": {"type": "string", "description": "Glob simples, ex: '*.mp4'. Opcional."}
                    },
                    "required": ["path"]
                }),
            },
        },
        ToolDefinition {
            tool_type: "function".to_string(),
            function: FunctionDefinition {
                name: "abort_execution".to_string(),
                description: "Aborta a execução em andamento (status='running'). Retorna erro se não houver.".to_string(),
                parameters: serde_json::json!({"type": "object", "properties": {}}),
            },
        },
    ]
}

/// Dispatch a single tool call. Always returns a String — errors
/// stringify into descriptive messages that the model can read on the
/// next turn and self-correct (e.g. "skill X não encontrada — chame
/// list_skills primeiro"). NEVER panics; argument-parse failures and
/// missing dependencies all produce text payloads.
async fn execute_tool(
    tool_call: &ToolCall,
    pool: State<'_, SqlitePool>,
    registry: State<'_, ExecutionRegistry>,
    app: AppHandle,
    conversation_id: Option<&str>,
) -> String {
    let name = tool_call.function.name.as_str();
    let args = tool_call.function.arguments.as_str();
    match name {
        "execute_skill" => dispatch_execute_skill(args, pool, registry, app, conversation_id).await,
        "list_skills" => dispatch_list_skills().await,
        "read_skill" => dispatch_read_skill(args).await,
        "read_skill_reference" => dispatch_read_skill_reference(args).await,
        "read_skill_script" => dispatch_read_skill_script(args).await,
        "save_skill" => dispatch_save_skill(args).await,
        "read_file" => dispatch_read_file(args),
        "list_files" => dispatch_list_files(args),
        "abort_execution" => dispatch_abort_execution(&pool, &registry).await,
        unknown => format!("Tool desconhecida: `{unknown}`"),
    }
}

async fn dispatch_execute_skill(
    raw: &str,
    pool: State<'_, SqlitePool>,
    registry: State<'_, ExecutionRegistry>,
    app: AppHandle,
    conversation_id: Option<&str>,
) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        skill_name: String,
    }
    let args: Args = match serde_json::from_str(raw) {
        Ok(a) => a,
        Err(e) => return format!("execute_skill: argumentos inválidos ({e})"),
    };
    match crate::commands::execution::execute_skill(
        args.skill_name.clone(),
        None,
        conversation_id.map(String::from),
        pool,
        registry,
        app,
    )
    .await
    {
        Ok(execution_id) => format!(
            "Skill `{}` iniciada. execution_id: {execution_id}",
            args.skill_name
        ),
        Err(e) => format!("Falha ao executar `{}`: {e}", args.skill_name),
    }
}

async fn dispatch_list_skills() -> String {
    // LLM tool não precisa do mirror SQLite (id/created_at são UI-only),
    // então chama storage diretamente — sem pool, sem IPC layer.
    match crate::skills::storage::list_skill_packages() {
        Ok(packages) => {
            if packages.is_empty() {
                return "Nenhuma skill cadastrada em ~/.genesis/skills/.".to_string();
            }
            let entries: Vec<serde_json::Value> = packages
                .into_iter()
                .map(|p| {
                    serde_json::json!({
                        "name": p.name,
                        "description": p.description,
                    })
                })
                .collect();
            serde_json::to_string(&entries).unwrap_or_else(|e| format!("falha ao serializar: {e}"))
        }
        Err(e) => format!("Falha ao listar skills: {e}"),
    }
}

async fn dispatch_read_skill(raw: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        skill_name: String,
    }
    let args: Args = match serde_json::from_str(raw) {
        Ok(a) => a,
        Err(e) => return format!("read_skill: argumentos inválidos ({e})"),
    };
    match crate::skills::storage::read_skill_md(&args.skill_name) {
        Ok(content) => content,
        Err(e) => format!("Falha ao ler skill `{}`: {e}", args.skill_name),
    }
}

async fn dispatch_read_skill_reference(raw: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        skill_name: String,
        reference_name: String,
    }
    let args: Args = match serde_json::from_str(raw) {
        Ok(a) => a,
        Err(e) => return format!("read_skill_reference: argumentos inválidos ({e})"),
    };
    read_skill_subfile(&args.skill_name, "references", &args.reference_name)
}

async fn dispatch_read_skill_script(raw: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        skill_name: String,
        script_name: String,
    }
    let args: Args = match serde_json::from_str(raw) {
        Ok(a) => a,
        Err(e) => return format!("read_skill_script: argumentos inválidos ({e})"),
    };
    read_skill_subfile(&args.skill_name, "scripts", &args.script_name)
}

/// Helper compartilhado: resolve `<skill>/<sub>/<filename>` validando
/// path traversal (rejeita `..`, separators, vazio) e lê o arquivo
/// como UTF-8. Erros viram mensagens descritivas pro LLM ler na
/// próxima volta do loop e auto-corrigir.
fn read_skill_subfile(skill_name: &str, subdir: &str, filename: &str) -> String {
    let trimmed = filename.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return format!(
            "Filename inválido: `{filename}` (sem `..`, sem separadores)."
        );
    }
    let dir = match crate::skills::storage::skill_dir(skill_name) {
        Ok(d) => d,
        Err(e) => return format!("Skill `{skill_name}` inválida: {e}"),
    };
    let path = dir.join(subdir).join(trimmed);
    match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => format!(
            "Arquivo `{subdir}/{trimmed}` não encontrado em `{skill_name}`. \
             Use `list_skills` ou re-leia o canned reply do `/{skill_name}` \
             pra ver o que está disponível."
        ),
    }
}

async fn dispatch_save_skill(raw: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        skill_name: String,
        skill_content: String,
        #[serde(default)]
        script_name: Option<String>,
        #[serde(default)]
        script_content: Option<String>,
    }
    let args: Args = match serde_json::from_str(raw) {
        Ok(a) => a,
        Err(e) => return format!("save_skill: argumentos inválidos ({e})"),
    };

    // v2-only: cria pasta + grava SKILL.md (parser valida via
    // save_skill_folder helper). Conteúdo de skills v1 (frontmatter
    // sem `version:` 2.x) ainda parseia, então o agente continua
    // funcionando — só o layout em disco mudou.
    if let Err(e) = crate::skills::storage::ensure_skill_dirs(&args.skill_name) {
        return format!("Falha ao criar pasta da skill `{}`: {e}", args.skill_name);
    }
    if let Err(e) = crate::orchestrator::skill_parser::parse_skill(&args.skill_content) {
        return format!("Skill `{}` inválida: {e}", args.skill_name);
    }
    let skill_md = match crate::skills::storage::skill_dir(&args.skill_name) {
        Ok(d) => d.join("SKILL.md"),
        Err(e) => return format!("nome inválido: {e}"),
    };
    if let Err(e) = fs::write(&skill_md, &args.skill_content) {
        return format!("Falha ao salvar skill `{}`: {e}", args.skill_name);
    }

    // Optional sidecar script. Path validation mirrors skill_path's
    // rules: empty/dotdot/separators are rejected so the model can't
    // smuggle a script outside ~/.genesis/scripts/.
    if let (Some(script_name), Some(script_content)) = (args.script_name, args.script_content) {
        if script_name.is_empty()
            || script_name.contains("..")
            || script_name.contains('/')
            || script_name.contains('\\')
        {
            return format!(
                "Skill `{}` salva, mas script ignorado (nome inválido: `{script_name}`).",
                args.skill_name
            );
        }
        let scripts_dir = config::config_dir().join("scripts");
        if let Err(e) = fs::create_dir_all(&scripts_dir) {
            return format!(
                "Skill `{}` salva, mas falha ao criar {}: {e}",
                args.skill_name,
                scripts_dir.display()
            );
        }
        let script_path = scripts_dir.join(&script_name);
        if let Err(e) = fs::write(&script_path, script_content) {
            return format!(
                "Skill `{}` salva, mas falha ao gravar script `{script_name}`: {e}",
                args.skill_name
            );
        }
        // Best-effort chmod +x so the BashChannel can spawn the script
        // directly. Non-Unix platforms ignore this — the loop should
        // still work via `bash <script>` invocation.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(&script_path) {
                let mut perms = meta.permissions();
                perms.set_mode(0o755);
                let _ = fs::set_permissions(&script_path, perms);
            }
        }
        return format!(
            "Skill `{}` salva. Script `{script_name}` gravado em {}.",
            args.skill_name,
            script_path.display()
        );
    }

    format!("Skill `{}` salva.", args.skill_name)
}

fn dispatch_read_file(raw: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        path: String,
    }
    let args: Args = match serde_json::from_str(raw) {
        Ok(a) => a,
        Err(e) => return format!("read_file: argumentos inválidos ({e})"),
    };
    if args.path.contains("..") {
        return format!("read_file: path com `..` rejeitado (`{}`)", args.path);
    }
    match fs::read_to_string(&args.path) {
        Ok(content) => {
            if content.len() > READ_FILE_MAX_BYTES {
                let truncated: String = content.chars().take(READ_FILE_MAX_BYTES).collect();
                format!("{truncated}\n\n[truncado em {READ_FILE_MAX_BYTES} bytes]")
            } else {
                content
            }
        }
        Err(e) => format!("Falha ao ler `{}`: {e}", args.path),
    }
}

fn dispatch_list_files(raw: &str) -> String {
    #[derive(serde::Deserialize)]
    struct Args {
        path: String,
        #[serde(default)]
        pattern: Option<String>,
    }
    let args: Args = match serde_json::from_str(raw) {
        Ok(a) => a,
        Err(e) => return format!("list_files: argumentos inválidos ({e})"),
    };
    if args.path.contains("..") {
        return format!("list_files: path com `..` rejeitado (`{}`)", args.path);
    }
    // Suffix-only matching — `*.mp4` keeps the implementation tiny and
    // matches the user-facing description ("Pattern simples"). Anything
    // before `*` is rejected since we'd need a real glob library.
    let suffix = match args.pattern {
        Some(p) if p.starts_with('*') => Some(p["*".len()..].to_string()),
        Some(p) => return format!("list_files: pattern `{p}` não suportado (use '*.ext')"),
        None => None,
    };
    let entries = match fs::read_dir(&args.path) {
        Ok(it) => it,
        Err(e) => return format!("Falha ao listar `{}`: {e}", args.path),
    };
    let mut names: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(ref sfx) = suffix {
            if !name.ends_with(sfx) {
                continue;
            }
        }
        names.push(name);
    }
    names.sort();
    if names.is_empty() {
        format!("(vazio em `{}`)", args.path)
    } else {
        names.join("\n")
    }
}

async fn dispatch_abort_execution(pool: &SqlitePool, registry: &ExecutionRegistry) -> String {
    let running = match queries::get_running_execution(pool).await {
        Ok(Some(e)) => e,
        Ok(None) => return "Nenhuma execução em andamento.".to_string(),
        Err(e) => return format!("Falha ao consultar execuções: {e}"),
    };
    match registry.abort(&running.id).await {
        Ok(()) => format!(
            "Execução `{}` (skill `{}`) abortada.",
            running.id, running.skill_name
        ),
        Err(e) => format!("Falha ao abortar `{}`: {e}", running.id),
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
    app: AppHandle,
    pool: State<'_, SqlitePool>,
    registry: State<'_, ExecutionRegistry>,
) -> Result<ChatMessage, String> {
    let user_msg = ChatMessage {
        id: new_id(),
        execution_id: execution_id.clone(),
        conversation_id: conversation_id.clone(),
        role: "user".to_string(),
        content: content.clone(),
        created_at: now_iso(),
        kind: "text".to_string(),
        thinking: None,
        thinking_summary: None,
    };

    // Snapshot of the conversation row BEFORE we insert the user message —
    // if the title is still the default and there are no prior user messages,
    // this is the thread's first turn and we should auto-name it.
    let pre_insert_convo: Option<Conversation> = match conversation_id.as_deref() {
        Some(id) => queries::get_conversation(&pool, id).await?,
        None => None,
    };

    queries::insert_message(&pool, &user_msg).await?;

    // Slash commands normally skip the AI roundtrip — `try_slash_reply`
    // builds the canned skill preview directly. A short allowlist
    // (`is_ai_routed_slash_command`) opts specific commands out: those go
    // through GPT so the system prompt's multi-turn flows (e.g.
    // `/criar-skill`) can drive the conversation instead.
    let slash_command = extract_slash_command(&content).map(str::to_string);
    let needs_ai = match slash_command.as_deref() {
        Some(name) => is_ai_routed_slash_command(name),
        None => true,
    };

    // Turn-level integration invocation. Only checked when there's no
    // slash-command — `/skill` always wins. Resolves to one of three
    // states:
    //   1. user didn't @-prefix this turn → both None.
    //   2. @<name> matched an enabled row → `active_integration` =
    //      Some(row), canned = None, AI flow continues with a system
    //      prompt block describing the integration.
    //   3. @<name> matched nothing or a disabled row → canned reply
    //      short-circuits the AI roundtrip.
    let at_integration: Option<(String, String)> = if slash_command.is_none() {
        extract_at_integration(&content)
    } else {
        None
    };
    println!(
        ">>> [INTEGRATION] extract_at_integration result: {:?}",
        at_integration.as_ref()
    );

    // Sticky context: se a thread já estava em integration X e o
    // usuário não @-mencionou nesse turn, herdamos X. @-mention
    // explícita SEMPRE override. Lookup só roda quando o handler
    // tem conversation_id (turnos órfãos não têm contexto sticky).
    let inherited_integration_name: Option<String> = if at_integration.is_none() {
        match conversation_id.as_deref() {
            Some(id) => queries::get_conversation(&pool, id)
                .await
                .ok()
                .flatten()
                .and_then(|c| c.active_integration),
            None => None,
        }
    } else {
        None
    };
    if let Some(name) = inherited_integration_name.as_ref() {
        println!(
            ">>> [INTEGRATION] herdou active_integration `{name}` do conversation_id"
        );
    }

    let resolve_name: Option<String> = at_integration
        .as_ref()
        .map(|(n, _)| n.clone())
        .or_else(|| inherited_integration_name.clone());

    let (active_integration, canned_integration_reply): (
        Option<IntegrationRow>,
        Option<String>,
    ) = match resolve_name.as_deref() {
        None => (None, None),
        Some(name) => match queries::get_integration_by_name(&pool, name).await? {
            Some(row) if row.enabled == 1 => {
                println!(
                    ">>> [INTEGRATION] resolvida: name=`{}` enabled base_url=`{}`",
                    row.name, row.base_url
                );
                (Some(row), None)
            }
            Some(row) => {
                println!(
                    ">>> [INTEGRATION] `{name}` existe mas enabled={}; tratando como não-encontrada",
                    row.enabled
                );
                // Sticky context com integration disabled: limpa o
                // sticky pro próximo turno não tropeçar de novo.
                if at_integration.is_none() {
                    if let Some(id) = conversation_id.as_deref() {
                        let _ =
                            queries::set_conversation_active_integration(&pool, id, None).await;
                    }
                }
                (None, Some(format!("Integração @{name} não encontrada")))
            }
            None => {
                println!(">>> [INTEGRATION] `{name}` não está no SQLite; não-encontrada");
                if at_integration.is_none() {
                    if let Some(id) = conversation_id.as_deref() {
                        let _ =
                            queries::set_conversation_active_integration(&pool, id, None).await;
                    }
                }
                (None, Some(format!("Integração @{name} não encontrada")))
            }
        },
    };

    // Persist sticky context APÓS resolução — só quando o usuário
    // @-mencionou explicitamente neste turn E a integration resolveu.
    // Inheritance herda mas não re-grava (idempotente).
    if at_integration.is_some() {
        if let (Some(integration), Some(id)) =
            (active_integration.as_ref(), conversation_id.as_deref())
        {
            if let Err(err) = queries::set_conversation_active_integration(
                &pool,
                id,
                Some(&integration.name),
            )
            .await
            {
                eprintln!(
                    "[integrations] persistir active_integration `{}` falhou: {err}",
                    integration.name
                );
            } else {
                println!(
                    ">>> [INTEGRATION] persisted active_integration=`{}` em conversation `{id}`",
                    integration.name
                );
            }
        }
    }

    let (reply_content, thinking, thinking_summary) =
        if let Some(canned) = canned_integration_reply {
            (canned, None, None)
        } else if let (false, Some(skill_name)) = (needs_ai, slash_command.as_deref()) {
            (try_slash_reply(skill_name), None, None)
        } else {
            let history =
                history_for(&pool, execution_id.as_deref(), conversation_id.as_deref()).await?;
            let messages: Vec<Message> = history
                .iter()
                .map(|m| match m.role.as_str() {
                    "user" => Message::user(m.content.clone()),
                    "assistant" => Message::assistant(m.content.clone()),
                    "system" => Message::system(m.content.clone()),
                    // Tool-role rows aren't persisted (intermediate
                    // tool_calls/results are ephemeral) — fall back to
                    // user role so unknown role strings don't crash.
                    _ => Message::user(m.content.clone()),
                })
                .collect();

            let catalog = load_skill_catalog();
            let user_name = queries::get_app_state(&pool, "user_name")
                .await
                .ok()
                .flatten();
            let company_name = queries::get_app_state(&pool, "company_name")
                .await
                .ok()
                .flatten();
            let summary = queries::get_knowledge_summary(&pool)
                .await
                .ok()
                .flatten()
                .map(|s| s.summary);
            let system_state = collect_system_state(&pool, &catalog).await;
            // DB-backed capabilities catalog. Returns "" when no rows
            // are enabled; build_system_prompt skips the section in
            // that case via the Some-non-empty filter.
            let capabilities_block = prompts::build_capabilities_prompt(&pool).await;
            let mut system_prompt = prompts::build_system_prompt(
                user_name.as_deref(),
                company_name.as_deref(),
                summary.as_deref(),
                Some(&system_state),
                if capabilities_block.is_empty() {
                    None
                } else {
                    Some(capabilities_block.as_str())
                },
                &catalog,
            );

            // Pull @ and # mentions from the latest user message and
            // append the resolved doc_ai / repo_path snippets to the
            // system prompt. Slash commands are gated upstream
            // (`needs_ai` branch); this only runs for AI-routed turns.
            // Empty mentions = no append, no extra cost.
            let at_names = extract_at_mentions(&content);
            let hash_names = extract_hash_mentions(&content);
            let resolved_caps = resolve_at_mentions(&pool, &at_names).await;
            let resolved_caminhos = resolve_hash_mentions(&pool, &hash_names).await;
            let mentions_block = format_mentions_block(&resolved_caps, &resolved_caminhos);
            if !mentions_block.is_empty() {
                system_prompt.push_str("\n\n");
                system_prompt.push_str(&mentions_block);
            }

            // Active integration block — when the user prefixed the
            // turn with @<name> and the row exists+enabled (resolved
            // above as `active_integration`), inject PROMPT_INTEGRATION
            // with the spec content. Spec read errors fall through to
            // None → the prompt's fallback note tells GPT to ask for
            // endpoints. The integration_call JSON protocol is fully
            // documented inside PROMPT_INTEGRATION; orchestrator-side
            // execution is wired separately.
            if let Some(integration) = active_integration.as_ref() {
                let spec = crate::integrations::load_spec(&integration.name)
                    .ok()
                    .flatten();
                println!(
                    ">>> [INTEGRATION] load_spec(`{}`) → {}",
                    integration.name,
                    match spec.as_deref() {
                        Some(s) => format!("OK ({} bytes)", s.len()),
                        None => "None (fallback prompt vai dizer 'spec não encontrada')".to_string(),
                    }
                );
                system_prompt = prompts::with_integration_context(
                    &system_prompt,
                    &integration.name,
                    spec.as_deref(),
                );
                println!(
                    ">>> [INTEGRATION] system_prompt contains `integration_call`: {}",
                    system_prompt.contains("integration_call")
                );
                println!(
                    ">>> [INTEGRATION] === SYSTEM PROMPT FINAL ===\n{system_prompt}\n>>> [INTEGRATION] === END SYSTEM PROMPT ==="
                );
            }

            // Skill authoring flow — appended after mentions so the
            // agent rules (etapas 1-6, regras de criação, etc.) sit
            // closest to the user message and bias the next reply.
            // Still self-suficient: the prompt acknowledges that
            // user_name + capabilities catalog were injected upstream.
            if is_skill_agent_active(&content, slash_command.as_deref()) {
                system_prompt.push_str("\n\n");
                system_prompt.push_str(prompts::PROMPT_SKILL_AGENT);
            }

            let model = active_model(&pool).await;
            let client = ai_client_for_model(model)?;

            let sink = AppHandleSink {
                app: app.clone(),
                conversation_id: conversation_id.clone(),
            };

            // OpenAI runs through the function-calling loop so the model
            // can dispatch real actions (execute_skill, list_skills,
            // read_file, etc.) inside one logical turn. Anthropic stays
            // on the existing thinking/streaming path — its native tool
            // protocol differs from OpenAI's and lands in a separate
            // task. Both branches converge on (content, thinking,
            // thinking_summary) which then flows through
            // `post_process_integration_call` for the @<name> protocol.
            //
            // **Integration turns disable function-calling tools.** When
            // `active_integration` is Some, the model has two ways to
            // produce output: (a) a function call against `genesis_tools`
            // or (b) the JSON-in-text `integration_call` envelope from
            // PROMPT_INTEGRATION. Trained behavior heavily prefers (a)
            // when tools are visible, so the model often emits a tool
            // call (or text "no acesso") instead of the JSON envelope.
            // Hiding the tools forces it down the JSON path, which
            // post_process_integration_call then parses + dispatches.
            let raw = match &client {
                AiClient::OpenAi(openai) => {
                    // Integration turns: pula o tool loop completamente.
                    // O `tools: []` no request OpenAI é ambíguo (alguns
                    // models 400, outros silenciosamente ignoram), e
                    // function-calling concorre com o protocolo
                    // integration_call no prompt. Plain chat_completion
                    // = uma chamada, sem `tools` field, model lê
                    // PROMPT_INTEGRATION e responde com JSON envelope.
                    if active_integration.is_some() {
                        let content = openai
                            .chat_completion(&system_prompt, &messages)
                            .await
                            .map_err(|e| e.user_message())?;
                        println!(
                            ">>> [INTEGRATION] GPT raw (plain): {} bytes\n--- BEGIN ---\n{}\n--- END ---",
                            content.len(),
                            &content[..200.min(content.len())]
                        );
                        (content, None, None)
                    } else {
                    let tools = genesis_tools();
                    let mut loop_messages: Vec<Message> = messages.clone();
                    let mut final_content = String::new();
                    for _ in 0..MAX_TOOL_ITERATIONS {
                        let resp = openai
                            .chat_completion_with_tools(&system_prompt, &loop_messages, &tools)
                            .await
                            .map_err(|e| e.user_message())?;
                        if resp.tool_calls.is_empty() {
                            final_content = resp.content;
                            break;
                        }
                        // Feed the assistant turn back into the history so
                        // the next iteration sees the tool_calls it
                        // emitted. Content may be non-empty when the
                        // model emits text alongside tool_calls — keep
                        // both so the model's reasoning isn't lost.
                        let mut assistant_turn = Message::assistant(resp.content.clone());
                        assistant_turn.tool_calls = Some(resp.tool_calls.clone());
                        loop_messages.push(assistant_turn);

                        for tc in &resp.tool_calls {
                            // Clone the State handles per call — they
                            // wrap an Arc internally so the cost is a
                            // refcount bump. State<'_, _> isn't Copy
                            // in Tauri 2, so the loop would otherwise
                            // refuse to move them again on iter 2+.
                            let result = execute_tool(
                                tc,
                                pool.clone(),
                                registry.clone(),
                                app.clone(),
                                conversation_id.as_deref(),
                            )
                            .await;
                            loop_messages.push(Message::tool_result(tc.id.clone(), result));
                        }
                    }
                    if final_content.is_empty() {
                        final_content =
                            "Limite de iterações de tools atingido sem resposta final.".to_string();
                    }
                    (final_content, None, None)
                    }
                }
                AiClient::Anthropic(_) => {
                    let ChatOutput {
                        content,
                        thinking,
                        thinking_summary,
                    } = client
                        .chat_completion_with_thinking(&system_prompt, &messages, Some(&sink))
                        .await
                        .map_err(|e| e.user_message())?;
                    (content, thinking, thinking_summary)
                }
            };

            post_process_integration_call(
                raw,
                active_integration.as_ref(),
                &client,
                &system_prompt,
                &messages,
                &pool,
                &app,
                conversation_id.as_deref(),
            )
            .await?
        };

    let assistant_msg = ChatMessage {
        id: new_id(),
        execution_id,
        conversation_id: conversation_id.clone(),
        role: "assistant".to_string(),
        content: reply_content,
        created_at: now_iso(),
        kind: "text".to_string(),
        thinking,
        thinking_summary,
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

/// Best-effort title-generation call via the user's active model. Silent on
/// failure — the user can always rename manually via the sidebar.
async fn maybe_autotitle(pool: &SqlitePool, conversation_id: &str, first_message: &str) {
    let model = active_model(pool).await;
    let Ok(client) = ai_client_for_model(model) else {
        return;
    };

    let prompt = format!(
        "Gere um título curto (máximo {TITLE_GEN_MAX_CHARS} caracteres, em português, \
         sem aspas, sem ponto final) que resuma o assunto da seguinte mensagem:\n\n{first_message}"
    );
    let messages = vec![Message::user(prompt)];
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

/// Maximum chat turns sent to the model on each completion. Older
/// messages stay persisted in SQLite (the UI list_messages_by_conversation
/// command still returns the full thread for hydration), but the GPT
/// context window only sees the last N to keep token cost bounded as
/// conversations grow.
const HISTORY_WINDOW: usize = 20;

/// Trim a chronologically-ordered history vec to its last `max` items.
/// Pure function pulled out so the windowing logic can be unit-tested
/// without a SQLite fixture. Preserves ordering — `history_for` returns
/// oldest-first, the GPT messages array expects oldest-first.
fn cap_history<T>(mut history: Vec<T>, max: usize) -> Vec<T> {
    if history.len() > max {
        history.drain(..history.len() - max);
    }
    history
}

/// Return the prior history for GPT context. Precedence: conversation_id
/// (new multi-thread path) over execution_id (legacy scope). Messages
/// inserted just before the call are included since list_messages_by_*
/// reads the fresh row.
///
/// Caps the result at [`HISTORY_WINDOW`] entries so the GPT call doesn't
/// scale linearly with conversation length.
async fn history_for(
    pool: &SqlitePool,
    execution_id: Option<&str>,
    conversation_id: Option<&str>,
) -> Result<Vec<ChatMessage>, String> {
    let all = if let Some(id) = conversation_id {
        queries::list_messages_by_conversation(pool, id).await?
    } else {
        queries::list_messages(pool, execution_id).await?
    };
    Ok(cap_history(all, HISTORY_WINDOW))
}

/// Low-level passthrough. Does not persist to chat history.
#[tauri::command]
pub async fn call_openai(prompt: String) -> Result<String, String> {
    let client = openai_client()?;
    let messages = vec![Message::user(prompt)];
    client
        .chat_completion("", &messages)
        .await
        .map_err(|e| e.user_message())
}

/// Read chat history for a specific conversation thread. Used by the chat UI
/// on mount to hydrate the message list before the user types.
#[tauri::command]
pub async fn list_messages_by_conversation(
    conversation_id: String,
    pool: State<'_, SqlitePool>,
) -> Result<Vec<ChatMessage>, String> {
    queries::list_messages_by_conversation(&pool, &conversation_id).await
}

// ── inline execution-status flow ───────────────────────────────────────────

/// Focused system prompt for the failure-analyzer call. Lives inline
/// because `ai/prompts.rs` is locked and this prompt is one-shot
/// (analyze-and-respond) — it doesn't reuse the modular Genesis prompt.
const FAILURE_ANALYSIS_SYSTEM_PROMPT: &str = r#"Você analisa erros de execução de skills do Genesis.
Receberá output e erro de um step que falhou.
Responda em português, conciso (3-6 linhas), com:
1. Causa provável do erro em linguagem simples
2. Correção sugerida (comando, ajuste, dependência, etc.)
Se o erro for vago ou desconhecido, diga isso e sugira onde pesquisar.
Não invente causas — se faltam dados, peça os logs específicos."#;

/// Persist an execution-status chat message (`⏳/✅/❌` inline entries)
/// and emit `chat:message_inserted` so the live ChatPanel can append
/// it without re-fetching the whole thread. Invoked from the frontend
/// `useExecution` hook on each `execution:step_*` event.
///
/// `kind` is forwarded to the `chat_messages.kind` column verbatim —
/// the frontend passes `"execution-status"` for status entries and
/// `"text"` for regular bubbles. conversation_id is resolved from the
/// executions row (set when `execute_skill` was called with the chat's
/// conversationId).
#[tauri::command]
pub async fn insert_execution_status_message(
    execution_id: String,
    content: String,
    kind: String,
    pool: State<'_, SqlitePool>,
    app: AppHandle,
) -> Result<ChatMessage, String> {
    let exec = queries::get_execution(&pool, &execution_id)
        .await?
        .ok_or_else(|| format!("execução `{execution_id}` não encontrada"))?;

    let msg = ChatMessage {
        id: new_id(),
        execution_id: Some(execution_id),
        conversation_id: exec.conversation_id.clone(),
        role: "assistant".to_string(),
        content,
        created_at: now_iso(),
        kind,
        thinking: None,
        thinking_summary: None,
    };
    queries::insert_message(&pool, &msg).await?;
    let _ = app.emit("chat:message_inserted", &msg);
    Ok(msg)
}

/// Send a step-failure payload to GPT for diagnosis and persist the
/// reply as a regular assistant chat message. Returns the inserted
/// row so the caller can also use it optimistically; emits
/// `chat:message_inserted` for the listening ChatPanel.
///
/// Stays in `chat.rs` (instead of `execution.rs`) because the heavy
/// dependency is the OpenAI client — keeping AI calls bundled with the
/// rest of the chat surface keeps the channel/orchestrator modules
/// AI-free. `stdout`/`stderr`/`exit_code` are all optional since the
/// orchestrator's `step_failed` event only ships an aggregated `error`
/// string today; richer payloads can land later without breaking this
/// signature.
#[tauri::command]
pub async fn analyze_step_failure(
    execution_id: String,
    step_id: String,
    stdout: Option<String>,
    stderr: Option<String>,
    exit_code: Option<i64>,
    pool: State<'_, SqlitePool>,
    app: AppHandle,
) -> Result<ChatMessage, String> {
    let exec = queries::get_execution(&pool, &execution_id)
        .await?
        .ok_or_else(|| format!("execução `{execution_id}` não encontrada"))?;

    let prompt = format!(
        "O step **{step}** da skill **{skill}** falhou.\n\n\
         Output (stdout):\n{stdout}\n\n\
         Erro (stderr):\n{stderr}\n\n\
         Exit code: {code}\n\n\
         Analise o erro e sugira a correção.",
        step = step_id,
        skill = exec.skill_name,
        stdout = stdout.as_deref().unwrap_or("(vazio)"),
        stderr = stderr.as_deref().unwrap_or("(vazio)"),
        code = exit_code.map_or_else(|| "?".to_string(), |c| c.to_string()),
    );

    let client = openai_client()?;
    let messages = vec![Message::user(prompt)];
    let analysis = client
        .chat_completion(FAILURE_ANALYSIS_SYSTEM_PROMPT, &messages)
        .await
        .map_err(|e| e.user_message())?;

    let msg = ChatMessage {
        id: new_id(),
        execution_id: Some(execution_id),
        conversation_id: exec.conversation_id.clone(),
        role: "assistant".to_string(),
        content: analysis,
        created_at: now_iso(),
        // Analysis renders as a regular bubble (full prose, markdown),
        // not as a status pill — keep it as `"text"`.
        kind: "text".to_string(),
        thinking: None,
        thinking_summary: None,
    };
    queries::insert_message(&pool, &msg).await?;
    let _ = app.emit("chat:message_inserted", &msg);
    Ok(msg)
}

// ── skill folder writes (v2 layout) ────────────────────────────────────────

/// One named file written into a v2 skill folder. Used uniformly for
/// scripts/, references/, assets/.
#[derive(Debug, serde::Deserialize)]
pub struct SkillFolderFile {
    pub name: String,
    pub content: String,
}

/// Returns true when `name` is safe to use as a single path component
/// inside the skills_dir tree. Path traversal + separator chars
/// rejected at the boundary.
fn is_safe_skill_path_component(name: &str) -> bool {
    !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..")
}

/// Persists a v2 skill folder under `skills_dir`:
///
/// ```text
/// skills_dir/<skill_name>/
///     SKILL.md            (sempre)
///     scripts/<file>      (cada SkillFolderFile em `scripts`)
///     references/<file>   (cada SkillFolderFile em `references`)
///     assets/<file>       (cada SkillFolderFile em `assets`)
/// ```
///
/// Idempotente — re-call sobrescreve arquivos existentes pra suportar
/// o flow do skill agent que itera o conteúdo entre as etapas
/// CONSTRUIR / APRESENTAR / VALIDAR. Scripts ganham chmod 755 sob
/// `cfg(unix)` pra que o BashChannel possa spawnar direto.
///
/// Erros surfacam o nome do arquivo problemático pra o agente
/// conseguir ajustar e re-tentar.
#[tauri::command]
pub async fn save_skill_folder(
    skill_name: String,
    skill_md: String,
    scripts: Option<Vec<SkillFolderFile>>,
    references: Option<Vec<SkillFolderFile>>,
    assets: Option<Vec<SkillFolderFile>>,
) -> Result<(), String> {
    if !is_safe_skill_path_component(&skill_name) {
        return Err(format!("nome de skill inválido: `{skill_name}`"));
    }

    let cfg = config::load_config()?;
    let skills_root = PathBuf::from(cfg.skills_dir);
    let skill_folder = skills_root.join(&skill_name);

    fs::create_dir_all(&skill_folder)
        .map_err(|e| format!("falha ao criar pasta {}: {e}", skill_folder.display()))?;

    let skill_md_path = skill_folder.join("SKILL.md");
    fs::write(&skill_md_path, &skill_md)
        .map_err(|e| format!("falha ao gravar {}: {e}", skill_md_path.display()))?;

    write_skill_subdir(&skill_folder, "scripts", scripts.unwrap_or_default(), true)?;
    write_skill_subdir(
        &skill_folder,
        "references",
        references.unwrap_or_default(),
        false,
    )?;
    write_skill_subdir(&skill_folder, "assets", assets.unwrap_or_default(), false)?;

    Ok(())
}

/// Helper for [`save_skill_folder`] — writes each file inside one
/// subdirectory of the skill folder. Empty input list = no-op (we
/// don't even create the subdir; better to let `references/` not
/// exist than ship a vazio that confuses the listing).
///
/// `executable` flag triggers chmod 755 on Unix so scripts run
/// directly via the BashChannel without needing `bash <script>`
/// prefix in the etapa.
fn write_skill_subdir(
    skill_folder: &std::path::Path,
    subdir: &str,
    files: Vec<SkillFolderFile>,
    executable: bool,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let dir = skill_folder.join(subdir);
    fs::create_dir_all(&dir).map_err(|e| format!("falha ao criar {}: {e}", dir.display()))?;

    for file in files {
        if !is_safe_skill_path_component(&file.name) {
            return Err(format!(
                "nome de arquivo inválido em {subdir}/: `{}`",
                file.name
            ));
        }
        let path = dir.join(&file.name);
        fs::write(&path, &file.content)
            .map_err(|e| format!("falha ao gravar {}: {e}", path.display()))?;
        if executable {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = fs::metadata(&path) {
                    let mut perms = meta.permissions();
                    perms.set_mode(0o755);
                    let _ = fs::set_permissions(&path, perms);
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_slash_command_basic() {
        assert_eq!(
            extract_slash_command("/criar-sistema"),
            Some("criar-sistema")
        );
        assert_eq!(
            extract_slash_command("  /criar-sistema com argumentos"),
            Some("criar-sistema"),
        );
    }

    #[test]
    fn cap_history_keeps_last_n_when_over_window() {
        // Oldest-first input; cap_history must keep the tail (most recent)
        // and preserve order so the GPT messages array stays chronological.
        let trimmed = cap_history(vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
        assert_eq!(trimmed, vec![8, 9, 10]);
    }

    #[test]
    fn cap_history_returns_input_unchanged_when_under_window() {
        let small = vec!["a", "b"];
        assert_eq!(cap_history(small.clone(), 5), small);
    }

    #[test]
    fn cap_history_handles_exact_boundary_and_zero() {
        // Boundary: len == max → no drain.
        assert_eq!(cap_history(vec![1, 2, 3], 3), vec![1, 2, 3]);
        // Edge: max=0 drops everything (defensive — current callers use
        // HISTORY_WINDOW=20 so this branch isn't hit in prod).
        assert!(cap_history(vec![1, 2, 3], 0).is_empty());
    }

    #[test]
    fn history_window_matches_product_spec() {
        // Spec: GPT sees the last 20 turns. If this constant changes,
        // re-confirm the tradeoff (cost vs. context recall).
        assert_eq!(HISTORY_WINDOW, 20);
    }

    /// Genesis advertises 7 tools to the model. Names are the dispatch
    /// keys in `execute_tool` — a typo or rename here silently breaks
    /// function calling without a compiler error, so we anchor the
    /// expected set in a test.
    #[test]
    fn genesis_tools_lists_all_with_correct_names() {
        let tools = genesis_tools();
        let names: Vec<&str> = tools.iter().map(|t| t.function.name.as_str()).collect();
        // Ordem importa pra estabilidade do snapshot. read_skill_reference
        // e read_skill_script entraram em A3 (lazy-load de auxiliares
        // de skill v2).
        assert_eq!(
            names,
            vec![
                "execute_skill",
                "list_skills",
                "read_skill",
                "save_skill",
                "read_skill_reference",
                "read_skill_script",
                "read_file",
                "list_files",
                "abort_execution",
            ],
            "tool list drifted from execute_tool dispatch keys",
        );
    }

    /// Each tool must have `type: "function"` — that's the only
    /// discriminator OpenAI accepts today, and it's serialized
    /// verbatim into the request JSON. A wrong value silently
    /// rejects the entire `tools` array with a 400.
    #[test]
    fn genesis_tools_all_have_function_type() {
        for tool in genesis_tools() {
            assert_eq!(
                tool.tool_type, "function",
                "tool `{}` has non-`function` type",
                tool.function.name,
            );
        }
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

    fn ai(s: &str) -> Option<(String, String)> {
        extract_at_integration(s)
    }

    #[test]
    fn extract_at_integration_at_start() {
        assert_eq!(
            ai("@perpetuohq teste"),
            Some(("perpetuohq".into(), "teste".into()))
        );
        assert_eq!(
            ai("  @perpetuohq teste  "),
            Some(("perpetuohq".into(), "teste".into()))
        );
    }

    #[test]
    fn extract_at_integration_bare_name_has_empty_query() {
        assert_eq!(ai("@github"), Some(("github".into(), "".into())));
        assert_eq!(ai("  @github  "), Some(("github".into(), "".into())));
    }

    #[test]
    fn extract_at_integration_keeps_words_after_name() {
        assert_eq!(
            ai("@github buscar issues abertas"),
            Some(("github".into(), "buscar issues abertas".into()))
        );
    }

    #[test]
    fn extract_at_integration_finds_mid_text_and_strips_token() {
        // `@<name>` em qualquer posição: o token é removido da query
        // pra GPT receber só a pergunta limpa.
        assert_eq!(
            ai("rode @github buscar"),
            Some(("github".into(), "rode buscar".into()))
        );
        assert_eq!(ai("oi @github"), Some(("github".into(), "oi".into())));
        assert_eq!(
            ai("quanto lucrei @perpetuohq em março"),
            Some(("perpetuohq".into(), "quanto lucrei em março".into()))
        );
        assert_eq!(
            ai("mostra dados @perpetuohq"),
            Some(("perpetuohq".into(), "mostra dados".into()))
        );
    }

    #[test]
    fn extract_at_integration_first_match_wins() {
        // Multi-mention: a primeira `@<name>` ganha; segunda fica
        // como texto na query (não há protocolo multi-integration).
        assert_eq!(
            ai("@github @perpetuohq foo"),
            Some(("github".into(), "@perpetuohq foo".into()))
        );
    }

    #[test]
    fn extract_at_integration_rejects_email_and_no_boundary() {
        // `email@host`: `@` sem whitespace/start atrás → não é mention.
        assert_eq!(ai("email@host"), None);
        assert_eq!(ai("user.name@example.com"), None);
    }

    #[test]
    fn extract_at_integration_rejects_bare_at() {
        assert_eq!(ai("@"), None);
        assert_eq!(ai("   @   "), None);
        // Whitespace imediatamente depois de @ → nome capturado seria
        // vazio, regex falha.
        assert_eq!(ai("@ teste"), None);
        assert_eq!(ai("oi @ teste"), None);
    }

    #[test]
    fn extract_at_integration_rejects_empty_or_no_mention() {
        assert_eq!(ai(""), None);
        assert_eq!(ai("    "), None);
        assert_eq!(ai("hello world"), None);
    }

    #[test]
    fn extract_integration_call_pure_json() {
        let r = r#"{"integration_call":{"endpoint":"/issues","params":{"state":"open"}}}"#;
        let call = extract_integration_call(r).unwrap();
        assert_eq!(call.endpoint, "/issues");
        let params = call.params.unwrap();
        assert!(params.iter().any(|(k, v)| k == "state" && v == "open"));
    }

    #[test]
    fn extract_integration_call_fenced_with_lang_tag() {
        let r = "```json\n{\"integration_call\":{\"endpoint\":\"/users/42\"}}\n```";
        let call = extract_integration_call(r).unwrap();
        assert_eq!(call.endpoint, "/users/42");
        assert!(call.params.is_none());
    }

    #[test]
    fn extract_integration_call_fenced_no_lang_tag() {
        let r = "```\n{\"integration_call\":{\"endpoint\":\"/me\"}}\n```";
        let call = extract_integration_call(r).unwrap();
        assert_eq!(call.endpoint, "/me");
    }

    #[test]
    fn extract_integration_call_returns_none_for_plain_text() {
        assert!(extract_integration_call("Olá! Aqui vai o resumo: ...").is_none());
        assert!(extract_integration_call("").is_none());
    }

    #[test]
    fn extract_integration_call_returns_none_without_envelope_key() {
        // Valid JSON but no integration_call key.
        assert!(extract_integration_call(r#"{"foo":"bar"}"#).is_none());
        // Different envelope shape.
        assert!(extract_integration_call(r#"{"endpoint":"/x"}"#).is_none());
    }

    #[test]
    fn extract_integration_call_stringifies_non_string_params() {
        let r = r#"{"integration_call":{"endpoint":"/x","params":{"page":3,"flag":true}}}"#;
        let call = extract_integration_call(r).unwrap();
        let params = call.params.unwrap();
        // Numbers and booleans get JSON-encoded so reqwest can pass
        // them as-is in the query string.
        assert!(params.iter().any(|(k, v)| k == "page" && v == "3"));
        assert!(params.iter().any(|(k, v)| k == "flag" && v == "true"));
    }

    #[test]
    fn extract_integration_call_handles_text_before_json() {
        // O GPT às vezes prefixa o envelope com prosa apesar do
        // PROMPT_INTEGRATION pedir JSON puro. O scan precisa pegar
        // mesmo assim — caso real do bug report.
        let r = "Para buscar o faturamento... Vou providenciar agora.\n\
                 {\"integration_call\": {\"endpoint\": \"/perpetuos\", \"params\": {}}}";
        let call = extract_integration_call(r).unwrap();
        assert_eq!(call.endpoint, "/perpetuos");
    }

    #[test]
    fn extract_integration_call_handles_text_after_json() {
        let r = "{\"integration_call\":{\"endpoint\":\"/x\"}} Conferindo agora.";
        let call = extract_integration_call(r).unwrap();
        assert_eq!(call.endpoint, "/x");
    }

    #[test]
    fn extract_integration_call_handles_braces_inside_strings() {
        // `{` / `}` dentro de strings JSON não devem desbalancear o
        // depth count — string-aware scan.
        let r = "{\"integration_call\":{\"endpoint\":\"/path/{id}/sub\",\"params\":{}}}";
        let call = extract_integration_call(r).unwrap();
        assert_eq!(call.endpoint, "/path/{id}/sub");
    }

    #[test]
    fn extract_integration_call_handles_escaped_quote_inside_string() {
        // `\"` dentro de string JSON não fecha o string state
        // prematuramente.
        let r = r#"{"integration_call":{"endpoint":"/q","params":{"k":"a\"b"}}}"#;
        let call = extract_integration_call(r).unwrap();
        assert_eq!(call.endpoint, "/q");
        let params = call.params.unwrap();
        assert!(params.iter().any(|(k, v)| k == "k" && v == "a\"b"));
    }

    #[test]
    fn extract_integration_call_returns_none_for_unbalanced() {
        // Marker presente mas envelope não fecha → None (não tenta
        // adivinhar).
        assert!(extract_integration_call("{\"integration_call\":").is_none());
        assert!(
            extract_integration_call("texto e {\"integration_call\":{\"endpoint\":\"/x\"")
                .is_none()
        );
    }

    #[test]
    fn extract_at_mentions_finds_word_boundary_only() {
        // Standalone + start-of-string both match.
        assert_eq!(extract_at_mentions("@terminal"), vec!["terminal"]);
        assert_eq!(
            extract_at_mentions("rode @terminal e @code"),
            vec!["terminal".to_string(), "code".to_string()],
        );
        // Embedded @ (e.g. email) must NOT match.
        assert_eq!(
            extract_at_mentions("contato@empresa.com"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn extract_at_mentions_dedupes_in_order() {
        assert_eq!(
            extract_at_mentions("@terminal abre, depois @terminal fecha"),
            vec!["terminal".to_string()],
        );
    }

    #[test]
    fn extract_at_mentions_pattern_constraints() {
        // Allowed: lowercase + digits + hyphens.
        assert_eq!(extract_at_mentions("@step-1"), vec!["step-1"]);
        // Uppercase right after @ kills the whole match — no capture.
        assert_eq!(extract_at_mentions("@Terminal"), Vec::<String>::new());
        // Underscore truncates the greedy `[a-z0-9-]+` mid-word; the
        // captured prefix still counts as a mention. This is the
        // documented behavior — `_` not in the spec's char class.
        assert_eq!(extract_at_mentions("@my_tool"), vec!["my".to_string()]);
    }

    #[test]
    fn extract_hash_mentions_mirrors_at_logic() {
        assert_eq!(extract_hash_mentions("#meu-projeto"), vec!["meu-projeto"]);
        assert_eq!(
            extract_hash_mentions("rode em #a e em #b"),
            vec!["a".to_string(), "b".to_string()],
        );
        // Hashtag-style mid-word doesn't match (no boundary).
        assert_eq!(extract_hash_mentions("issue#123"), Vec::<String>::new());
    }

    #[test]
    fn format_mentions_block_returns_empty_when_nothing_resolved() {
        let s = format_mentions_block(&[], &[]);
        assert!(s.is_empty());
    }

    #[test]
    fn format_mentions_block_emits_both_sections() {
        let caps = vec![("terminal".into(), "Roda comandos shell.".into())];
        let cams = vec![("meu".into(), "/home/user/meu".into())];
        let s = format_mentions_block(&caps, &cams);
        assert!(s.contains("## Capabilities mencionadas"));
        assert!(s.contains("### @terminal"));
        assert!(s.contains("Roda comandos shell."));
        assert!(s.contains("## Caminhos mencionados"));
        assert!(s.contains("### #meu"));
        assert!(s.contains("/home/user/meu"));
    }

    #[test]
    fn skill_agent_active_for_explicit_slash() {
        assert!(is_skill_agent_active("/criar-skill", Some("criar-skill")));
        // Even with extra args after the slash, the slash routing wins.
        assert!(is_skill_agent_active(
            "/criar-skill legendar videos",
            Some("criar-skill"),
        ));
    }

    #[test]
    fn skill_agent_active_for_natural_triggers() {
        assert!(is_skill_agent_active(
            "quero criar uma skill que legenda videos",
            None,
        ));
        assert!(is_skill_agent_active("Faz uma skill nova pra mim", None));
        assert!(is_skill_agent_active("CRIAR SKILL automatica", None));
    }

    #[test]
    fn skill_agent_inactive_for_unrelated_chat() {
        assert!(!is_skill_agent_active("oi tudo bem?", None));
        assert!(!is_skill_agent_active(
            "automatizar isso seria bom mas sem usar skill",
            None,
        ));
    }

    #[test]
    fn skill_agent_inactive_when_other_slash_active() {
        // /listar é um exemplo de slash não-AI-routed; mesmo se o
        // body bater num trigger de skill, o slash domina.
        assert!(!is_skill_agent_active(
            "/listar criar skill",
            Some("listar"),
        ));
    }

    #[test]
    fn skill_path_component_validation() {
        assert!(is_safe_skill_path_component("legendar-videos"));
        assert!(is_safe_skill_path_component("step_1"));
        assert!(!is_safe_skill_path_component(""));
        assert!(!is_safe_skill_path_component("../etc/passwd"));
        assert!(!is_safe_skill_path_component("foo/bar"));
        assert!(!is_safe_skill_path_component("foo\\bar"));
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
        let msg = render_confirmation(&skill, &[], &[]);
        assert!(msg.contains("**`demo`**"));
        assert!(msg.contains("1. **step_1** (`bash`): `echo hi`"));
        assert!(msg.contains("{{briefing}}"));
        assert!(msg.contains("Executar"));
        // Sem references / scripts: blocos não aparecem.
        assert!(!msg.contains("References disponíveis"));
        assert!(!msg.contains("Scripts disponíveis"));
    }

    #[test]
    fn render_confirmation_lists_references_when_present() {
        let skill = ParsedSkill {
            meta: SkillMeta {
                name: "demo".into(),
                description: "teste".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let refs = vec!["iron-man.md".to_string(), "thor.md".to_string()];
        let msg = render_confirmation(&skill, &refs, &[]);
        assert!(msg.contains("References disponíveis"));
        assert!(msg.contains("iron-man.md, thor.md"));
        assert!(msg.contains("`read_skill_reference`"));
    }

    #[test]
    fn render_confirmation_lists_scripts_when_present() {
        let skill = ParsedSkill {
            meta: SkillMeta {
                name: "demo".into(),
                description: "teste".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        let scripts = vec!["parse.sh".to_string(), "extract.py".to_string()];
        let msg = render_confirmation(&skill, &[], &scripts);
        assert!(msg.contains("Scripts disponíveis"));
        assert!(msg.contains("parse.sh, extract.py"));
        assert!(msg.contains("`read_skill_script`"));
    }
}
