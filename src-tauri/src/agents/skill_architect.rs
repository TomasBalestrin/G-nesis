//! Skill Architect — agente que conduz a criação de uma skill v2 via
//! conversa estruturada (entender → desenhar → auxiliares → validar).
//! System prompt é embeddeado em build-time via `include_str!` pra
//! não depender de FS no runtime e pra que o binário fique
//! self-contained.
//!
//! O agente também emite arquivos da skill em construção via tag
//! JSON `{"skill_write": {"path": ..., "content": ...}}` no meio da
//! resposta. [`extract_skill_writes`] varre o texto, valida os paths
//! contra a allowlist do package v2 (SKILL.md / references/*.md /
//! assets/* / scripts/*) e retorna a lista pra `run_agent_chat`
//! reemitir como evento `skill-architect:files-ready` pro frontend.

use serde::{Deserialize, Serialize};

use super::Agent;

/// System prompt fica em `src-tauri/agents/skill-architect.md` pra
/// permitir edição como markdown sem recompilar struct/raw string.
/// `include_str!` resolve o path relativo ao arquivo .rs corrente
/// (manifest dir é `src-tauri/`, então o `..` sobe pra raiz e desce
/// em agents/).
const SYSTEM_PROMPT: &str = include_str!("../../agents/skill-architect.md");

/// Zero-sized struct — agente não tem state. Cada `agent_chat` cria
/// uma instância nova via `lookup`.
pub struct SkillArchitect;

impl Agent for SkillArchitect {
    fn name(&self) -> &'static str {
        "skill-architect"
    }

    fn system_prompt(&self) -> String {
        SYSTEM_PROMPT.to_string()
    }

    fn can_web_search(&self) -> bool {
        true
    }

    fn can_write_files(&self) -> bool {
        true
    }
}

/// Pedido de escrita emitido pelo agente. Não toca disco — caller
/// (frontend) confirma com o usuário antes de salvar via os IPCs
/// existentes (`save_skill_file` / `save_skill_asset`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SkillWriteRequest {
    pub path: String,
    pub content: String,
}

/// Wire format do tag `{"skill_write": {...}}`. Mantida separada
/// do `SkillWriteRequest` final pra que o serde rejeite shapes
/// estranhos antes de chegar ao caller.
#[derive(Debug, Deserialize)]
struct SkillWriteEnvelope {
    skill_write: SkillWriteRequest,
}

/// Varre `response` em busca de objetos JSON `{"skill_write": ...}`,
/// parseia cada um e filtra os que têm path inválido. Tolerante a
/// JSON dentro de code-fences (` ```json `) ou inline na prosa.
///
/// Path traversal e formato são validados via [`is_valid_skill_path`];
/// pedidos rejeitados saem do retorno (com log em stderr) — o agente
/// vê que nada foi salvo e tenta de novo no próximo turno.
pub fn extract_skill_writes(response: &str) -> Vec<SkillWriteRequest> {
    let mut out: Vec<SkillWriteRequest> = Vec::new();
    let bytes = response.as_bytes();
    let needle = b"\"skill_write\"";

    let mut search_from = 0usize;
    while let Some(rel) = find_subslice(&bytes[search_from..], needle) {
        let key_pos = search_from + rel;
        // Volta até o `{` que abre o objeto que contém a key.
        let open = match find_object_open(bytes, key_pos) {
            Some(p) => p,
            None => {
                search_from = key_pos + needle.len();
                continue;
            }
        };
        // Procura o `}` que fecha esse mesmo objeto (balance-aware).
        let close = match find_object_close(bytes, open) {
            Some(p) => p,
            None => break,
        };

        let slice = &response[open..=close];
        match serde_json::from_str::<SkillWriteEnvelope>(slice) {
            Ok(env) => {
                if is_valid_skill_path(&env.skill_write.path) {
                    out.push(env.skill_write);
                } else {
                    eprintln!(
                        "[skill-architect] skill_write rejeitado (path inválido): `{}`",
                        env.skill_write.path
                    );
                }
            }
            Err(err) => {
                eprintln!(
                    "[skill-architect] skill_write malformado: {err} (slice: {})",
                    slice.chars().take(80).collect::<String>()
                );
            }
        }
        search_from = close + 1;
    }
    out
}

/// Allowlist do layout v2 (regra "NÃO criar subpastas vazias" do A1
/// é honrada porque caller que recebe o resultado decide quais
/// subpastas materializar — só as que terão arquivo). Aceita:
///   - "SKILL.md" exato
///   - "references/<arquivo>.md"
///   - "assets/<arquivo>"
///   - "scripts/<arquivo>"
///
/// Sem `..`, sem path absoluto, sem `\\`, sem subdiretórios aninhados
/// dentro de references/assets/scripts.
pub fn is_valid_skill_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.starts_with('/') || trimmed.contains('\\') {
        return false;
    }
    if trimmed
        .split('/')
        .any(|seg| seg.is_empty() || seg == "." || seg == "..")
    {
        return false;
    }

    if trimmed == "SKILL.md" {
        return true;
    }

    let parts: Vec<&str> = trimmed.split('/').collect();
    if parts.len() != 2 {
        return false;
    }
    let (sub, file) = (parts[0], parts[1]);
    match sub {
        "references" => file.to_ascii_lowercase().ends_with(".md"),
        "assets" | "scripts" => true,
        _ => false,
    }
}

