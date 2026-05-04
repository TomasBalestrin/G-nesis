//! Storage primitives pra skill packages (formato v2: pasta com SKILL.md
//! + assets/ + references/).
//!
//! Layout em disco:
//! ```text
//! ~/.genesis/skills/
//! └── <name>/
//!     ├── SKILL.md          ← arquivo principal (obrigatório)
//!     ├── assets/           ← templates / HTMLs / recursos (opcional)
//!     └── references/       ← módulos / sub-skills .md (opcional)
//! ```
//!
//! Skills v1 (`<name>.md` solto na raiz) são IGNORADAS por
//! `list_skill_packages` — a migration do bloco F vai converter
//! cada uma em pasta. Coexiste com `orchestrator::skill_loader_v2`
//! que faz parsing pra execução; este módulo só cuida de CRUD de
//! storage (não parseia frontmatter, não valida steps).

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config;

/// Snapshot do que está em disco pra uma skill v2. `path` é o
/// diretório raiz do package; `has_assets`/`has_references` indicam
/// se as subpastas existem (opcionais por design); `files_count` é o
/// total recursivo de arquivos não-hidden dentro do package.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillPackage {
    pub name: String,
    pub path: PathBuf,
    pub has_assets: bool,
    pub has_references: bool,
    pub files_count: usize,
    /// Arquivos não-hidden direto em `references/` (não recursivo).
    /// 0 quando a subpasta não existe — útil pra badge na sidebar
    /// sem precisar buscar `references: Vec<String>` via getSkill.
    pub references_count: usize,
    /// Idem pra `assets/`.
    pub assets_count: usize,
}

/// Diretório raiz de skills lido do config (default
/// `~/.genesis/skills/`). Honra override via `GENESIS_SKILLS_DIR`
/// porque `config::load_config` aplica os env overrides.
pub fn skills_dir() -> Result<PathBuf, String> {
    let cfg = config::load_config()?;
    Ok(PathBuf::from(cfg.skills_dir))
}

/// `skills_dir/<name>/`. Valida que `name` não tenta escapar do
/// `skills_dir` via `..`, separadores ou string vazia.
pub fn skill_dir(name: &str) -> Result<PathBuf, String> {
    validate_name(name)?;
    Ok(skills_dir()?.join(name))
}

/// Idempotente: cria o package dir + `assets/` + `references/`.
/// `mkdir -p` semantics — re-call não falha. NÃO escreve SKILL.md
/// (caller é responsável). Erro só quando o caminho não pode ser
/// criado (permissão, disco cheio, etc).
pub fn ensure_skill_dirs(name: &str) -> Result<(), String> {
    let dir = skill_dir(name)?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    fs::create_dir_all(dir.join("assets"))
        .map_err(|e| format!("cannot create {}/assets: {e}", dir.display()))?;
    fs::create_dir_all(dir.join("references"))
        .map_err(|e| format!("cannot create {}/references: {e}", dir.display()))?;
    Ok(())
}

