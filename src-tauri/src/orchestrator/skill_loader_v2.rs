//! Loader unificado pra skills v1 (`<nome>.md`) e v2 (pasta com
//! `SKILL.md`).
//!
//! O parser ([`crate::orchestrator::skill_parser::parse_skill`]) já
//! aceita frontmatter de ambas as versões; este módulo cuida só da
//! camada de filesystem — descobrir se uma skill está num arquivo
//! solto ou numa pasta, ler o arquivo certo e expor os subdirs
//! opcionais (references/scripts/assets) em uma struct tipada.
//!
//! Estratégia: na coexistência (durante migração v1→v2 o usuário pode
//! ter `legendar-videos.md` E `legendar-videos/` lado a lado), a pasta
//! ganha — v2 é o formato canônico daqui pra frente.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::orchestrator::skill_parser::{self, ParsedSkill};

/// Discriminador da fonte da skill. Paths sempre absolutos quando o
/// loader retorna a struct (callers podem alimentar relativos no
/// `detect_source` mas a pasta-pai do listing já vem absoluta).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SkillSource {
    /// v1 — `<nome>.md` solto na raiz do skills_dir.
    File { path: PathBuf },
    /// v2 — pasta `<nome>/` com `SKILL.md` dentro. Os 3 subdirs são
    /// opcionais (Some quando existem como diretório, None caso
    /// contrário); o caller usa pra resolver caminhos relativos
    /// citados na prosa das etapas (ex: "scripts/extract.sh").
    Folder {
        path: PathBuf,
        skill_md: PathBuf,
        references: Option<PathBuf>,
        scripts: Option<PathBuf>,
        assets: Option<PathBuf>,
    },
}

impl SkillSource {
    /// Caminho do arquivo que o parser realmente lê (o `.md` em v1
    /// ou o `SKILL.md` em v2). Útil pra mensagens de erro / log.
    pub fn entry_path(&self) -> &Path {
        match self {
            Self::File { path } => path,
            Self::Folder { skill_md, .. } => skill_md,
        }
    }
}

/// Skill carregada — junta a fonte (onde o disco mora) com o
/// `ParsedSkill` resultante do parser. O executor consome o `parsed`
/// pra rodar; a UI consome `source` pra abrir/editar/deletar o
/// arquivo certo.
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

/// Inspeciona um path e decide o layout. Retorna `None` quando não é
/// nem um `.md` nem uma pasta com `SKILL.md` dentro — silencia
/// sub-pastas como `meta/`, `drafts/`, etc. que existem só pra
/// organização visual do skills_dir.
pub fn detect_source(path: &Path) -> Option<SkillEntry> {
    if path.is_dir() {
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
    } else if path.extension().map(|e| e == "md").unwrap_or(false) {
        let stem = path.file_stem()?.to_string_lossy().into_owned();
        Some(SkillEntry {
            name: stem,
            source: SkillSource::File {
                path: path.to_path_buf(),
            },
        })
    } else {
        None
    }
}

fn optional_subdir(parent: &Path, name: &str) -> Option<PathBuf> {
    let p = parent.join(name);
    if p.is_dir() {
        Some(p)
    } else {
        None
    }
}

