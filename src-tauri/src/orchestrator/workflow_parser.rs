//! Parser de workflow `.md` → ParsedWorkflow tipado.
//!
//! Workflow encadeia skills numa sequência ordenada com inputs/outputs e
//! condições de execução. Layout descritivo (mesmo espírito do skill v2):
//!
//! ```markdown
//! ---
//! name: limpar-e-publicar
//! description: Limpa o repo e publica nova versão
//! version: "1.0"
//! author: Bethel
//! triggers:
//!   - publicar
//!   - release
//! ---
//!
//! # Pré-requisitos
//! - skill `criar-sistema` instalada
//! - branch main limpa
//!
//! ## Etapa 1
//! Skill: criar-sistema
//! Input: {{repo_path}}
//! Output: estrutura
//! Condição: sempre
//!
//! ## Etapa 2
//! Skill: debug-sistema
//! Input: {{etapa_1.estrutura}}
//! Output: relatorio
//! Condição: sucesso
//! ```
//!
//! Self-contained — não compartilha helpers com `skill_parser` para evitar
//! acoplamento; quando um terceiro consumidor surgir, vale extrair um
//! `md_utils` comum.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

// ── structs ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkflowMeta {
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    #[serde(default)]
    pub triggers: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkflowStep {
    /// `step_1`, `step_2`, … derived from `## Etapa N` heading.
    pub id: String,
    /// Name of the skill this step invokes (`Skill: <name>`). Required.
    pub skill: String,
    /// Optional input expression — passed verbatim to the variable resolver
    /// when the workflow runs. Either `{{var}}` references or literal text.
    pub input: Option<String>,
    /// Named output the step exposes for downstream `{{step_N.output}}`
    /// references. Currently a single label per step (no nested objects).
    pub output: Option<String>,
    /// Condition controlling whether this step runs. Recognised forms:
    ///   - `sempre` / `always`              — unconditional (default)
    ///   - `sucesso` / `success`            — previous step succeeded
    ///   - `falha` / `failure`              — previous step failed
    ///   - any other free-form expression  — passed through to a future
    ///     condition evaluator (validator-style grammar)
    pub condition: Option<String>,
    /// Free-text label from `Objetivo:` — same purpose as in skill v2.
    /// Renderable in the UI; ignored by the executor.
    #[serde(default)]
    pub objective: Option<String>,
    /// Multi-input form (`Inputs:` plural with indented `key: value` lines)
    /// for steps that need to thread several named values into a skill.
    /// Empty when the user used the singular `Input:` form.
    #[serde(default)]
    pub inputs: HashMap<String, String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedWorkflow {
    pub meta: WorkflowMeta,
    #[serde(default)]
    pub prerequisites: Vec<String>,
    pub steps: Vec<WorkflowStep>,
}

// ── public API ──────────────────────────────────────────────────────────────

pub fn parse_workflow(content: &str) -> Result<ParsedWorkflow, String> {
    let (frontmatter, body) = split_frontmatter(content)?;
    let meta = parse_frontmatter(frontmatter);
    if meta.name.trim().is_empty() {
        return Err("workflow sem `name` no frontmatter".into());
    }

    let mut wf = ParsedWorkflow {
        meta,
        ..Default::default()
    };

    for (heading, section_body) in split_sections(body, 1) {
        match normalize_heading(&heading).as_str() {
            "pre-requisitos" | "prerequisites" => {
                wf.prerequisites = parse_list(&section_body);
            }
            _ => {} // ignore unknown level-1 sections (forward-compat)
        }
    }

    let etapas: Vec<(String, String)> = split_sections(body, 2)
        .into_iter()
        .filter(|(h, _)| is_etapa_heading(&format!("## {h}")))
        .collect();

    if etapas.is_empty() {
        return Err("workflow sem etapas — esperado ao menos um `## Etapa N`".into());
    }

    for (idx, (heading, body)) in etapas.into_iter().enumerate() {
        let step_id = etapa_id(&heading, idx);
        wf.steps.push(parse_etapa(&step_id, &body)?);
    }

    Ok(wf)
}

// ── frontmatter ─────────────────────────────────────────────────────────────

fn split_frontmatter(content: &str) -> Result<(&str, &str), String> {
    let trimmed = content.trim_start();
    let rest = trimmed
        .strip_prefix("---")
        .ok_or("workflow sem frontmatter (esperado bloco entre `---`)")?;
    let rest = rest.trim_start_matches(['\r', '\n']);
    let end = rest
        .find("\n---")
        .ok_or("workflow com frontmatter não fechado")?;
    let frontmatter = &rest[..end];
    let body = rest[end..]
        .trim_start_matches("\n---")
        .trim_start_matches(['\r', '\n']);
    Ok((frontmatter, body))
}

fn parse_frontmatter(raw: &str) -> WorkflowMeta {
    let mut meta = WorkflowMeta::default();
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
                    meta.triggers = parse_inline_list(value_part);
                }
            }
            _ => {}
        }
        i += 1;
    }
    meta
}

