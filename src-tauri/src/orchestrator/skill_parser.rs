//! Parser de skill `.md` → ParsedSkill tipado.
//!
//! Suporta dois formatos:
//!
//! ## v1 (técnico)
//!
//! ```markdown
//! ---
//! name: criar-sistema
//! description: ...
//! version: 1.0.0
//! author: Bethel
//! triggers:
//!   - palavra-chave-1
//! ---
//!
//! # Tools
//! - claude-code
//! - bash
//!
//! # Pré-requisitos
//! - ffmpeg instalado
//!
//! # Inputs
//! - briefing_path
//!
//! # Steps
//!
//! ## step_1
//! tool: claude-code
//! prompt: |
//!   multiline suportado
//! validate: exit_code == 0
//! on_fail: retry 2
//!
//! # Outputs
//! - system_created
//!
//! # Config
//! timeout: 300
//! ```
//!
//! ## v2 (descritivo)
//!
//! Auto-detectado quando a frontmatter declara `version: "2.x"` OU quando o
//! corpo contém `## Etapa N` / `# Pré-requisitos`. Usa rótulos em português
//! e mapeia transparentemente para a mesma `ParsedSkill`.
//!
//! ```markdown
//! ---
//! name: legendar-videos
//! description: Lista vídeos e legenda
//! version: "2.0"
//! triggers:
//!   - legendar
//!   - subtitle
//! ---
//!
//! # Pré-requisitos
//! - ffmpeg instalado
//! - whisper-cpp instalado
//!
//! ## Etapa 1
//! Objetivo: Listar arquivos .mov no projeto
//! Canal: bash
//! Ação: find {{repo_path}} -name "*.mov"
//! Validação: exit_code == 0
//! Se falhar: retry 2
//!
//! ## Etapa 2
//! Objetivo: Para cada vídeo, extrair áudio e gerar legenda
//! Canal: claude-code
//! Ação: |
//!   Para cada arquivo da Etapa 1, extraia o áudio com ffmpeg e
//!   gere as legendas com whisper-cpp.
//! Validação: output contains "ok"
//! Se falhar: continue
//! ```

use serde::{Deserialize, Serialize};

