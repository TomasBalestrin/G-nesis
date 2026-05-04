//! Tauri IPC handlers for skill management.
//!
//! Skills v2 live under `~/.genesis/skills/<name>/` (pasta com SKILL.md
//! + assets/ + references/). Coexiste com legacy `<name>.md` solto até
//! a migration do bloco F. `list_skills` retorna metadata via parsed
//! frontmatter (a UI legacy depende disso); skills v2 também populam o
//! mirror SQLite (tabela `skills` da migration 009) pra list/sort
//! rápido sem parsear N arquivos.
//!
//! Path handling defensivo: `name` arg não pode conter separators ou
//! `..` — tanto o helper local skill_path quanto o crate::skills::
//! storage::skill_dir validam.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::config;
use crate::db::models::SkillRow;
use crate::db::queries;
use crate::orchestrator::skill_loader_v2;
use crate::orchestrator::skill_parser::{self, ParsedSkill, SkillMeta};
use crate::skills::storage as skill_storage;
use crate::skills::SkillPackage;

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

    // Best-effort cleanup do mirror SQLite (migration 009). Falha
    // aqui não derruba o delete porque o FS já saiu — log e segue.
    if let Err(err) = queries::delete_skill_row(&pool, &name).await {
        eprintln!("[skills] cleanup mirror SQLite `{name}` falhou: {err}");
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

/// Bundle retornado por `get_skill` — tudo que a UI precisa pra
/// renderizar uma skill v2 num só round-trip: o package metadata,
/// o conteúdo do SKILL.md e a lista de filenames de cada subpasta.
/// Filenames são relativos (ex: "module1.md", "template.html") —
/// caller passa o filename pra `get_skill_file(name, path)` pra
/// puxar o conteúdo individualmente.
#[derive(Debug, Clone, Serialize)]
pub struct SkillBundle {
    pub package: SkillPackage,
    pub skill_md: String,
    pub references: Vec<String>,
    pub assets: Vec<String>,
}

/// Lista todos os skill packages v2 do FS via `list_skill_packages`.
/// Retorna o `SkillPackage` cru (metadata sem parsear frontmatter)
/// — UI usa pra grade/lista. NÃO consulta o mirror SQLite porque
/// FS é a source-of-truth e os packages podem ter mudado fora do app.
#[tauri::command]
pub async fn list_skill_packages() -> Result<Vec<SkillPackage>, String> {
    skill_storage::list_skill_packages()
}

/// Bundle de uma skill: package + SKILL.md content + filenames de
/// references/assets em uma chamada. UI evita 3 IPCs separados pra
/// abrir uma skill.
#[tauri::command]
pub async fn get_skill(name: String) -> Result<SkillBundle, String> {
    let package = skill_storage::get_skill_package(&name)?
        .ok_or_else(|| format!("skill `{name}` não encontrada"))?;
    let skill_md = skill_storage::read_skill_md(&name)?;
    let references = skill_storage::list_references(&name)?
        .into_iter()
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from))
        .collect();
    let assets = skill_storage::list_assets(&name)?
        .into_iter()
        .filter_map(|p| p.file_name().and_then(|n| n.to_str()).map(String::from))
        .collect();
    Ok(SkillBundle {
        package,
        skill_md,
        references,
        assets,
    })
}

/// Lê qualquer arquivo dentro do package (`name`/`<rel_path>`).
/// `rel_path` é relativo à raiz do package (ex: "references/mod1.md"
/// ou "assets/template.html"). Validado contra path traversal:
/// rejeita absoluto, `..`, separadores de plataforma estranhos.
#[tauri::command]
pub async fn get_skill_file(name: String, path: String) -> Result<String, String> {
    let resolved = resolve_skill_file(&name, &path)?;
    fs::read_to_string(&resolved)
        .map_err(|e| format!("falha ao ler {}: {e}", resolved.display()))
}

