//! Storage primitives pra skill packages (formato v2: pasta com SKILL.md
//! + opcionalmente assets/ + references/ + scripts/).
//!
//! Layout em disco:
//! ```text
//! ~/.genesis/skills/
//! └── <name>/
//!     ├── SKILL.md          ← arquivo principal (obrigatório)
//!     ├── references/       ← módulos / sub-skills .md (opcional)
//!     ├── assets/           ← templates / HTMLs / recursos (opcional)
//!     └── scripts/          ← shell scripts executáveis (opcional)
//! ```
//!
//! Regra "NUNCA criar subpastas vazias" (A1): a criação de uma skill
//! materializa apenas o `<name>/` + `SKILL.md`. As subpastas vêm sob
//! demanda via [`create_subfolder`] quando o primeiro arquivo for
//! gravado em cada uma — evita poluição visual com pastas vazias e
//! mantém o package mínimo no FS.
//!
//! Skills v1 (`<name>.md` solto na raiz) foram aposentadas em F2 —
//! migração roda no startup via `crate::skills::migration`. Coexiste
//! com `orchestrator::skill_loader_v2` que faz parsing pra execução.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::config;

/// Snapshot do que está em disco pra uma skill v2. `path` é o
/// diretório raiz do package; `has_*` indicam se cada subpasta
/// existe; `*_count` são arquivos não-hidden 1 nível dentro de cada
/// subpasta (não recursivo) — pensados pra badges de UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillPackage {
    pub name: String,
    pub path: PathBuf,
    pub has_references: bool,
    pub has_assets: bool,
    pub has_scripts: bool,
    pub files_count: usize,
    /// Arquivos não-hidden direto em `references/` (não recursivo).
    /// 0 quando a subpasta não existe — útil pra badge na sidebar
    /// sem precisar buscar `references: Vec<String>` via getSkill.
    pub references_count: usize,
    /// Idem pra `assets/`.
    pub assets_count: usize,
    /// Idem pra `scripts/`.
    pub scripts_count: usize,
    /// Mirror SQLite (migration 009). Storage layer sempre retorna
    /// `None`/`""`; command layer (`commands/skills.rs`) faz o join
    /// via `queries::get_skill_by_name` antes de serializar.
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
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

/// Idempotente: cria APENAS o `<name>/` raiz. Subpastas
/// (`references/`, `assets/`, `scripts/`) NÃO são criadas — caller
/// deve invocar [`create_subfolder`] sob demanda quando gravar o
/// primeiro arquivo em cada uma. Regra "NUNCA criar subpastas vazias".
pub fn ensure_skill_dir(name: &str) -> Result<(), String> {
    let dir = skill_dir(name)?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("cannot create {}: {e}", dir.display()))
}

/// Alias mantido pra compatibilidade com callers em `commands/` que
/// não foram atualizados. Comportamento idêntico ao
/// [`ensure_skill_dir`] — só cria a raiz; subpastas continuam
/// lazy-created via [`create_subfolder`].
pub fn ensure_skill_dirs(name: &str) -> Result<(), String> {
    ensure_skill_dir(name)
}

/// Cria uma subpasta válida (`references` | `assets` | `scripts`)
/// sob demanda. Idempotente. Outros valores de `folder` retornam
/// `Err` pra evitar criação de pastas arbitrárias dentro do package.
///
/// Caller típico: antes de gravar `references/foo.md`, chama
/// `create_subfolder(name, "references")` pra garantir que a pasta
/// existe. `save_skill_file` já cria parents via `fs::create_dir_all`,
/// então essa função é redundante nesse caminho — usada quando o
/// caller quer criar a subpasta vazia explicitamente (ex: dropzone
/// que aceita pasta vazia + arquivo logo em seguida).
pub fn create_subfolder(name: &str, folder: &str) -> Result<PathBuf, String> {
    if !matches!(folder, "references" | "assets" | "scripts") {
        return Err(format!(
            "subpasta inválida: `{folder}` (esperado references/assets/scripts)"
        ));
    }
    let path = skill_dir(name)?.join(folder);
    fs::create_dir_all(&path)
        .map_err(|e| format!("cannot create {}: {e}", path.display()))?;
    Ok(path)
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

/// Todos os arquivos em `<package>/scripts/` (qualquer extensão),
/// ordenados por nome. Ignora dotfiles. Vazio quando a pasta não
/// existe — scripts/ é opcional por design.
pub fn list_scripts(name: &str) -> Result<Vec<PathBuf>, String> {
    list_subdir(name, "scripts", None)
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
/// `..` (path traversal). Boundary único pra skills v2 — qualquer
/// command que toca arquivos da skill passa por aqui.
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
    let references = path.join("references");
    let assets = path.join("assets");
    let scripts = path.join("scripts");
    SkillPackage {
        files_count: count_files_recursive(path),
        has_references: references.is_dir(),
        has_assets: assets.is_dir(),
        has_scripts: scripts.is_dir(),
        references_count: count_files_flat(&references),
        assets_count: count_files_flat(&assets),
        scripts_count: count_files_flat(&scripts),
        name,
        path: path.to_path_buf(),
        id: None,
        created_at: None,
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

    #[test]
    fn create_subfolder_rejects_unknown_names() {
        // Funções acima precisam de skill_dir() que carrega config —
        // testamos só o ramo de validação do `folder`, que não toca
        // disco se rejeitar antes.
        let err = create_subfolder("legendar", "etc").unwrap_err();
        assert!(err.contains("subpasta inválida"));
        let err = create_subfolder("legendar", "../escape").unwrap_err();
        assert!(err.contains("subpasta inválida"));
    }
}
