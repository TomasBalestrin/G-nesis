//! Tauri IPC handlers for skill management.
//!
//! Skills v2 only — `~/.genesis/skills/<name>/SKILL.md` + `assets/` +
//! `references/`. O legado v1 (`<name>.md` solto) foi removido em F2;
//! migração existente vive em `skills::migration` e roda no startup.
//! `list_skills` retorna metadata parseada do frontmatter pra UI;
//! mirror SQLite (migration 009) é populado pelas operações de write
//! pra list/sort rápido.
//!
//! Path handling defensivo: `name` arg validado contra `..` /
//! separators / vazio via `crate::skills::storage::skill_dir`.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::State;
use uuid::Uuid;

use crate::db::models::SkillRow;
use crate::db::queries;
use crate::orchestrator::skill_parser;
use crate::skills::storage as skill_storage;
use crate::skills::SkillPackage;

#[tauri::command]
pub async fn list_skills() -> Result<Vec<skill_parser::SkillMeta>, String> {
    let packages = skill_storage::list_skill_packages()?;
    let mut metas: Vec<skill_parser::SkillMeta> = Vec::with_capacity(packages.len());
    for pkg in packages {
        let skill_md = pkg.path.join("SKILL.md");
        match fs::read_to_string(&skill_md) {
            Ok(content) => match skill_parser::parse_skill(&content) {
                Ok(skill) => metas.push(skill.meta),
                Err(err) => eprintln!(
                    "[skills] pulando {} ao listar: {err}",
                    skill_md.display()
                ),
            },
            Err(err) => eprintln!(
                "[skills] falha ao ler {}: {err}",
                skill_md.display()
            ),
        }
    }
    metas.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(metas)
}

