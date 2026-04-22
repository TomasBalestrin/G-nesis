//! Parser for skill .md files. Reads frontmatter + sections into a ParsedSkill.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ParsedSkill {
    pub meta: SkillMeta,
    pub tools: Vec<String>,
    pub inputs: Vec<String>,
    pub steps: Vec<SkillStep>,
    pub outputs: Vec<String>,
}

pub fn parse_skill(_markdown: &str) -> Result<ParsedSkill, String> {
    // TODO: pulldown-cmark parse + frontmatter extraction
    Ok(ParsedSkill::default())
}
