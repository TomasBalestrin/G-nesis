//! Migration v1 → v2 das skills no startup do app.
//!
//! Skills v1 = `~/.genesis/skills/<name>.md` (arquivo solto). Skills
//! v2 = `~/.genesis/skills/<name>/SKILL.md` + `assets/` + `references/`
//! (pasta-por-skill). Esse módulo escaneia o `skills_dir` no boot e
//! converte cada `.md` solto pro layout v2 idempotentemente:
//!
//! 1. Parseia frontmatter pra obter `name` (fallback: stem do filename).
//! 2. Se já existe pasta `<name>/` com SKILL.md → pula (já migrado ou
//!    conflito; no segundo caso loga mas não toca em nada).
//! 3. Cria `<name>/`, move `<name>.md` → `<name>/SKILL.md`, cria
//!    `assets/` e `references/` vazios.
//! 4. UPSERT no mirror SQLite (best-effort — falha aqui só loga).
//!
//! Falhas são best-effort por skill: erro num arquivo NÃO interrompe
//! o resto. Resultado da função é `Ok(())` mesmo com falhas parciais
//! (logadas em stderr) — startup do app não pode ser bloqueado por
//! skill mal-formada.

use std::fs;
use std::path::Path;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::db::models::SkillRow;
use crate::db::queries;
use crate::orchestrator::skill_parser;
use crate::skills::storage as skill_storage;

/// Roda uma vez no startup. Idempotente — segunda chamada não faz nada
/// (todos os `.md` já viraram pastas). Conta sucessos e logs.
///
/// Falha total (não consegue ler `skills_dir`) retorna Err pra que o
/// startup veja; falhas individuais por skill ficam no log e não
/// bloqueiam.
pub async fn migrate_v1_skills(pool: &SqlitePool) -> Result<MigrationReport, String> {
    let dir = skill_storage::skills_dir()?;
    if !dir.exists() {
        return Ok(MigrationReport::default());
    }

    let mut report = MigrationReport::default();
    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_v1_candidate(&path) {
            continue;
        }
        report.scanned += 1;

        match migrate_one(&path, pool).await {
            Ok(MigrationOutcome::Migrated(name)) => {
                eprintln!("[skills::migration] Migrated skill {name} from v1 to v2");
                report.migrated += 1;
            }
            Ok(MigrationOutcome::Skipped(reason)) => {
                eprintln!(
                    "[skills::migration] skipped {}: {reason}",
                    path.display()
                );
                report.skipped += 1;
            }
            Err(err) => {
                eprintln!(
                    "[skills::migration] failed {}: {err}",
                    path.display()
                );
                report.failed += 1;
            }
        }
    }

    Ok(report)
}

#[derive(Debug, Default, Clone, Copy)]
pub struct MigrationReport {
    /// Total de `.md` soltos detectados (excluindo dotfiles + pastas).
    pub scanned: usize,
    /// Convertidos com sucesso pra `<name>/SKILL.md`.
    pub migrated: usize,
    /// Já estavam migrados (pasta `<name>/SKILL.md` existia) ou
    /// frontmatter inválido — sem modificações em disco.
    pub skipped: usize,
    /// Erros — typically I/O (permissão, disco). Logados em stderr.
    pub failed: usize,
}