// ── parsing helpers ─────────────────────────────────────────────────────────

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Volta a partir de `key_pos` procurando o `{` que abre o objeto
/// que contém a key `"skill_write"`. Conta `{`/`}` em direção ao
/// começo respeitando string escapadas é overkill — o agente
/// emite JSON-only payloads, não fragmentos colados a outro
/// objeto, então o primeiro `{` aberto é o nosso.
fn find_object_open(bytes: &[u8], key_pos: usize) -> Option<usize> {
    bytes[..key_pos].iter().rposition(|b| *b == b'{')
}

/// Encontra o `}` que fecha o objeto que abre em `open`. Trackeia
/// brace depth + ignora `}` dentro de strings (com escape de aspas).
fn find_object_close(bytes: &[u8], open: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut i = open;
    let mut in_string = false;
    let mut escaped = false;
    while i < bytes.len() {
        let b = bytes[i];
        if in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_string = false;
            }
        } else {
            match b {
                b'"' => in_string = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_prompt_includes_skill_architect_header() {
        let prompt = SkillArchitect.system_prompt();
        assert!(
            prompt.contains("Skill Architect"),
            "prompt inicial sem header esperado"
        );
        assert!(
            prompt.contains("SKILL.md"),
            "prompt deve mencionar o formato v2"
        );
    }

    #[test]
    fn is_valid_skill_path_accepts_canonical_layout() {
        assert!(is_valid_skill_path("SKILL.md"));
        assert!(is_valid_skill_path("references/iron-man.md"));
        assert!(is_valid_skill_path("assets/template.html"));
        assert!(is_valid_skill_path("scripts/parse.sh"));
    }

    #[test]
    fn is_valid_skill_path_rejects_traversal_and_nested() {
        assert!(!is_valid_skill_path(""));
        assert!(!is_valid_skill_path("/etc/passwd"));
        assert!(!is_valid_skill_path("../escape.md"));
        assert!(!is_valid_skill_path("references/../escape.md"));
        // Subpasta inválida.
        assert!(!is_valid_skill_path("foo/bar.md"));
        // Aninhamento dentro de references/assets/scripts.
        assert!(!is_valid_skill_path("references/sub/x.md"));
        assert!(!is_valid_skill_path("assets/img/a.png"));
        // references aceita só .md.
        assert!(!is_valid_skill_path("references/notes.txt"));
        // Backslash sempre rejeitado (windows-style).
        assert!(!is_valid_skill_path("references\\x.md"));
    }

    #[test]
    fn extract_skill_writes_single_inline() {
        let response = r#"Beleza, vou criar a skill. Aqui:
{"skill_write": {"path": "SKILL.md", "content": "---\nname: foo\n---"}}
Pronto."#;
        let writes = extract_skill_writes(response);
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].path, "SKILL.md");
        assert!(writes[0].content.contains("name: foo"));
    }

    #[test]
    fn extract_skill_writes_multiple_blocks() {
        let response = r#"Vou gerar dois arquivos.
```json
{"skill_write": {"path": "SKILL.md", "content": "skill body"}}
```
E também o módulo:
```json
{"skill_write": {"path": "references/iron-man.md", "content": "ref body"}}
```"#;
        let writes = extract_skill_writes(response);
        assert_eq!(writes.len(), 2);
        assert_eq!(writes[0].path, "SKILL.md");
        assert_eq!(writes[1].path, "references/iron-man.md");
    }

    #[test]
    fn extract_skill_writes_filters_invalid_paths() {
        let response = r#"
{"skill_write": {"path": "../escape.md", "content": "evil"}}
{"skill_write": {"path": "SKILL.md", "content": "ok"}}
{"skill_write": {"path": "references/sub/nested.md", "content": "evil"}}
"#;
        let writes = extract_skill_writes(response);
        assert_eq!(writes.len(), 1, "só SKILL.md sobrevive");
        assert_eq!(writes[0].path, "SKILL.md");
    }

    #[test]
    fn extract_skill_writes_handles_quoted_braces_in_content() {
        // O content tem `}` dentro de string — find_object_close
        // precisa ignorar.
        let response = r#"
{"skill_write": {"path": "SKILL.md", "content": "function() { return 1; }"}}
"#;
        let writes = extract_skill_writes(response);
        assert_eq!(writes.len(), 1);
        assert!(writes[0].content.contains("return 1"));
    }

    #[test]
    fn extract_skill_writes_empty_when_no_payload() {
        assert!(extract_skill_writes("texto livre sem JSON").is_empty());
        assert!(extract_skill_writes("{}").is_empty());
    }
}
