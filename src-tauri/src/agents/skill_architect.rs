//! Skill Architect — agente que conduz a criação de uma skill v2 via
//! conversa estruturada (entender → desenhar → auxiliares → validar).
//! System prompt é embeddeado em build-time via `include_str!` pra
//! não depender de FS no runtime e pra que o binário fique
//! self-contained.

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
}