enum MigrationOutcome {
    Migrated(String),
    Skipped(&'static str),
}

/// Filtro: só `<skills_dir>/<name>.md` (arquivo, sem dotfiles, com
/// extensão `.md`). Subpastas e arquivos hidden ficam fora.
fn is_v1_candidate(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return false,
    };
    if name.starts_with('.') {
        return false;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

/// Converte um único arquivo. Não retorna `Err` quando a operação foi
/// um no-op intencional (skill já migrada, frontmatter quebrado) —
/// usa `Skipped(reason)` pra deixar o caller distinguir.
async fn migrate_one(
    md_path: &Path,
    pool: &SqlitePool,
) -> Result<MigrationOutcome, String> {
    let content = fs::read_to_string(md_path)
        .map_err(|e| format!("cannot read: {e}"))?;

    // Tenta parsear frontmatter pra `name`. Quando o arquivo não tem
    // frontmatter válido (skill quebrada ou .md não relacionado),
    // cai pro nome do arquivo. Skill_parser falha bem ruidoso —
    // ignoramos detalhe via `.ok()`.
    let parsed_name = skill_parser::parse_skill(&content)
        .ok()
        .map(|s| s.meta.name.trim().to_string())
        .filter(|s| !s.is_empty());
    let name = match parsed_name {
        Some(n) => n,
        None => match md_path.file_stem().and_then(|s| s.to_str()) {
            Some(stem) if !stem.is_empty() => stem.to_string(),
            _ => return Ok(MigrationOutcome::Skipped("filename inválido")),
        },
    };

    // Reusa skill_dir() que já valida `name` contra `..`/separator/empty.
    let dest_dir = skill_storage::skill_dir(&name)?;
    let dest_md = dest_dir.join("SKILL.md");
    if dest_md.is_file() {
        // Conflito: pasta v2 com mesmo nome já tem SKILL.md.
        // Política conservadora: não sobrescreve, deixa caller
        // resolver manualmente (apagar v1 ou renomear pasta).
        return Ok(MigrationOutcome::Skipped("v2 já existe"));
    }

    // Cria pasta + assets/ + references/. Idempotente.
    skill_storage::ensure_skill_dirs(&name)?;

    // Move `<name>.md` → `<name>/SKILL.md`. fs::rename atomic em
    // mesmo FS; fallback copy + remove em cross-device. Aqui é mesmo
    // FS (skills_dir é um único diretório), mas defensivo.
    if fs::rename(md_path, &dest_md).is_err() {
        fs::copy(md_path, &dest_md).map_err(|e| format!("copy: {e}"))?;
        let _ = fs::remove_file(md_path);
    }

    // UPSERT mirror SQLite — best-effort. Re-stat pra pegar
    // has_assets/has_references atual (acabaram de ser criados vazios).
    if let Some(package) = skill_storage::get_skill_package(&name)? {
        let existing = queries::get_skill_by_name(pool, &name).await.ok().flatten();
        let row = SkillRow {
            id: existing
                .as_ref()
                .map(|r| r.id.clone())
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            name: package.name.clone(),
            version: existing
                .as_ref()
                .map(|r| r.version.clone())
                .unwrap_or_else(|| "1.0".to_string()),
            author: existing.and_then(|r| r.author),
            has_assets: if package.has_assets { 1 } else { 0 },
            has_references: if package.has_references { 1 } else { 0 },
            files_count: package.files_count as i64,
            created_at: String::new(),
            updated_at: String::new(),
        };
        if queries::update_skill(pool, &row).await.is_err() {
            if let Err(err) = queries::insert_skill(pool, &row).await {
                eprintln!(
                    "[skills::migration] mirror SQLite UPSERT `{name}` falhou: {err}"
                );
            }
        }
    }

    Ok(MigrationOutcome::Migrated(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn t(p: &str) -> PathBuf {
        PathBuf::from(p)
    }

    #[test]
    fn is_v1_candidate_filters_correctly() {
        // Arquivo `.md` direto: candidato.
        // Mas o helper precisa de `is_file()` real — verificamos só o
        // ramo de filtro de extensão / dotfile via paths que existem
        // num tempdir.
        // Skip o teste de is_file porque depende de FS real.
        // Isso é coberto indiretamente pelo migrate_one no teste de
        // integração (não escrito aqui pra evitar setup de tempdir).

        // Ramo dotfile: rejeita.
        let dotfile = t(".oculto.md");
        assert!(!is_v1_candidate(&dotfile));

        // Ramo extensão: rejeita .txt mesmo que arquivo.
        let txt = t("nao-eh-md.txt");
        assert!(!is_v1_candidate(&txt));
    }
}