/// Walk one level do skills_dir e retorna uma SkillEntry por skill
/// detectada. Pasta vence arquivo solto quando ambos compartilham
/// nome — estado normal durante a migração v1→v2.
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
    let collected: Vec<PathBuf> = read.flatten().map(|e| e.path()).collect();

    // Dois passes — pastas primeiro, .md depois. Dedup por nome
    // garante que `legendar-videos/` não conflita com
    // `legendar-videos.md` no mesmo dir.
    let mut by_name: std::collections::HashMap<String, SkillEntry> =
        std::collections::HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for path in &collected {
        if !path.is_dir() {
            continue;
        }
        if let Some(item) = detect_source(path) {
            order.push(item.name.clone());
            by_name.insert(item.name.clone(), item);
        }
    }
    for path in &collected {
        if path.is_dir() {
            continue;
        }
        if let Some(item) = detect_source(path) {
            if !by_name.contains_key(&item.name) {
                order.push(item.name.clone());
                by_name.insert(item.name.clone(), item);
            }
        }
    }

    let mut out: Vec<SkillEntry> = Vec::with_capacity(order.len());
    for n in order {
        if let Some(entry) = by_name.remove(&n) {
            out.push(entry);
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Carrega uma skill por `name`. Tenta v2 (pasta) primeiro; se não
/// existir, cai pro v1 (`<name>.md`). Erro quando nenhum dos dois
/// existe ou quando o parser rejeita o conteúdo.
///
/// Path traversal é bloqueado no boundary — `name` não pode conter
/// `/`, `\` ou `..`.
pub fn load_skill_folder(skills_dir: &Path, name: &str) -> Result<SkillFolder, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
    {
        return Err(format!("nome de skill inválido: `{name}`"));
    }

    // v2 primeiro — formato canônico.
    let folder = skills_dir.join(name);
    if folder.is_dir() {
        let skill_md = folder.join("SKILL.md");
        if skill_md.is_file() {
            let content = fs::read_to_string(&skill_md)
                .map_err(|e| format!("falha ao ler {}: {e}", skill_md.display()))?;
            let parsed = skill_parser::parse_skill(&content)?;
            return Ok(SkillFolder {
                source: SkillSource::Folder {
                    path: folder.clone(),
                    skill_md: skill_md.clone(),
                    references: optional_subdir(&folder, "references"),
                    scripts: optional_subdir(&folder, "scripts"),
                    assets: optional_subdir(&folder, "assets"),
                },
                parsed,
            });
        }
    }

    // v1 fallback.
    let file = skills_dir.join(format!("{name}.md"));
    if file.is_file() {
        let content = fs::read_to_string(&file)
            .map_err(|e| format!("falha ao ler {}: {e}", file.display()))?;
        let parsed = skill_parser::parse_skill(&content)?;
        return Ok(SkillFolder {
            source: SkillSource::File { path: file },
            parsed,
        });
    }

    Err(format!("skill `{name}` não encontrada"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal v1-format SKILL.md content the parser accepts. Used
    /// across tests so the file reads succeed without us needing to
    /// re-test the parser itself.
    const SAMPLE_V1: &str = "---\n\
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
    fn detect_source_recognizes_md_file() {
        let dir = unique_dir("detect-file");
        let file = dir.join("foo.md");
        fs::write(&file, "anything").unwrap();
        let entry = detect_source(&file).unwrap();
        assert_eq!(entry.name, "foo");
        assert!(matches!(entry.source, SkillSource::File { .. }));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detect_source_recognizes_v2_folder() {
        let dir = unique_dir("detect-folder");
        let skill = dir.join("legendar-videos");
        fs::create_dir_all(skill.join("scripts")).unwrap();
        fs::create_dir_all(skill.join("references")).unwrap();
        fs::write(skill.join("SKILL.md"), SAMPLE_V1).unwrap();

        let entry = detect_source(&skill).unwrap();
        assert_eq!(entry.name, "legendar-videos");
        match entry.source {
            SkillSource::Folder {
                references, scripts, assets, ..
            } => {
                assert!(references.is_some());
                assert!(scripts.is_some());
                // assets não foi criada — deve vir None.
                assert!(assets.is_none());
            }
            _ => panic!("expected Folder variant"),
        }
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
    fn list_skill_entries_prefers_folder_over_file_with_same_name() {
        let dir = unique_dir("list-coexist");
        // v1: arquivo solto
        fs::write(dir.join("legendar-videos.md"), SAMPLE_V1).unwrap();
        // v2: pasta com mesmo stem
        let folder = dir.join("legendar-videos");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("SKILL.md"), SAMPLE_V1).unwrap();

        let entries = list_skill_entries(&dir);
        assert_eq!(entries.len(), 1, "duplicate name should resolve to one entry");
        match &entries[0].source {
            SkillSource::Folder { .. } => {}
            _ => panic!("v2 folder should win over v1 file"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_skill_entries_returns_both_formats_when_distinct() {
        let dir = unique_dir("list-mixed");
        fs::write(dir.join("only-v1.md"), SAMPLE_V1).unwrap();
        let folder = dir.join("only-v2");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("SKILL.md"), SAMPLE_V1).unwrap();

        let entries = list_skill_entries(&dir);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["only-v1", "only-v2"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_skill_folder_v2_first() {
        let dir = unique_dir("load-v2-first");
        // v1 + v2 com mesmo nome — v2 deve ganhar.
        fs::write(dir.join("dup.md"), SAMPLE_V1).unwrap();
        let folder = dir.join("dup");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("SKILL.md"), SAMPLE_V1).unwrap();

        let loaded = load_skill_folder(&dir, "dup").unwrap();
        assert!(matches!(loaded.source, SkillSource::Folder { .. }));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn load_skill_folder_falls_back_to_v1() {
        let dir = unique_dir("load-v1-fallback");
        fs::write(dir.join("apenas-arquivo.md"), SAMPLE_V1).unwrap();
        let loaded = load_skill_folder(&dir, "apenas-arquivo").unwrap();
        assert!(matches!(loaded.source, SkillSource::File { .. }));
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