/// Delete the on-disk artifact backing a skill — pasta `<name>/`
/// inteira (incluindo `scripts/`, `references/`, `assets/`).
///
/// Ordem do cleanup:
///   1. Bloqueio: execuções em andamento abortam o delete (caller
///      precisa parar antes — o executor pode ainda estar lendo).
///   2. Best-effort `fs::remove_dir_all` na pasta — falha de I/O é
///      logada mas NÃO interrompe o passo 3, pra que mirror SQLite
///      não fique órfão quando o disco está ruim.
///   3. Hard `DELETE FROM skills WHERE name = ?` no mirror (migration
///      009). Roda sempre, inclusive quando a pasta não existia
///      (limpa mirrors órfãos).
///
/// Retorno:
///   - `Ok(())` quando alguma das duas operações tocou estado real
///     (apagou pasta OU apagou row OU ambos). Nome fica livre pra
///     reuso imediato — `create_skill(name)` próximo passa.
///   - `Err("não encontrada")` quando NEM pasta NEM row existiam.
///   - `Err("falha ao deletar pasta...")` quando o FS falhou (pasta
///     pode estar parcialmente apagada). SQLite já foi limpo nesse
///     caso, então retry vai cair na branch "não encontrada".
#[tauri::command]
pub async fn delete_skill(name: String, pool: State<'_, SqlitePool>) -> Result<(), String> {
    let folder = skill_storage::skill_dir(&name)?;

    let active = queries::count_active_by_skill_name(&pool, &name).await?;
    if active > 0 {
        return Err(format!(
            "skill `{name}` está sendo executada agora ({active} execução(ões) ativas). \
             Aborte ou aguarde antes de deletar."
        ));
    }

    let folder_existed = folder.is_dir();
    let mut fs_err: Option<String> = None;
    if folder_existed {
        if let Err(e) = fs::remove_dir_all(&folder) {
            let msg = format!("falha ao deletar pasta {}: {e}", folder.display());
            eprintln!("[skills] delete `{name}`: {msg}");
            fs_err = Some(msg);
        }
    }

    // Mirror SQLite cleanup roda incondicional — best-effort logado
    // se falhar, não derruba o delete inteiro.
    let mirror_existed = matches!(
        queries::get_skill_by_name(&pool, &name).await,
        Ok(Some(_))
    );
    if let Err(err) = queries::delete_skill_row(&pool, &name).await {
        eprintln!("[skills] cleanup mirror SQLite `{name}` falhou: {err}");
    }

    if let Some(msg) = fs_err {
        return Err(msg);
    }
    if !folder_existed && !mirror_existed {
        return Err(format!("skill `{name}` não encontrada"));
    }
    Ok(())
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

/// Lista todos os skill packages v2 do FS via `list_skill_packages`,
/// enriquecidos com `id` e `created_at` do mirror SQLite (best-effort
/// — packages sem mirror ficam com None nesses campos). FS continua
/// source-of-truth pra has_assets/has_references/files_count.
#[tauri::command]
pub async fn list_skill_packages(
    pool: State<'_, SqlitePool>,
) -> Result<Vec<SkillPackage>, String> {
    let mut packages = skill_storage::list_skill_packages()?;
    // Best-effort SQLite join. Falha aqui (mirror corrompido,
    // permissão) só faz id/created_at saírem como None — UI degrada
    // graceful (Skill.id cai pra name como fallback no FE).
    if let Ok(rows) = queries::list_skills(&pool).await {
        let by_name: std::collections::HashMap<String, &SkillRow> =
            rows.iter().map(|r| (r.name.clone(), r)).collect();
        for pkg in &mut packages {
            if let Some(row) = by_name.get(&pkg.name) {
                pkg.id = Some(row.id.clone());
                pkg.created_at = Some(row.created_at.clone());
            }
        }
    }
    Ok(packages)
}

/// Bundle de uma skill: package (com id/created_at do mirror) +
/// SKILL.md content + filenames de references/assets em uma chamada.
/// UI evita 3 IPCs separados pra abrir uma skill.
#[tauri::command]
pub async fn get_skill(
    name: String,
    pool: State<'_, SqlitePool>,
) -> Result<SkillBundle, String> {
    let mut package = skill_storage::get_skill_package(&name)?
        .ok_or_else(|| format!("skill `{name}` não encontrada"))?;
    if let Ok(Some(row)) = queries::get_skill_by_name(&pool, &name).await {
        package.id = Some(row.id);
        package.created_at = Some(row.created_at);
    }
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

/// Lê um asset binário e retorna data URL (`data:<mime>;base64,...`).
/// MIME inferido por extensão — fallback `application/octet-stream`
/// pra extensões desconhecidas. Pensado pra <img src=...> direto na
/// UI; para arquivos texto, prefira `get_skill_file`.
#[tauri::command]
pub async fn read_skill_asset_data_url(
    name: String,
    path: String,
) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine as _};
    let resolved = resolve_skill_file(&name, &path)?;
    let bytes = fs::read(&resolved)
        .map_err(|e| format!("falha ao ler {}: {e}", resolved.display()))?;
    let mime = guess_mime_from_path(&path);
    let encoded = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

/// Empacota a skill `<name>` como `.skill` (ZIP) em diretório temporário
/// e retorna o path como string. Frontend usa `dialog.save()` pra
/// pedir destino ao usuário, depois chama `move_file(temp, dest)` pra
/// finalizar. Esse fluxo de duas etapas mantém o command de export
/// sem precisar de permissão de escrita arbitrária.
#[tauri::command]
pub async fn export_skill(name: String) -> Result<String, String> {
    let path = crate::skills::export::export_skill_package(&name)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Move um arquivo de `src` pra `dest` (ou copia + apaga, quando o
/// rename atravessa filesystems). Idempotente em `dest` — sobrescreve
/// se existir. Usado pelo flow de export do SkillDetailView pra
/// finalizar o ZIP que `export_skill` deixou em `temp_dir`.
///
/// Não é um command genérico de FS — caller precisa ter os paths
/// específicos em mãos. Não faz validação de "src deve ser temp" pra
/// evitar acoplamento; UI é quem orquestra os dois passos.
#[tauri::command]
pub async fn move_file(src: String, dest: String) -> Result<(), String> {
    let src_path = std::path::PathBuf::from(&src);
    let dest_path = std::path::PathBuf::from(&dest);
    if !src_path.is_file() {
        return Err(format!("origem não é arquivo: {src}"));
    }
    // Tenta rename primeiro (rápido, atômico em mesmo FS). Falha
    // típica: cross-device link → fallback pra copy + remove.
    match fs::rename(&src_path, &dest_path) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("falha ao copiar pra {dest}: {e}"))?;
            // Best-effort: temp removido após copy bem-sucedido. Falha
            // aqui só polui /tmp; OS limpa eventualmente.
            let _ = fs::remove_file(&src_path);
            Ok(())
        }
    }
}