// ── structs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    /// Lista opcional de palavras-chave que ativam esta skill via dispatcher
    /// de NLU (futuro). Frontmatter aceita bloco YAML (`triggers:` + linhas
    /// `- foo`) ou inline (`triggers: [foo, bar]`).
    #[serde(default)]
    pub triggers: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillStep {
    pub id: String,
    pub tool: String,
    pub command: Option<String>,
    pub prompt: Option<String>,
    pub context: Option<String>,
    pub validate: Option<String>,
    pub on_fail: Option<String>,
    pub on_success: Option<String>,
    /// Texto livre descrevendo o "porquê" do step. Preenchido pelo formato
    /// v2 (label `Objetivo:`); ausente em v1.
    #[serde(default)]
    pub objective: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepLoop {
    pub repeat: String,
    pub until: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillConfig {
    pub timeout: Option<u64>,
    pub retries: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedSkill {
    pub meta: SkillMeta,
    pub tools: Vec<String>,
    pub inputs: Vec<String>,
    pub steps: Vec<SkillStep>,
    pub step_loop: Option<StepLoop>,
    pub outputs: Vec<String>,
    pub config: SkillConfig,
    /// Lista opcional de pré-requisitos (binários, env vars, etc) que o
    /// usuário precisa garantir antes da skill rodar. Renderizada na UI
    /// como checklist; o executor não verifica nada hoje.
    #[serde(default)]
    pub prerequisites: Vec<String>,
}

// ── public API ──────────────────────────────────────────────────────────────

pub fn parse_skill(content: &str) -> Result<ParsedSkill, String> {
    let (frontmatter, body) = split_frontmatter(content)?;
    let meta = parse_frontmatter(frontmatter);
    if meta.name.trim().is_empty() {
        return Err("skill sem `name` no frontmatter".into());
    }

    let mut skill = ParsedSkill {
        meta,
        ..Default::default()
    };

    // v2 detection: explicit version 2.x in frontmatter OR body contains a
    // ## Etapa heading. Both formats can coexist (v2 may include a # Tools
    // section for clarity), so we allow per-section dispatch below.
    let is_v2 = skill.meta.version.starts_with("2.")
        || body.lines().any(is_v2_etapa_heading);

    let v1_top_sections = split_sections(body, 1);

    // v2 puts Etapa headings at level 2 directly under the frontmatter (no
    // wrapping `# Steps` parent). Collect them up-front so we can detect
    // mixed layouts.
    let v2_etapas: Vec<(String, String)> = if is_v2 {
        split_sections(body, 2)
            .into_iter()
            .filter(|(h, _)| is_v2_etapa_heading(&format!("## {h}")))
            .collect()
    } else {
        Vec::new()
    };

    for (heading, section_body) in v1_top_sections {
        match normalize_heading(&heading).as_str() {
            "tools" => skill.tools = parse_list(&section_body),
            "inputs" => skill.inputs = parse_list(&section_body),
            "outputs" => skill.outputs = parse_list(&section_body),
            "config" => skill.config = parse_config(&section_body),
            "steps" => parse_steps(&section_body, &mut skill)?,
            "pre-requisitos" | "prerequisites" => {
                skill.prerequisites = parse_list(&section_body);
            }
            _ => {} // unknown top-level sections are tolerated for forward compat
        }
    }

    // v2 etapas are appended after any v1 steps. In a pure v2 file, v1 path
    // produced zero steps; the etapas become steps[0..N]. In a mixed file,
    // both contribute (rare, but we don't reject it).
    for (idx, (heading, body)) in v2_etapas.into_iter().enumerate() {
        let step_id = etapa_id(&heading, idx);
        skill.steps.push(parse_etapa(&step_id, &body)?);
    }

    Ok(skill)
}

fn is_v2_etapa_heading(line: &str) -> bool {
    // Match `## Etapa <n>` (case-insensitive, accents tolerated). The
    // numeric suffix is enforced so plain "## Etapas" doesn't false-match.
    let trimmed = line.trim_start_matches('#').trim();
    let lower = trimmed.to_lowercase();
    let Some(rest) = lower.strip_prefix("etapa ") else {
        return false;
    };
    rest.chars()
        .next()
        .map(|c| c.is_ascii_digit())
        .unwrap_or(false)
}

fn etapa_id(heading: &str, fallback_idx: usize) -> String {
    let lower = heading.to_lowercase();
    let after = lower
        .strip_prefix("etapa ")
        .unwrap_or(&lower)
        .trim();
    let n: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    if n.is_empty() {
        format!("step_{}", fallback_idx + 1)
    } else {
        format!("step_{n}")
    }
}

/// Lower-case + strip diacritics on the few accents we expect in PT-BR
/// section headings ("Pré-requisitos"). Keeps the matcher branch flat and
/// avoids pulling in unicode-normalization for one or two characters.
fn normalize_heading(h: &str) -> String {
    h.trim()
        .to_lowercase()
        .replace('é', "e")
        .replace('í', "i")
        .replace('ó', "o")
        .replace('á', "a")
        .replace('ã', "a")
        .replace('ç', "c")
        .replace('ú', "u")
}

// ── frontmatter ─────────────────────────────────────────────────────────────

fn split_frontmatter(content: &str) -> Result<(&str, &str), String> {
    let trimmed = content.trim_start();
    let rest = trimmed
        .strip_prefix("---")
        .ok_or("skill sem frontmatter (esperado bloco entre `---`)")?;
    let rest = rest.trim_start_matches(['\r', '\n']);
    let end = rest
        .find("\n---")
        .ok_or("skill com frontmatter não fechado")?;
    let frontmatter = &rest[..end];
    let body = rest[end..]
        .trim_start_matches("\n---")
        .trim_start_matches(['\r', '\n']);
    Ok((frontmatter, body))
}

fn parse_frontmatter(raw: &str) -> SkillMeta {
    let mut meta = SkillMeta::default();
    let lines: Vec<&str> = raw.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            i += 1;
            continue;
        }
        let Some((key, raw_value)) = trimmed.split_once(':') else {
            i += 1;
            continue;
        };
        let key = key.trim();
        let value_part = raw_value.trim();

        match key {
            "name" => meta.name = unquote(value_part).to_string(),
            "description" => meta.description = unquote(value_part).to_string(),
            "version" => meta.version = unquote(value_part).to_string(),
            "author" => meta.author = unquote(value_part).to_string(),
            "triggers" => {
                if value_part.is_empty() {
                    // YAML block list: collect following indented `- ...` lines.
                    let mut j = i + 1;
                    while j < lines.len() {
                        let next = lines[j];
                        if next.trim().is_empty() {
                            j += 1;
                            continue;
                        }
                        if next.starts_with(' ') || next.starts_with('\t') {
                            if let Some(item) = next.trim().strip_prefix("- ") {
                                let val = unquote(item.trim()).to_string();
                                if !val.is_empty() {
                                    meta.triggers.push(val);
                                }
                            }
                            j += 1;
                        } else {
                            break;
                        }
                    }
                    i = j;
                    continue;
                } else {
                    // YAML inline list: `[a, b, c]` or single string.
                    meta.triggers = parse_inline_list(value_part);
                }
            }
            _ => {}
        }
        i += 1;
    }
    meta
}

/// Parse `[a, b, "c d"]` or a single bare value into a list. Unwraps the
/// surrounding brackets if present, then splits by `,` and unquotes each
/// token. Empty tokens are filtered.
fn parse_inline_list(raw: &str) -> Vec<String> {
    let inner = raw
        .trim()
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(raw);
    inner
        .split(',')
        .map(|s| unquote(s.trim()).to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

// ── sections ────────────────────────────────────────────────────────────────

/// Split a markdown body by ATX headings at `level` exactly. Deeper headings
/// (e.g. `##` when splitting by `#`) stay in the current section's body.
fn split_sections(content: &str, level: usize) -> Vec<(String, String)> {
    let hash: String = "#".repeat(level);
    let deeper: String = "#".repeat(level + 1);
    let mut sections: Vec<(String, String)> = Vec::new();
    let mut current: Option<(String, Vec<&str>)> = None;

    for line in content.lines() {
        if line.starts_with(&hash) && !line.starts_with(&deeper) {
            let after = &line[hash.len()..];
            if let Some(rest) = after.strip_prefix(' ') {
                if let Some((h, body)) = current.take() {
                    sections.push((h, body.join("\n")));
                }
                current = Some((rest.trim().to_string(), Vec::new()));
                continue;
            }
        }
        if let Some((_, body)) = current.as_mut() {
            body.push(line);
        }
    }
    if let Some((h, body)) = current {
        sections.push((h, body.join("\n")));
    }
    sections
}

fn parse_list(content: &str) -> Vec<String> {
    content
        .lines()
        .map(str::trim)
        .filter_map(|l| l.strip_prefix("- "))
        .map(|l| l.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_config(content: &str) -> SkillConfig {
    let mut cfg = SkillConfig::default();
    for (key, value) in parse_key_values(content) {
        match key.as_str() {
            "timeout" => cfg.timeout = value.parse().ok(),
            "retries" => cfg.retries = value.parse().ok(),
            _ => {}
        }
    }
    cfg
}

// ── steps ───────────────────────────────────────────────────────────────────

fn parse_steps(content: &str, skill: &mut ParsedSkill) -> Result<(), String> {
    for (heading, body) in split_sections(content, 2) {
        let id = heading.trim();
        if id == "step_loop" {
            skill.step_loop = Some(parse_step_loop(&body));
        } else if id.starts_with("step_") {
            skill.steps.push(parse_step(id, &body)?);
        }
    }
    Ok(())
}

fn parse_step(id: &str, body: &str) -> Result<SkillStep, String> {
    let mut step = SkillStep {
        id: id.to_string(),
        ..Default::default()
    };

    for (key, value) in parse_key_values(body) {
        match key.as_str() {
            "tool" => step.tool = value,
            "command" => step.command = Some(value),
            "prompt" => step.prompt = Some(value),
            "context" => step.context = Some(value),
            "validate" => step.validate = Some(value),
            "on_fail" => step.on_fail = Some(value),
            "on_success" => step.on_success = Some(value),
            _ => {} // unknown keys ignored
        }
    }

    if step.tool.trim().is_empty() {
        return Err(format!("`{id}` sem `tool` (campo obrigatório)"));
    }

    Ok(step)
}

fn parse_step_loop(body: &str) -> StepLoop {
    let mut sl = StepLoop::default();
    for (key, value) in parse_key_values(body) {
        match key.as_str() {
            "repeat" => sl.repeat = value,
            "until" => sl.until = value,
            _ => {}
        }
    }
    sl
}

// ── v2 Etapa parser ─────────────────────────────────────────────────────────

/// Parse the body of a `## Etapa N` block. Recognises localized labels
/// (`Objetivo`, `Canal`, `Ação`, `Validação`, `Se falhar`) and routes
/// `Ação` to either `command` (for bash/api channels) or `prompt` (for
/// claude-code) based on the declared `Canal`.
fn parse_etapa(id: &str, body: &str) -> Result<SkillStep, String> {
    let mut step = SkillStep {
        id: id.to_string(),
        ..Default::default()
    };
    let mut acao: Option<String> = None;

    for (key, value) in parse_etapa_key_values(body) {
        match normalize_label(&key).as_str() {
            "objetivo" => step.objective = Some(value),
            "canal" => step.tool = value.trim().to_string(),
            "acao" => acao = Some(value),
            "validacao" | "validate" => step.validate = Some(value),
            "se falhar" | "on_fail" => step.on_fail = Some(value),
            "se sucesso" | "on_success" => step.on_success = Some(value),
            "contexto" | "context" => step.context = Some(value),
            _ => {} // forward-compat for new labels
        }
    }

    if step.tool.trim().is_empty() {
        return Err(format!("`{id}` sem `Canal` (campo obrigatório)"));
    }

    if let Some(value) = acao {
        match step.tool.as_str() {
            "claude-code" => step.prompt = Some(value),
            // bash, api, anything else: treat as a command string.
            _ => step.command = Some(value),
        }
    }

    Ok(step)
}

/// Same multiline `|` / `>` semantics as `parse_key_values`, but the key
/// matcher is permissive: multi-word keys like `Se falhar:` are allowed.
fn parse_etapa_key_values(content: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        if line.trim().is_empty() {
            i += 1;
            continue;
        }

        let Some(idx) = line.find(':') else {
            i += 1;
            continue;
        };
        let (raw_key, raw_value) = line.split_at(idx);
        // raw_value still includes the leading ':'.
        let raw_value = &raw_value[1..];
        let key = raw_key.trim();
        if key.is_empty() {
            i += 1;
            continue;
        }
        let value_part = raw_value.trim();

        if value_part == "|" || value_part == ">" {
            let mut block: Vec<&str> = Vec::new();
            let mut j = i + 1;
            while j < lines.len() {
                let next = lines[j];
                if next.trim().is_empty() {
                    block.push("");
                    j += 1;
                    continue;
                }
                if next.starts_with(' ') || next.starts_with('\t') {
                    block.push(next);
                    j += 1;
                } else {
                    break;
                }
            }
            while block.last().map(|l| l.is_empty()).unwrap_or(false) {
                block.pop();
            }
            let dedented = dedent(&block);
            let joined = if value_part == ">" {
                fold_lines(&dedented)
            } else {
                dedented.join("\n")
            };
            out.push((key.to_string(), joined));
            i = j;
        } else {
            out.push((key.to_string(), unquote(value_part).to_string()));
            i += 1;
        }
    }

    out
}

/// Lower-case + strip the few accents we know about. Keeps the matcher
/// arms readable (`"acao"`, `"validacao"`) and tolerant of ASCII fallbacks
/// users sometimes type when their keyboard layout is uncooperative.
fn normalize_label(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .replace('ç', "c")
        .replace('ã', "a")
        .replace('á', "a")
        .replace('â', "a")
        .replace('é', "e")
        .replace('ê', "e")
        .replace('í', "i")
        .replace('ó', "o")
        .replace('ô', "o")
        .replace('ú', "u")
}

// ── key: value parser with YAML-style `|` multiline blocks ──────────────────

fn parse_key_values(content: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        if line.trim().is_empty() {
            i += 1;
            continue;
        }

        let Some((key, raw_value)) = split_key_value(line) else {
            i += 1;
            continue;
        };
        let value_part = raw_value.trim();

        if value_part == "|" || value_part == ">" {
            // Collect the following indented block.
            let mut block: Vec<&str> = Vec::new();
            let mut j = i + 1;
            while j < lines.len() {
                let next = lines[j];
                if next.trim().is_empty() {
                    block.push("");
                    j += 1;
                    continue;
                }
                if next.starts_with(' ') || next.starts_with('\t') {
                    block.push(next);
                    j += 1;
                } else {
                    break;
                }
            }
            // Trim trailing blank lines.
            while block.last().map(|l| l.is_empty()).unwrap_or(false) {
                block.pop();
            }
            let joined = dedent(&block);
            let joined = if value_part == ">" {
                // Folded: join non-empty lines with spaces, preserve blank-line paragraph breaks.
                fold_lines(&joined)
            } else {
                joined.join("\n")
            };
            out.push((key.to_string(), joined));
            i = j;
        } else {
            out.push((key.to_string(), unquote(value_part).to_string()));
            i += 1;
        }
    }

    out
}

fn split_key_value(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    let key = key.trim();
    if key.is_empty() || key.contains(char::is_whitespace) {
        return None;
    }
    Some((key, value))
}

fn unquote(s: &str) -> &str {
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

fn dedent(block: &[&str]) -> Vec<String> {
    let min_indent = block
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.bytes().take_while(|b| *b == b' ' || *b == b'\t').count())
        .min()
        .unwrap_or(0);
    block
        .iter()
        .map(|l| {
            if l.len() >= min_indent {
                l[min_indent..].to_string()
            } else {
                (*l).to_string()
            }
        })
        .collect()
}

fn fold_lines(lines: &[String]) -> String {
    let mut result = String::new();
    let mut prev_blank = true;
    for line in lines {
        if line.is_empty() {
            result.push('\n');
            prev_blank = true;
        } else {
            if !prev_blank {
                result.push(' ');
            }
            result.push_str(line);
            prev_blank = false;
        }
    }
    result
}

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"---
name: criar-sistema
description: Cria um sistema novo a partir de briefing
version: 1.0.0
author: Bethel
---

# Tools
- claude-code
- bash

# Inputs
- briefing_path
- repo_path

# Steps

## step_1
tool: claude-code
prompt: |
  Leia o briefing em {{briefing_path}}
  e gere a estrutura inicial
validate: exit_code == 0
on_fail: retry 2

## step_2
tool: bash
command: git -C {{repo_path}} init
validate: exit_code == 0
on_success: commit_inicial

## step_loop
repeat: tasks.json
until: all_done

# Outputs
- system_created
- committed

# Config
timeout: 300
retries: 3
"#;

    #[test]
    fn parses_happy_path() {
        let skill = parse_skill(SAMPLE).expect("parse");

        assert_eq!(skill.meta.name, "criar-sistema");
        assert_eq!(skill.meta.description, "Cria um sistema novo a partir de briefing");
        assert_eq!(skill.meta.version, "1.0.0");
        assert_eq!(skill.meta.author, "Bethel");

        assert_eq!(skill.tools, vec!["claude-code", "bash"]);
        assert_eq!(skill.inputs, vec!["briefing_path", "repo_path"]);
        assert_eq!(skill.outputs, vec!["system_created", "committed"]);

        assert_eq!(skill.steps.len(), 2);

        let s1 = &skill.steps[0];
        assert_eq!(s1.id, "step_1");
        assert_eq!(s1.tool, "claude-code");
        let prompt = s1.prompt.as_deref().unwrap();
        assert!(prompt.contains("Leia o briefing em {{briefing_path}}"));
        assert!(prompt.contains("e gere a estrutura inicial"));
        assert_eq!(s1.validate.as_deref(), Some("exit_code == 0"));
        assert_eq!(s1.on_fail.as_deref(), Some("retry 2"));

        let s2 = &skill.steps[1];
        assert_eq!(s2.tool, "bash");
        assert_eq!(s2.command.as_deref(), Some("git -C {{repo_path}} init"));
        assert_eq!(s2.on_success.as_deref(), Some("commit_inicial"));

        let sl = skill.step_loop.as_ref().expect("step_loop");
        assert_eq!(sl.repeat, "tasks.json");
        assert_eq!(sl.until, "all_done");

        assert_eq!(skill.config.timeout, Some(300));
        assert_eq!(skill.config.retries, Some(3));
    }

    #[test]
    fn rejects_missing_frontmatter() {
        let err = parse_skill("# Tools\n- x\n").expect_err("no frontmatter");
        assert!(
            err.to_lowercase().contains("frontmatter"),
            "unexpected err: {err}"
        );
    }

    #[test]
    fn rejects_missing_name() {
        let content = "---\ndescription: no name\n---\n# Tools\n- x\n";
        let err = parse_skill(content).expect_err("missing name");
        assert!(err.to_lowercase().contains("name"), "unexpected err: {err}");
    }

    #[test]
    fn rejects_step_without_tool() {
        let content = r#"---
name: x
---

# Steps

## step_1
command: echo hi
"#;
        let err = parse_skill(content).expect_err("missing tool");
        assert!(err.to_lowercase().contains("tool"), "unexpected err: {err}");
    }

    #[test]
    fn unknown_top_level_section_is_tolerated() {
        let content = r#"---
name: x
---

# Tools
- bash

# Notes
qualquer coisa aqui deveria ser ignorada.
"#;
        let skill = parse_skill(content).expect("parses");
        assert_eq!(skill.tools, vec!["bash"]);
    }

    #[test]
    fn single_line_values_are_unquoted() {
        let content = r#"---
name: "x"
description: 'with quotes'
---
# Steps
## step_1
tool: bash
command: "echo hello"
"#;
        let skill = parse_skill(content).expect("parses");
        assert_eq!(skill.meta.name, "x");
        assert_eq!(skill.meta.description, "with quotes");
        assert_eq!(skill.steps[0].command.as_deref(), Some("echo hello"));
    }

    #[test]
    fn multiline_block_preserves_newlines_and_dedents() {
        let content = r#"---
name: x
---
# Steps
## step_1
tool: claude-code
prompt: |
  line one
  line two
    nested four spaces
"#;
        let skill = parse_skill(content).expect("parses");
        let prompt = skill.steps[0].prompt.as_deref().unwrap();
        assert_eq!(prompt, "line one\nline two\n  nested four spaces");
    }

    // ── v2 (descritivo) ─────────────────────────────────────────────────────

    const V2_SAMPLE: &str = r#"---
name: legendar-videos
description: Lista vídeos e gera legendas
version: "2.0"
author: Bethel
triggers:
  - legendar
  - subtitle
---

# Pré-requisitos
- ffmpeg instalado
- whisper-cpp no PATH

## Etapa 1
Objetivo: Listar arquivos .mov no projeto
Canal: bash
Ação: find {{repo_path}} -name "*.mov"
Validação: exit_code == 0
Se falhar: retry 2

## Etapa 2
Objetivo: Para cada vídeo, extrair áudio e gerar legenda
Canal: claude-code
Ação: |
  Para cada arquivo da Etapa 1, extraia o áudio com ffmpeg
  e gere as legendas com whisper-cpp.
Validação: output contains "ok"
Se falhar: continue
"#;

    #[test]
    fn v2_parses_etapas_into_steps() {
        let skill = parse_skill(V2_SAMPLE).expect("parses");

        assert_eq!(skill.meta.name, "legendar-videos");
        assert_eq!(skill.meta.version, "2.0");
        assert_eq!(skill.meta.triggers, vec!["legendar", "subtitle"]);

        assert_eq!(
            skill.prerequisites,
            vec!["ffmpeg instalado", "whisper-cpp no PATH"],
        );

        assert_eq!(skill.steps.len(), 2);

        let s1 = &skill.steps[0];
        assert_eq!(s1.id, "step_1");
        assert_eq!(s1.tool, "bash");
        assert_eq!(
            s1.objective.as_deref(),
            Some("Listar arquivos .mov no projeto"),
        );
        // Bash channels route Ação → command.
        assert_eq!(
            s1.command.as_deref(),
            Some(r#"find {{repo_path}} -name "*.mov""#),
        );
        assert!(s1.prompt.is_none());
        assert_eq!(s1.validate.as_deref(), Some("exit_code == 0"));
        assert_eq!(s1.on_fail.as_deref(), Some("retry 2"));

        let s2 = &skill.steps[1];
        assert_eq!(s2.id, "step_2");
        assert_eq!(s2.tool, "claude-code");
        // claude-code routes Ação → prompt (preserving newlines via |).
        let prompt = s2.prompt.as_deref().expect("prompt set for claude-code");
        assert!(prompt.contains("Etapa 1"));
        assert!(prompt.contains("whisper-cpp"));
        assert!(s2.command.is_none());
        assert_eq!(s2.on_fail.as_deref(), Some("continue"));
    }

    #[test]
    fn v2_inline_triggers_list_works() {
        let content = r#"---
name: x
version: "2.0"
triggers: [foo, "bar baz", qux]
---
## Etapa 1
Canal: bash
Ação: echo hi
"#;
        let skill = parse_skill(content).expect("parses");
        assert_eq!(skill.meta.triggers, vec!["foo", "bar baz", "qux"]);
        assert_eq!(skill.steps.len(), 1);
        assert_eq!(skill.steps[0].tool, "bash");
    }

    #[test]
    fn v2_detected_by_etapa_heading_even_without_version_2() {
        // No `version: "2.x"` in frontmatter, but the body has `## Etapa N`
        // — auto-detection kicks in and the etapa becomes a step.
        let content = r#"---
name: misto
---
## Etapa 1
Canal: bash
Ação: echo hello
Validação: exit_code == 0
"#;
        let skill = parse_skill(content).expect("parses");
        assert_eq!(skill.steps.len(), 1);
        assert_eq!(skill.steps[0].id, "step_1");
        assert_eq!(skill.steps[0].command.as_deref(), Some("echo hello"));
    }

    #[test]
    fn v2_etapa_without_canal_errors() {
        let content = r#"---
name: x
version: "2.0"
---
## Etapa 1
Objetivo: faltou o canal
Ação: echo hi
"#;
        let err = parse_skill(content).expect_err("missing canal");
        assert!(err.to_lowercase().contains("canal"), "unexpected err: {err}");
    }

    #[test]
    fn v1_still_parses_when_v2_features_unused() {
        // SAMPLE is the v1 fixture from the existing happy-path test —
        // re-running it through the new parser must yield identical
        // output, with the new fields defaulted.
        let skill = parse_skill(SAMPLE).expect("parse");
        assert_eq!(skill.meta.triggers, Vec::<String>::new());
        assert_eq!(skill.prerequisites, Vec::<String>::new());
        assert!(skill.steps[0].objective.is_none());
        // Steps[0] still uses v1 prompt path.
        assert!(skill.steps[0].prompt.is_some());
    }

    #[test]
    fn prerequisites_section_works_in_v1_too() {
        let content = r#"---
name: x
---
# Pré-requisitos
- ffmpeg
- python3

# Steps
## step_1
tool: bash
command: echo ok
"#;
        let skill = parse_skill(content).expect("parses");
        assert_eq!(skill.prerequisites, vec!["ffmpeg", "python3"]);
    }
}
