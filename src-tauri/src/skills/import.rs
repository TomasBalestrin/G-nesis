//! Import de skill packages a partir de arquivos `.skill` (ZIP).
//!
//! Layout esperado dentro do ZIP:
//! ```text
//! <name>/
//! ├── SKILL.md          ← obrigatório
//! ├── assets/           ← opcional
//! └── references/       ← opcional
//! ```
//!
//! Validações antes de extrair:
//! - Tamanho do ZIP ≤ 50 MB.
//! - Arquivo é ZIP válido (zip crate confirma magic bytes).
//! - EXATAMENTE 1 pasta raiz no ZIP — não suportamos multi-skill em
//!   um só `.skill` (cada arquivo = um package).
//! - Pasta raiz tem `SKILL.md` direto dentro.
//! - Nenhum entry com `..` ou path absoluto (zip-slip prevention).
//! - Skill com mesmo nome NÃO existe em disco — caller é avisado pra
//!   apagar a antiga antes de re-importar (sem clobber implícito).
//!
//! Sucesso: extrai pra `~/.genesis/skills/<name>/` e insere row no
//! mirror SQLite (tabela `skills` da migration 009).

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use sqlx::SqlitePool;
use uuid::Uuid;
use zip::ZipArchive;

use crate::db::models::SkillRow;
use crate::db::queries;
use crate::skills::storage::{self, SkillPackage};

/// 50 MiB hard cap. Skill packages legítimos são pequenos (markdown
/// + alguns templates); arquivos maiores quase certamente são erros
/// de upload (vídeo, dump de DB) ou tentativa de DoS por extração.
const MAX_ZIP_BYTES: u64 = 50 * 1024 * 1024;

/// Extrai um `.skill` (ZIP) pra `~/.genesis/skills/<name>/` e
/// registra no mirror SQLite. Retorna o `SkillPackage` recém-criado
/// pra UI poder exibir confirmação (filescount, has_assets, etc).
///
/// Erros (todos com mensagens user-actionable):
/// - "arquivo .skill muito grande..." → MAX_ZIP_BYTES excedido.
/// - "ZIP inválido: ..." → magic bytes errados ou arquivo corrompido.
/// - "ZIP precisa ter exatamente 1 pasta raiz" → multi-skill ou
///   arquivos soltos sem wrapper.
/// - "ZIP não tem SKILL.md em <root>/" → estrutura incompleta.
/// - "Skill `<name>` já existe" → conflito; user remove antes.
/// - "path inválido no ZIP: ..." → zip-slip detectado, recusa por
///   segurança sem nem tocar disco.
pub async fn import_skill_package(
    file_path: &str,
    pool: &SqlitePool,
) -> Result<SkillPackage, String> {
    let path = Path::new(file_path);
    let metadata = fs::metadata(path)
        .map_err(|e| format!("não consegui ler {file_path}: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("{file_path} não é um arquivo"));
    }
    if metadata.len() > MAX_ZIP_BYTES {
        return Err(format!(
            "arquivo .skill muito grande ({} bytes; limite {} MiB)",
            metadata.len(),
            MAX_ZIP_BYTES / (1024 * 1024)
        ));
    }

    let file = fs::File::open(path)
        .map_err(|e| format!("não consegui abrir {file_path}: {e}"))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("ZIP inválido: {e}"))?;

    let inspection = inspect_archive(&mut archive)?;
    let skill_name = inspection.root_name;

    // skill_dir() valida o name (sem '/', '\\', '..', vazio).
    let dest = storage::skill_dir(&skill_name)?;
    if dest.exists() {
        return Err(format!("Skill `{skill_name}` já existe"));
    }

    extract_archive(&mut archive, &skill_name, &dest)?;

    let package = storage::get_skill_package(&skill_name)?.ok_or_else(|| {
        "skill extraída mas package não foi reconhecido (SKILL.md ausente?)".to_string()
    })?;

    // Mirror SQLite: best-effort. FS é source-of-truth, então falha
    // aqui só loga e segue.
    let row = SkillRow {
        id: Uuid::new_v4().to_string(),
        name: package.name.clone(),
        version: "1.0".to_string(),
        author: None,
        has_references: if package.has_references { 1 } else { 0 },
        has_assets: if package.has_assets { 1 } else { 0 },
        has_scripts: if package.has_scripts { 1 } else { 0 },
        files_count: package.files_count as i64,
        created_at: String::new(),
        updated_at: String::new(),
    };
    if let Err(err) = queries::insert_skill(pool, &row).await {
        eprintln!(
            "[skills::import] insert mirror SQLite `{}` falhou: {err}",
            package.name
        );
    }

    Ok(package)
}

// ── internals ───────────────────────────────────────────────────────────────

#[derive(Debug)]
struct ArchiveInspection {
    root_name: String,
}

