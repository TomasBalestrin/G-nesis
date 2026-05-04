//! Loader pra skills v2 (pasta com `SKILL.md`).
//!
//! Suporte v1 (`<nome>.md` solto) foi removido em F2 — toda skill é
//! migrada pro layout v2 no startup pelo `crate::skills::migration`.
//! Este módulo cuida só da camada de filesystem: descobrir pastas
//! com SKILL.md e expor os subdirs opcionais (references/scripts/
//! assets) numa struct tipada.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::orchestrator::skill_parser::{self, ParsedSkill};

/// Fonte da skill em disco. Sempre `Folder` no layout v2 — a variant
/// é mantida como enum por enquanto pra preservar compatibilidade com
/// `serde::tag` em consumers downstream caso precisem distinguir
/// futuramente outros formatos.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SkillSource {
    /// `<nome>/` com `SKILL.md` dentro. Os 3 subdirs são opcionais
    /// (Some quando existem, None caso contrário); o caller usa pra
    /// resolver caminhos relativos citados na prosa das etapas
    /// (ex: "scripts/extract.sh").
    Folder {
        path: PathBuf,
        skill_md: PathBuf,
        references: Option<PathBuf>,
        scripts: Option<PathBuf>,
        assets: Option<PathBuf>,
    },
}

impl SkillSource {
    /// Caminho do `SKILL.md` real — útil pra mensagens de erro / log.
    pub fn entry_path(&self) -> &Path {
        match self {
            Self::Folder { skill_md, .. } => skill_md,
        }
    }
}

/// Skill carregada — junta a fonte (onde mora em disco) com o
/// `ParsedSkill` resultante do parser. O executor consome `parsed`
/// pra rodar; a UI consome `source` pra abrir/editar/deletar.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillFolder {
    pub source: SkillSource,
    pub parsed: ParsedSkill,
}

/// Entrada leve do listing — só nome + fonte, sem parsing. Usado
/// quando a UI precisa enumerar skills mas só vai parsear quando
/// uma for selecionada (lista de centenas é caro pra parsear toda).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillEntry {
    pub name: String,
    pub source: SkillSource,
}