fn guess_mime_from_path(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "application/javascript",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
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
    // skill_dir() valida o name contra `..` / separators / vazio.
    let v2_dir = skill_storage::skill_dir(&name)?;
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
    // sobrescrever — frontmatter quebrado é rejeitado no boundary.
    if path == "SKILL.md" || resolved.ends_with("SKILL.md") {
        skill_parser::parse_skill(&content).map_err(|e| format!("skill inválida: {e}"))?;
    }

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("falha ao criar {}: {e}", parent.display()))?;
    }
    fs::write(&resolved, content)
        .map_err(|e| format!("falha ao salvar {}: {e}", resolved.display()))?;

    sync_skill_mirror(&pool, &name).await;
    Ok(())
}

/// Salva um arquivo binário dentro do package — pra assets que não
/// são texto (imagens, PDFs, etc). Mesma validação de path do
/// `save_skill_file`, mas aceita `Vec<u8>` em vez de `String`. Tauri
/// serializa de Uint8Array do JS pra Vec<u8> automaticamente.
///
/// Recusa salvar SKILL.md por aqui — esse é caminho de texto +
/// validação via parser. Use `save_skill_file` pro markdown.
#[tauri::command]
pub async fn save_skill_asset(
    name: String,
    path: String,
    bytes: Vec<u8>,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    let resolved = resolve_skill_file(&name, &path)?;
    if path == "SKILL.md" || resolved.ends_with("SKILL.md") {
        return Err("use save_skill_file pra SKILL.md".into());
    }

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("falha ao criar {}: {e}", parent.display()))?;
    }
    fs::write(&resolved, &bytes)
        .map_err(|e| format!("falha ao salvar {}: {e}", resolved.display()))?;
    sync_skill_mirror(&pool, &name).await;
    Ok(())
}

/// Remove um arquivo dentro do package (`references/x.md`,
/// `assets/y.png`). Idempotente — arquivo ausente não erra. Recusa
/// remover SKILL.md (use `delete_skill` pra apagar a skill toda) e
/// recusa remover diretórios. Atualiza o mirror SQLite ao final.
#[tauri::command]
pub async fn delete_skill_file(
    name: String,
    path: String,
    pool: State<'_, SqlitePool>,
) -> Result<(), String> {
    let resolved = resolve_skill_file(&name, &path)?;
    if path == "SKILL.md" || resolved.ends_with("SKILL.md") {
        return Err("não delete SKILL.md por aqui — use delete_skill".into());
    }
    if !resolved.exists() {
        return Ok(());
    }
    if resolved.is_dir() {
        return Err(format!(
            "{} é diretório; só removo arquivos por aqui",
            resolved.display()
        ));
    }
    fs::remove_file(&resolved)
        .map_err(|e| format!("falha ao remover {}: {e}", resolved.display()))?;
    sync_skill_mirror(&pool, &name).await;
    Ok(())
}

// ── helpers ─────────────────────────────────────────────────────────────────

/// Re-stat o package + sincroniza o mirror SQLite (has_assets,
/// has_references, files_count). Best-effort: falha aqui não
/// derruba a operação que chamou — o FS continua source-of-truth.
async fn sync_skill_mirror(pool: &SqlitePool, name: &str) {
    let package = match skill_storage::get_skill_package(name) {
        Ok(Some(p)) => p,
        _ => return,
    };
    let existing = queries::get_skill_by_name(pool, name).await.ok().flatten();
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
            eprintln!("[skills] sync SQLite mirror `{name}` falhou: {err}");
        }
    }
}

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
}