/// Two-pass: scan all entries, garante (a) único root folder, (b)
/// SKILL.md presente sob ele, (c) zero zip-slip. Não extrai ainda —
/// se algo falhar, o disco fica intocado.
fn inspect_archive<R: io::Read + io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<ArchiveInspection, String> {
    let mut root: Option<String> = None;
    let mut has_skill_md = false;

    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| format!("ZIP entry {i} ilegível: {e}"))?;
        let raw_name = entry.name();
        let entry_path = enclosed_name(&entry).ok_or_else(|| {
            format!("path inválido no ZIP: `{raw_name}` (zip-slip ou encoding)")
        })?;

        // Componentes — exige primeiro segmento como pasta raiz.
        let mut comps = entry_path.components();
        let first = match comps.next() {
            Some(Component::Normal(s)) => s.to_string_lossy().into_owned(),
            _ => {
                return Err(format!(
                    "path inválido no ZIP: `{raw_name}` (esperado <root>/...)"
                ))
            }
        };

        match &root {
            None => root = Some(first.clone()),
            Some(r) if r != &first => {
                return Err(format!(
                    "ZIP precisa ter exatamente 1 pasta raiz; achei `{r}` e `{first}`"
                ))
            }
            _ => {}
        }

        // Detect SKILL.md no nível 1 da raiz.
        let rest: PathBuf = comps.collect();
        if rest == Path::new("SKILL.md") {
            has_skill_md = true;
        }
    }

    let root_name = root.ok_or_else(|| "ZIP vazio".to_string())?;
    if !has_skill_md {
        return Err(format!("ZIP não tem SKILL.md em {root_name}/"));
    }
    Ok(ArchiveInspection { root_name })
}

/// Wrapper sobre `ZipFile::enclosed_name()` que retorna `None`
/// quando o path é absoluto, contém `..` ou não é UTF-8 normalizado.
/// O zip crate já implementa esse check; só re-exportamos pra dar
/// uma mensagem de erro consistente.
fn enclosed_name(entry: &zip::read::ZipFile) -> Option<PathBuf> {
    entry.enclosed_name().map(|p| p.to_path_buf())
}

/// Extrai cada entry pra `dest` (que é `~/.genesis/skills/<root>/`).
/// As entries vêm prefixadas com `<root>/`; tiramos o prefixo pra
/// que `dest = <skills_dir>/<root>` receba `SKILL.md`, `assets/x`, etc.
/// Re-valida cada entry com `enclosed_name` por defesa em
/// profundidade (inspect_archive já validou, mas belt-and-suspenders).
fn extract_archive<R: io::Read + io::Seek>(
    archive: &mut ZipArchive<R>,
    root_name: &str,
    dest: &Path,
) -> Result<(), String> {
    fs::create_dir_all(dest)
        .map_err(|e| format!("não consegui criar {}: {e}", dest.display()))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("ZIP entry {i} ilegível: {e}"))?;
        let entry_path = match enclosed_name(&entry) {
            Some(p) => p,
            None => continue,
        };

        // Strip o root_name pra produzir path relativo ao dest.
        // Se o entry é o root sozinho (raro mas possível em ZIPs com
        // diretórios nominais), pula — dest já existe.
        let relative = match entry_path.strip_prefix(root_name) {
            Ok(r) if r.as_os_str().is_empty() => continue,
            Ok(r) => r.to_path_buf(),
            Err(_) => continue,
        };
        let target = dest.join(&relative);

        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| {
                format!("não consegui criar {}: {e}", target.display())
            })?;
            continue;
        }

        // Garantir parent dirs (entries de arquivo podem vir antes
        // dos seus diretórios).
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("não consegui criar {}: {e}", parent.display()))?;
        }
        let mut out = fs::File::create(&target)
            .map_err(|e| format!("não consegui criar {}: {e}", target.display()))?;
        io::copy(&mut entry, &mut out)
            .map_err(|e| format!("falha ao extrair {}: {e}", target.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::FileOptions;

    /// Constrói um ZIP em memória com a estrutura e bytes que os
    /// testes pedem. Cada `(path, body)` é gravado como entry.
    fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buf: Vec<u8> = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(io::Cursor::new(&mut buf));
            let opts = FileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            for (path, body) in entries {
                if path.ends_with('/') {
                    zw.add_directory(*path, opts).unwrap();
                } else {
                    zw.start_file(*path, opts).unwrap();
                    zw.write_all(body).unwrap();
                }
            }
            zw.finish().unwrap();
        }
        buf
    }

    fn inspect(bytes: &[u8]) -> Result<ArchiveInspection, String> {
        let mut archive = ZipArchive::new(io::Cursor::new(bytes))
            .map_err(|e| format!("ZIP inválido: {e}"))?;
        inspect_archive(&mut archive)
    }

    #[test]
    fn inspect_accepts_valid_layout() {
        let zip = build_zip(&[
            ("legendar/SKILL.md", b"---\nname: legendar\n---\n"),
            ("legendar/references/iron-man.md", b"# iron"),
            ("legendar/assets/template.html", b"<html></html>"),
        ]);
        let r = inspect(&zip).unwrap();
        assert_eq!(r.root_name, "legendar");
    }

    #[test]
    fn inspect_rejects_missing_skill_md() {
        let zip = build_zip(&[
            ("legendar/references/x.md", b"x"),
            ("legendar/assets/y.html", b"y"),
        ]);
        let err = inspect(&zip).unwrap_err();
        assert!(err.contains("SKILL.md"), "esperado erro SKILL.md: {err}");
    }

    #[test]
    fn inspect_rejects_multiple_roots() {
        let zip = build_zip(&[
            ("legendar/SKILL.md", b"x"),
            ("outra-skill/SKILL.md", b"y"),
        ]);
        let err = inspect(&zip).unwrap_err();
        assert!(err.contains("1 pasta raiz"), "esperado erro multi-root: {err}");
    }

    #[test]
    fn inspect_rejects_files_at_root() {
        let zip = build_zip(&[("SKILL.md", b"---\nname: x\n---\n")]);
        let err = inspect(&zip).unwrap_err();
        // "SKILL.md" sozinho não tem componentes além de Normal —
        // mas como o root vira "SKILL.md" e não há "<root>/SKILL.md"
        // dentro dele, o has_skill_md fica false. Mensagem contém
        // SKILL.md.
        assert!(err.contains("SKILL.md"), "esperado erro: {err}");
    }
}