/// Inspeciona um path e decide se é um package v2 válido. Retorna
/// `None` quando não é uma pasta com `SKILL.md` dentro — silencia
/// sub-pastas como `meta/`, `drafts/`, etc. que existem só pra
/// organização visual do skills_dir.
pub fn detect_source(path: &Path) -> Option<SkillEntry> {
    if !path.is_dir() {
        return None;
    }
    let skill_md = path.join("SKILL.md");
    if !skill_md.is_file() {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().into_owned();
    Some(SkillEntry {
        name,
        source: SkillSource::Folder {
            path: path.to_path_buf(),
            skill_md,
            references: optional_subdir(path, "references"),
            scripts: optional_subdir(path, "scripts"),
            assets: optional_subdir(path, "assets"),
        },
    })
}

fn optional_subdir(parent: &Path, name: &str) -> Option<PathBuf> {
    let p = parent.join(name);
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

/// Walk one level do skills_dir e retorna uma SkillEntry por package
/// v2 (pasta com SKILL.md). Sorted por nome pra UI determinística.
pub fn list_skill_entries(skills_dir: &Path) -> Vec<SkillEntry> {
    if !skills_dir.is_dir() {
        return Vec::new();
    }
    let read = match fs::read_dir(skills_dir) {
        Ok(r) => r,
        Err(err) => {
            eprintln!(
                "[skill_loader_v2] read_dir {} falhou: {err}",
                skills_dir.display()
            );
            return Vec::new();
        }
    };

    let mut out: Vec<SkillEntry> = Vec::new();
    for entry in read.flatten() {
        if let Some(item) = detect_source(&entry.path()) {
            out.push(item);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Carrega uma skill v2 por `name`. Erro quando a pasta não existe,
/// `SKILL.md` ausente, ou o parser rejeita o conteúdo.
///
/// Path traversal é bloqueado no boundary — `name` não pode conter
/// `/`, `\` ou `..`.
pub fn load_skill_folder(skills_dir: &Path, name: &str) -> Result<SkillFolder, String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(format!("nome de skill inválido: `{name}`"));
    }

    let folder = skills_dir.join(name);
    if !folder.is_dir() {
        return Err(format!("skill `{name}` não encontrada"));
    }
    let skill_md = folder.join("SKILL.md");
    if !skill_md.is_file() {
        return Err(format!("SKILL.md ausente em {}", folder.display()));
    }
    let content = fs::read_to_string(&skill_md)
        .map_err(|e| format!("falha ao ler {}: {e}", skill_md.display()))?;
    let parsed = skill_parser::parse_skill(&content)?;
    Ok(SkillFolder {
        source: SkillSource::Folder {
            path: folder.clone(),
            skill_md: skill_md.clone(),
            references: optional_subdir(&folder, "references"),
            scripts: optional_subdir(&folder, "scripts"),
            assets: optional_subdir(&folder, "assets"),
        },
        parsed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal SKILL.md que o parser aceita. Reusado nos tests pra que
    /// reads passem sem ter que re-validar o parser.
    const SAMPLE: &str = "---\n\
name: demo\n\
description: teste\n\
version: \"1.0\"\n\
author: t\n\
---\n\
\n\
# Tools\n\
- bash\n\
\n\
# Steps\n\
\n\
## step_1\n\
tool: bash\n\
command: echo hi\n";

    fn unique_dir(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let pid = std::process::id();
        let nano = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        p.push(format!("genesis-skill-loader-{label}-{pid}-{nano}"));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn detect_source_recognizes_v2_folder() {
        let dir = unique_dir("detect-folder");
        let skill = dir.join("legendar-videos");
        fs::create_dir_all(skill.join("scripts")).unwrap();
        fs::create_dir_all(skill.join("references")).unwrap();
        fs::write(skill.join("SKILL.md"), SAMPLE).unwrap();

        let entry = detect_source(&skill).unwrap();
        assert_eq!(entry.name, "legendar-videos");
        match entry.source {
            SkillSource::Folder {
                references,
                scripts,
                assets,
                ..
            } => {
                assert!(references.is_some());
                assert!(scripts.is_some());
                // assets não foi criada — deve vir None.
                assert!(assets.is_none());
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detect_source_rejects_md_file() {
        // Arquivo `.md` solto não é mais reconhecido.
        let dir = unique_dir("detect-md-rejected");
        let file = dir.join("foo.md");
        fs::write(&file, SAMPLE).unwrap();
        assert!(detect_source(&file).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detect_source_rejects_folder_without_skill_md() {
        // Pasta tipo `meta/` que existe só pra organização visual do
        // skills_dir não deve virar uma SkillEntry.
        let dir = unique_dir("detect-no-skill-md");
        let folder = dir.join("meta");
        fs::create_dir_all(&folder).unwrap();
        assert!(detect_source(&folder).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_skill_entries_returns_only_folders() {
        let dir = unique_dir("list-mixed");
        // Arquivo solto: ignored.
        fs::write(dir.join("orphan.md"), SAMPLE).unwrap();
        // Pasta v2: incluída.
        let folder = dir.join("only-v2");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("SKILL.md"), SAMPLE).unwrap();

        let entries = list_skill_entries(&dir);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["only-v2"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_skill_folder_v2_only() {
        let dir = unique_dir("load-v2");
        let folder = dir.join("foo");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("SKILL.md"), SAMPLE).unwrap();

        let loaded = load_skill_folder(&dir, "foo").unwrap();
        assert!(matches!(loaded.source, SkillSource::Folder { .. }));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_skill_folder_rejects_md_file() {
        let dir = unique_dir("load-md-rejected");
        fs::write(dir.join("apenas-arquivo.md"), SAMPLE).unwrap();
        let err = load_skill_folder(&dir, "apenas-arquivo").unwrap_err();
        assert!(err.contains("não encontrada"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_skill_folder_rejects_path_traversal() {
        let dir = unique_dir("load-traversal");
        assert!(load_skill_folder(&dir, "../etc/passwd").is_err());
        assert!(load_skill_folder(&dir, "foo/bar").is_err());
        assert!(load_skill_folder(&dir, "").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_skill_folder_missing_returns_error() {
        let dir = unique_dir("load-missing");
        let err = load_skill_folder(&dir, "ghost").unwrap_err();
        assert!(err.contains("não encontrada"));
        let _ = fs::remove_dir_all(&dir);
    }
}