/// Enumera packages v2 — só pastas com `SKILL.md` válido dentro.
/// Ignora `.md` soltos (formato v1 legacy), arquivos ocultos e
/// subpastas tipo `meta/`, `drafts/` que não têm SKILL.md (livre
/// pra organização visual). Sorted por name pra UI determinística.
pub fn list_skill_packages() -> Result<Vec<SkillPackage>, String> {
    let root = skills_dir()?;
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<SkillPackage> = Vec::new();
    for entry in fs::read_dir(&root)
        .map_err(|e| format!("cannot read {}: {e}", root.display()))?
    {
        let entry = match entry {
            Ok(e) => e,
            Err(err) => {
                eprintln!("[skills::storage] pulando entrada: {err}");
                continue;
            }
        };
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        if !path.join("SKILL.md").is_file() {
            continue;
        }
        out.push(read_package(&path, name));
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Lê o `SKILL.md` do package. Erro quando o arquivo não existe
/// (validação up-front em vez de propagar fs::read_to_string err
/// genérico — UI consegue distinguir "nunca existiu" de
/// "permissão negada").
pub fn read_skill_md(name: &str) -> Result<String, String> {
    let path = skill_dir(name)?.join("SKILL.md");
    if !path.exists() {
        return Err(format!("SKILL.md não encontrado em {}", path.display()));
    }
    fs::read_to_string(&path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))
}

/// Arquivos `.md` em `<package>/references/`, ordenados por nome.
/// Ignora dotfiles e sub-diretórios. Vazio quando a pasta não
/// existe — references/ é opcional por design.
pub fn list_references(name: &str) -> Result<Vec<PathBuf>, String> {
    list_subdir(name, "references", Some("md"))
}

/// Todos os arquivos em `<package>/assets/` (qualquer extensão),
/// ordenados por nome. Ignora dotfiles. Vazio quando a pasta não
/// existe — assets/ é opcional por design.
pub fn list_assets(name: &str) -> Result<Vec<PathBuf>, String> {
    list_subdir(name, "assets", None)
}

/// Snapshot do package especificado por `name`. `None` quando o
/// diretório não existe OU quando existe mas não tem SKILL.md
/// dentro (subpasta livre tipo `meta/`, `drafts/`).
pub fn get_skill_package(name: &str) -> Result<Option<SkillPackage>, String> {
    let dir = skill_dir(name)?;
    if !dir.is_dir() || !dir.join("SKILL.md").is_file() {
        return Ok(None);
    }
    Ok(Some(read_package(&dir, name.to_string())))
}

/// Apaga o package inteiro (recursivo). Idempotente: pasta ausente
/// é Ok. Não toca em irmãos — `delete_skill_package("foo")` NÃO
/// remove `~/.genesis/skills/foo.md` legacy (uma migration future
/// pode unificar; por ora coexiste).
pub fn delete_skill_package(name: &str) -> Result<(), String> {
    let dir = skill_dir(name)?;
    if !dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(&dir)
        .map_err(|e| format!("cannot delete {}: {e}", dir.display()))
}

// ── internals ───────────────────────────────────────────────────────────────

/// `name` rules: não-vazio, sem path separators (`/`, `\`), sem
/// `..` (path traversal). Defensive duplicate de `commands/skills.rs::
/// skill_path` mas independente — este módulo não importa de
/// commands/.
fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("nome de skill vazio".into());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("nome de skill inválido: `{name}`"));
    }
    Ok(())
}

/// Lê metadata de um package já validado (path existe + tem
/// SKILL.md). Não faz validação extra; chamado só de dentro do
/// list_skill_packages que já filtrou.
fn read_package(path: &Path, name: String) -> SkillPackage {
    let assets = path.join("assets");
    let references = path.join("references");
    let references_count = count_files_flat(&references);
    let assets_count = count_files_flat(&assets);
    SkillPackage {
        files_count: count_files_recursive(path),
        has_assets: assets.is_dir(),
        has_references: references.is_dir(),
        references_count,
        assets_count,
        name,
        path: path.to_path_buf(),
    }
}

/// Conta arquivos não-hidden direto em `dir` (1 nível, não recursivo).
/// Diretório ausente → 0. Pensado pros badges de subpastas que mostram
/// quantos arquivos o package tem em `references/` ou `assets/`.
fn count_files_flat(dir: &Path) -> usize {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return 0,
    };
    let mut total = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let hidden = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with('.'))
            .unwrap_or(true);
        if !hidden {
            total += 1;
        }
    }
    total
}

/// Conta arquivos não-hidden em `dir` recursivamente. Hidden =
/// começa com '.'. Subdiretórios são descidos sem limite (skills
/// são pequenas em prática). Erros de leitura silenciados via log
/// — não falhar o list_skill_packages inteiro só porque um arquivo
/// ficou inacessível.
fn count_files_recursive(dir: &Path) -> usize {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(err) => {
            eprintln!(
                "[skills::storage] count_files_recursive: cannot read {}: {err}",
                dir.display()
            );
            return 0;
        }
    };
    let mut total = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n,
            _ => continue,
        };
        let _ = name; // silence unused-binding when only checking dotfile
        if path.is_dir() {
            total += count_files_recursive(&path);
        } else if path.is_file() {
            total += 1;
        }
    }
    total
}

/// List arquivos em `<package>/<sub>/`, opcionalmente filtrando por
/// extensão. Resultado ordenado por nome pra UI estável. Vazio
/// quando a sub não existe — caller costuma exibir empty state.
fn list_subdir(
    name: &str,
    sub: &str,
    extension: Option<&str>,
) -> Result<Vec<PathBuf>, String> {
    let dir = skill_dir(name)?.join(sub);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(&dir)
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        if let Some(ext) = extension {
            let matches = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case(ext))
                .unwrap_or(false);
            if !matches {
                continue;
            }
        }
        let _ = file_name;
        out.push(path);
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_name_accepts_simple() {
        assert!(validate_name("legendar").is_ok());
        assert!(validate_name("video-editor").is_ok());
        assert!(validate_name("skill_v2").is_ok());
    }

    #[test]
    fn validate_name_rejects_traversal() {
        assert!(validate_name("").is_err());
        assert!(validate_name("../etc").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name("a\\b").is_err());
        assert!(validate_name("..").is_err());
    }
}