/// Cria um package v2 do zero: pasta + SKILL.md template + assets/
/// + references/. Erra se a skill já existe (qualquer formato — v1
/// .md solto ou v2 pasta). Sincroniza com o mirror SQLite (tabela
/// `skills` da migration 009).
///
/// Template é mínimo — frontmatter `name`/`version`/`description` e
/// um header H1. Caller (autoria via `/criar-skill` ou Settings) é
/// quem preenche os steps depois.
#[tauri::command]
pub async fn create_skill(
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<SkillPackage, String> {
    let dir = skills_dir()?;

    // Reject if v1 OR v2 já existem — não silenciar conflito.
    let v1_path = skill_path(&dir, &name)?;
    let v2_dir = skill_storage::skill_dir(&name)?;
    if v1_path.exists() {
        return Err(format!(
            "skill `{name}` já existe como `{name}.md` (v1 legacy). Migre primeiro."
        ));
    }
    if v2_dir.join("SKILL.md").is_file() {
        return Err(format!("skill `{name}` já existe"));
    }

    skill_storage::ensure_skill_dirs(&name)?;
    let skill_md_path = v2_dir.join("SKILL.md");
    let template = render_skill_template(&name);
    fs::write(&skill_md_path, &template)
        .map_err(|e| format!("falha ao escrever {}: {e}", skill_md_path.display()))?;

    // Mirror SQLite (best-effort — falha aqui não derruba o create
    // porque o FS é source-of-truth).
    let row = SkillRow {
        id: Uuid::new_v4().to_string(),
        name: name.clone(),
        version: "1.0".to_string(),
        author: None,
        has_assets: 0,
        has_references: 0,
        files_count: 1,
        created_at: String::new(),
        updated_at: String::new(),
    };
    if let Err(err) = queries::insert_skill(&pool, &row).await {
        eprintln!("[skills] insert mirror SQLite `{name}` falhou: {err}");
    }

    skill_storage::get_skill_package(&name)?
        .ok_or_else(|| "skill criada mas package não encontrado".into())
}

/// Descompacta um arquivo `.skill` (ZIP) em `~/.genesis/skills/<name>/`
/// + registra no mirror SQLite. `file_path` é absoluto na máquina do
/// usuário (frontend resolve via tauri-plugin-dialog antes de invocar).
///
/// Erros vêm com mensagens user-actionable do `import_skill_package`:
/// arquivo muito grande, ZIP malformado, multi-root, sem SKILL.md,
/// zip-slip detectado, ou nome conflitante. UI mostra direto no toast.
#[tauri::command]
pub async fn import_skill(
    file_path: String,
    pool: State<'_, SqlitePool>,
) -> Result<SkillPackage, String> {
    crate::skills::import::import_skill_package(&file_path, &pool).await
}

/// Salva um arquivo dentro do package. Cria parent dirs se faltar
/// (ex: salvar `references/novo.md` quando `references/` ainda não
/// existe). Path validado contra traversal igual `get_skill_file`.
///
/// Quando o arquivo é o próprio `SKILL.md`, parseia o frontmatter
/// pra rejeitar conteúdo inválido e re-stata o package pra atualizar
/// o mirror SQLite (has_assets/has_references/files_count podem ter
/// mudado se o save foi pra subpasta).
#[tauri::command]
pub async fn save_skill_file(
    name: String,
    path: String,
    content: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    let resolved = resolve_skill_file(&name, &path)?;

    // Se for o SKILL.md, valida o conteúdo via parser antes de
    // sobrescrever — mesma garantia que save_skill (legacy).
    if path == "SKILL.md" || resolved.ends_with("SKILL.md") {
        skill_parser::parse_skill(&content).map_err(|e| format!("skill inválida: {e}"))?;
    }

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("falha ao criar {}: {e}", parent.display()))?;
    }
    fs::write(&resolved, content)
        .map_err(|e| format!("falha ao salvar {}: {e}", resolved.display()))?;

    // Re-stat e update do mirror SQLite (best-effort — file system
    // permanece source-of-truth se a UPDATE falhar).
    if let Some(package) = skill_storage::get_skill_package(&name)? {
        let existing = queries::get_skill_by_name(&pool, &name).await.ok().flatten();
        let row = SkillRow {
            id: existing.as_ref().map(|r| r.id.clone()).unwrap_or_else(|| Uuid::new_v4().to_string()),
            name: package.name.clone(),
            version: existing.as_ref().map(|r| r.version.clone()).unwrap_or_else(|| "1.0".to_string()),
            author: existing.and_then(|r| r.author),
            has_assets: if package.has_assets { 1 } else { 0 },
            has_references: if package.has_references { 1 } else { 0 },
            files_count: package.files_count as i64,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let result = queries::update_skill(&pool, &row).await;
        if result.is_err() {
            // UPDATE não tocou nenhuma row (não tinha mirror) → INSERT.
            if let Err(err) = queries::insert_skill(&pool, &row).await {
                eprintln!("[skills] sync SQLite mirror `{name}` falhou: {err}");
            }
        }
    }

    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Resolve `<skill_dir>/<name>/<rel_path>` validando que `rel_path`
/// não tenta escapar do package. Reject `..`, paths absolutos,
/// componentes vazios. Skills v2 só armazenam SKILL.md (raiz) +
/// `assets/<file>` + `references/<file>` então a estrutura é simples.
fn resolve_skill_file(name: &str, rel_path: &str) -> Result<PathBuf, String> {
    let trimmed = rel_path.trim();
    if trimmed.is_empty() {
        return Err("path vazio".into());
    }
    if trimmed.starts_with('/') || trimmed.starts_with('\\') {
        return Err(format!("path absoluto não permitido: `{trimmed}`"));
    }
    // Walk components — rejeita `..` em qualquer posição mesmo que
    // o caminho composto fosse seguro (defensivo, não vale a pena
    // reasoning sobre normalização).
    for component in trimmed.split(|c: char| c == '/' || c == '\\') {
        if component == ".." || component == "" {
            return Err(format!("path inválido: `{trimmed}`"));
        }
    }
    let dir = skill_storage::skill_dir(name)?;
    Ok(dir.join(trimmed))
}

/// Template inicial pro SKILL.md de uma skill nova. Frontmatter
/// mínimo viável + body placeholder com o título da skill. Caller
/// (UI ou agente de autoria) edita pra adicionar steps reais.
fn render_skill_template(name: &str) -> String {
    format!(
        "---\nname: {name}\nversion: 1.0\ndescription: TODO\n---\n\n# {name}\n\nTODO: descreva o que essa skill faz, quais inputs ela aceita e quais outputs entrega.\n"
    )
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
    fn resolve_skill_file_rejects_traversal() {
        // O nome `legendar` precisa passar pelo skill_dir() que
        // chama config::load_config() — aqui testamos só os checks
        // de path. Os erros do skill_dir cobrem traversal no `name`.
        let bad = vec![
            "../escape.md",
            "/abs/path",
            "\\windows\\style",
            "references/../escape",
            "",
        ];
        for path in bad {
            assert!(
                resolve_skill_file("legendar", path).is_err(),
                "esperado Err pra path={path:?}"
            );
        }
    }

    #[test]
    fn render_template_has_frontmatter() {
        let t = render_skill_template("test-skill");
        assert!(t.starts_with("---\n"), "frontmatter ausente: {t}");
        assert!(t.contains("name: test-skill"));
        assert!(t.contains("version: 1.0"));
        assert!(t.contains("# test-skill"));
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
