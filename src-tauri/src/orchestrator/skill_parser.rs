//! Parser de skill `.md` → ParsedSkill tipado.
//!
//! Formato (inferido de docs/architecture.md §Skill Parser e docs/PRD.md §F1
//! na ausência do briefing formal):
//!
//! ```markdown
//! ---
//! name: criar-sistema            (obrigatório)
//! description: ...
//! version: 1.0.0
//! author: Bethel
//! ---
//!
//! # Tools
//! - claude-code
//! - bash
//!
//! # Inputs
//! - briefing_path
//!
//! # Steps
//!
//! ## step_1
//! tool: claude-code              (obrigatório por step)
//! prompt: |
//!   multiline suportado
//! validate: exit_code == 0
//! on_fail: retry 2
//!
//! ## step_loop
//! repeat: tasks.json
//! until: all_done
//!
//! # Outputs
//! - system_created
//!
//! # Config
//! timeout: 300
//! retries: 3
//! ```

use serde::{Deserialize, Serialize};

// ── structs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
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

    for (heading, section_body) in split_sections(body, 1) {
        match heading.to_lowercase().as_str() {
            "tools" => skill.tools = parse_list(&section_body),
            "inputs" => skill.inputs = parse_list(&section_body),
            "outputs" => skill.outputs = parse_list(&section_body),
            "config" => skill.config = parse_config(&section_body),
            "steps" => parse_steps(&section_body, &mut skill)?,
            _ => {} // unknown top-level sections are tolerated for forward compat
        }
    }

    Ok(skill)
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
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = unquote(value.trim()).to_string();
        match key.trim() {
            "name" => meta.name = value,
            "description" => meta.description = value,
            "version" => meta.version = value,
            "author" => meta.author = value,
            _ => {}
        }
    }
    meta
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
}
