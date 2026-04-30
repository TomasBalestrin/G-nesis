//! Tauri IPC handlers for skill management.
//!
//! Skills live under `config.skills_dir` as `.md` files. `list_skills` returns
//! the meta (name, description, version, author) of every skill that parses
//! cleanly; broken ones are skipped with a stderr warning so one bad file does
//! not hide the rest.
//!
//! Path handling is defensive (docs/security.md §4): the `name` arg cannot
//! contain path separators or `..` — every file access is scoped to the
//! configured directory.

use std::fs;
use std::path::{Path, PathBuf};

use sqlx::SqlitePool;
use tauri::State;

use crate::config;
use crate::db::queries;
use crate::orchestrator::skill_loader_v2;
use crate::orchestrator::skill_parser::{self, ParsedSkill, SkillMeta};

fn skills_dir() -> Result<PathBuf, String> {
    let cfg = config::load_config()?;
    Ok(PathBuf::from(cfg.skills_dir))
}

fn skill_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() {
        return Err("nome da skill vazio".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("nome de skill inválido: `{name}`"));
    }
    let file_name = if name.ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    };
    Ok(dir.join(file_name))
}

#[tauri::command]
pub async fn list_skills() -> Result<Vec<SkillMeta>, String> {
    let dir = skills_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    // skill_loader_v2 detecta v1 (.md solto) + v2 (pasta com SKILL.md)
    // num só pass, com pasta vencendo arquivo solto quando ambos
    // existem. Cada entrada vira um parse independente — broken
    // skills logam stderr e somem da lista, igual o comportamento
    // anterior.
    let mut metas: Vec<SkillMeta> = Vec::new();
    for entry in skill_loader_v2::list_skill_entries(&dir) {
        let path = entry.source.entry_path();
        match fs::read_to_string(path) {
            Ok(content) => match skill_parser::parse_skill(&content) {
                Ok(skill) => metas.push(skill.meta),
                Err(err) => eprintln!("[skills] pulando {} ao listar: {err}", path.display()),
            },
            Err(err) => eprintln!("[skills] falha ao ler {}: {err}", path.display()),
        }
    }

    metas.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(metas)
}

#[tauri::command]
pub async fn read_skill(name: String) -> Result<String, String> {
    let dir = skills_dir()?;
    let path = skill_path(&dir, &name)?;
    fs::read_to_string(&path).map_err(|e| format!("falha ao ler skill `{name}`: {e}"))
}

#[tauri::command]
pub async fn save_skill(name: String, content: String) -> Result<(), String> {
    let dir = skills_dir()?;
    let path = skill_path(&dir, &name)?;

    // Reject invalid skills at the boundary (PRD §F3): parser fails fast if
    // frontmatter or any step is malformed.
    skill_parser::parse_skill(&content).map_err(|e| format!("skill inválida: {e}"))?;

    fs::create_dir_all(&dir).map_err(|e| format!("falha ao criar {}: {e}", dir.display()))?;
    fs::write(&path, content).map_err(|e| format!("falha ao salvar skill `{name}`: {e}"))
}

/// Delete the on-disk artifact backing a skill — `.md` para v1, pasta
/// `<name>/` inteira (incluindo `scripts/`, `references/`, `assets/`)
/// para v2. Skills não têm linha em SQLite (executions referenciam
/// `skill_name` por string, sem FK), então o cleanup é puramente FS.
///
/// Best-effort: se v1 e v2 coexistirem (dual layout, raro), tenta os
/// dois e loga falhas individuais sem bloquear o outro. Erro só
/// quando NENHUM dos dois layouts foi tocado com sucesso (nada
/// existia OU ambas remoções falharam).
///
/// Bloqueio mantido: execuções em andamento da skill abortam o
/// delete — o executor ainda pode precisar do arquivo.
#[tauri::command]
pub async fn delete_skill(name: String, pool: State<'_, SqlitePool>) -> Result<(), String> {
    let dir = skills_dir()?;
    let v1_path = skill_path(&dir, &name)?;
    let v2_folder = dir.join(&name);

    let active = queries::count_active_by_skill_name(&pool, &name).await?;
    if active > 0 {
        return Err(format!(
            "skill `{name}` está sendo executada agora ({active} execução(ões) ativas). \
             Aborte ou aguarde antes de deletar."
        ));
    }

    let mut existed = false;
    let mut removed_any = false;
    let mut errors: Vec<String> = Vec::new();

    if v1_path.exists() {
        existed = true;
        match fs::remove_file(&v1_path) {
            Ok(()) => removed_any = true,
            Err(e) => {
                let msg = format!("v1 file {}: {e}", v1_path.display());
                eprintln!("[skills] delete `{name}` falhou em {msg}");
                errors.push(msg);
            }
        }
    }
    if v2_folder.is_dir() && v2_folder.join("SKILL.md").is_file() {
        existed = true;
        match fs::remove_dir_all(&v2_folder) {
            Ok(()) => removed_any = true,
            Err(e) => {
                let msg = format!("v2 folder {}: {e}", v2_folder.display());
                eprintln!("[skills] delete `{name}` falhou em {msg}");
                errors.push(msg);
            }
        }
    }

    if !existed {
        return Err(format!("skill `{name}` não encontrada"));
    }
    if !removed_any {
        return Err(format!(
            "falha ao deletar skill `{name}` ({})",
            errors.join("; ")
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn parse_skill(name: String) -> Result<ParsedSkill, String> {
    let dir = skills_dir()?;
    let path = skill_path(&dir, &name)?;
    let content =
        fs::read_to_string(&path).map_err(|e| format!("falha ao ler skill `{name}`: {e}"))?;
    skill_parser::parse_skill(&content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal() {
        let dir = Path::new("/tmp/skills");
        assert!(skill_path(dir, "../etc/passwd").is_err());
        assert!(skill_path(dir, "foo/bar").is_err());
        assert!(skill_path(dir, "foo\\bar").is_err());
        assert!(skill_path(dir, "").is_err());
    }

    #[test]
    fn appends_md_extension_when_missing() {
        let dir = Path::new("/tmp/skills");
        assert_eq!(
            skill_path(dir, "criar-sistema").unwrap(),
            PathBuf::from("/tmp/skills/criar-sistema.md")
        );
        assert_eq!(
            skill_path(dir, "criar-sistema.md").unwrap(),
            PathBuf::from("/tmp/skills/criar-sistema.md")
        );
    }
}
