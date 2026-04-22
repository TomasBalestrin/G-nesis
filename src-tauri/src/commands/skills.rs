//! Tauri IPC handlers for skill management.

use crate::orchestrator::skill_parser::ParsedSkill;

#[tauri::command]
pub async fn list_skills() -> Result<Vec<String>, String> {
    // TODO: ler skills_dir (config) e retornar nomes dos .md
    Ok(Vec::new())
}

#[tauri::command]
pub async fn read_skill(_name: String) -> Result<String, String> {
    // TODO: ler conteúdo bruto do skill .md
    Ok(String::new())
}

#[tauri::command]
pub async fn save_skill(_name: String, _content: String) -> Result<(), String> {
    // TODO: gravar skill .md no skills_dir
    Ok(())
}

#[tauri::command]
pub async fn parse_skill(_name: String) -> Result<ParsedSkill, String> {
    // TODO: ler skill e delegar para orchestrator::skill_parser::parse_skill
    Ok(ParsedSkill::default())
}