// ── sections ────────────────────────────────────────────────────────────────

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

fn is_etapa_heading(line: &str) -> bool {
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
    let after = lower.strip_prefix("etapa ").unwrap_or(&lower).trim();
    let n: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
    if n.is_empty() {
        format!("step_{}", fallback_idx + 1)
    } else {
        format!("step_{n}")
    }
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

// ── Etapa body ──────────────────────────────────────────────────────────────

fn parse_etapa(id: &str, body: &str) -> Result<WorkflowStep, String> {
    let mut step = WorkflowStep {
        id: id.to_string(),
        ..Default::default()
    };
    let mut input_block_lines: Option<Vec<String>> = None;

    for (key, value) in parse_etapa_key_values(body) {
        match normalize_label(&key).as_str() {
            "skill" => step.skill = value.trim().to_string(),
            "input" => step.input = Some(value),
            "inputs" => {
                // Multiline plural form: each indented line becomes a
                // labelled entry. The collector below resolves them once
                // we've seen all lines.
                input_block_lines = Some(value.lines().map(|l| l.to_string()).collect());
            }
            "output" | "outputs" => step.output = Some(value.trim().to_string()),
            "condicao" | "condition" => step.condition = Some(value.trim().to_string()),
            "objetivo" => step.objective = Some(value),
            _ => {}
        }
    }

    if let Some(lines) = input_block_lines {
        for line in lines {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some((k, v)) = trimmed.split_once(':') {
                let key = k.trim().to_string();
                let val = unquote(v.trim()).to_string();
                if !key.is_empty() {
                    step.inputs.insert(key, val);
                }
            }
        }
    }

    if step.skill.is_empty() {
        return Err(format!("`{id}` sem `Skill` (campo obrigatório)"));
    }

    Ok(step)
}

/// Same multiline `|` / `>` semantics as skill_parser, but with permissive
/// keys so multi-word labels (`Se falhar`, `Inputs`) are accepted.
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
        let raw_value = &raw_value[1..]; // strip the ':'
        let key = raw_key.trim();
        if key.is_empty() {
            i += 1;
            continue;
        }
        let value_part = raw_value.trim();

        // Plural Inputs/Outputs use empty value followed by indented lines.
        // Same shape as YAML pipe blocks; we treat them generically.
        let is_block = value_part.is_empty()
            && (normalize_label(key) == "inputs" || normalize_label(key) == "outputs");

        if value_part == "|" || value_part == ">" || is_block {
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

// ── shared helpers ──────────────────────────────────────────────────────────

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

// ── tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"---
name: limpar-e-publicar
description: Limpa o repo e publica nova versão
version: "1.0"
author: Bethel
triggers:
  - publicar
  - release
---

# Pré-requisitos
- skill criar-sistema instalada
- branch main limpa

## Etapa 1
Skill: criar-sistema
Input: {{repo_path}}
Output: estrutura
Condição: sempre

## Etapa 2
Skill: debug-sistema
Input: {{etapa_1.estrutura}}
Output: relatorio
Condição: sucesso
"#;

    #[test]
    fn parses_happy_path() {
        let wf = parse_workflow(SAMPLE).expect("parse");

        assert_eq!(wf.meta.name, "limpar-e-publicar");
        assert_eq!(wf.meta.version, "1.0");
        assert_eq!(wf.meta.triggers, vec!["publicar", "release"]);

        assert_eq!(
            wf.prerequisites,
            vec!["skill criar-sistema instalada", "branch main limpa"],
        );

        assert_eq!(wf.steps.len(), 2);

        let s1 = &wf.steps[0];
        assert_eq!(s1.id, "step_1");
        assert_eq!(s1.skill, "criar-sistema");
        assert_eq!(s1.input.as_deref(), Some("{{repo_path}}"));
        assert_eq!(s1.output.as_deref(), Some("estrutura"));
        assert_eq!(s1.condition.as_deref(), Some("sempre"));

        let s2 = &wf.steps[1];
        assert_eq!(s2.id, "step_2");
        assert_eq!(s2.skill, "debug-sistema");
        assert_eq!(s2.input.as_deref(), Some("{{etapa_1.estrutura}}"));
        assert_eq!(s2.condition.as_deref(), Some("sucesso"));
    }

    #[test]
    fn rejects_missing_frontmatter() {
        let err = parse_workflow("## Etapa 1\nSkill: x\n").expect_err("no fm");
        assert!(err.to_lowercase().contains("frontmatter"), "got: {err}");
    }

    #[test]
    fn rejects_missing_name() {
        let content = "---\ndescription: anon\n---\n## Etapa 1\nSkill: x\n";
        let err = parse_workflow(content).expect_err("missing name");
        assert!(err.to_lowercase().contains("name"), "got: {err}");
    }

    #[test]
    fn rejects_step_without_skill() {
        let content = r#"---
name: x
---

## Etapa 1
Input: foo
Condição: sempre
"#;
        let err = parse_workflow(content).expect_err("missing skill");
        assert!(err.to_lowercase().contains("skill"), "got: {err}");
    }

    #[test]
    fn rejects_workflow_without_etapas() {
        let content = "---\nname: x\n---\n\n# Pré-requisitos\n- nada\n";
        let err = parse_workflow(content).expect_err("no etapas");
        assert!(err.to_lowercase().contains("etapa"), "got: {err}");
    }

    #[test]
    fn inline_triggers_list_works() {
        let content = r#"---
name: w
triggers: [a, "b c", d]
---
## Etapa 1
Skill: foo
"#;
        let wf = parse_workflow(content).expect("parses");
        assert_eq!(wf.meta.triggers, vec!["a", "b c", "d"]);
    }

    #[test]
    fn multiline_inputs_block_collects_named_pairs() {
        let content = r#"---
name: w
---
## Etapa 1
Skill: foo
Inputs:
  briefing: {{briefing_path}}
  repo: {{repo_path}}
Output: result
"#;
        let wf = parse_workflow(content).expect("parses");
        let s = &wf.steps[0];
        assert_eq!(s.skill, "foo");
        assert_eq!(s.inputs.get("briefing"), Some(&"{{briefing_path}}".to_string()));
        assert_eq!(s.inputs.get("repo"), Some(&"{{repo_path}}".to_string()));
        assert_eq!(s.output.as_deref(), Some("result"));
        // singular `input` stays None when only the block form was used
        assert!(s.input.is_none());
    }

    #[test]
    fn unknown_label_in_etapa_is_ignored() {
        let content = r#"---
name: w
---
## Etapa 1
Skill: foo
Tag: ignorada
Output: ok
"#;
        let wf = parse_workflow(content).expect("parses");
        assert_eq!(wf.steps[0].skill, "foo");
        assert_eq!(wf.steps[0].output.as_deref(), Some("ok"));
    }

    #[test]
    fn condition_label_accepts_ascii_fallback() {
        // Condicao (no acento) should still bind to step.condition.
        let content = r#"---
name: w
---
## Etapa 1
Skill: foo
Condicao: falha
"#;
        let wf = parse_workflow(content).expect("parses");
        assert_eq!(wf.steps[0].condition.as_deref(), Some("falha"));
    }

    #[test]
    fn objective_label_populated_when_present() {
        let content = r#"---
name: w
---
## Etapa 1
Objetivo: rodar pipeline X
Skill: foo
"#;
        let wf = parse_workflow(content).expect("parses");
        assert_eq!(wf.steps[0].objective.as_deref(), Some("rodar pipeline X"));
    }
}
