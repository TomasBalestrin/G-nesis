//! Empacota skills v2 como arquivo `.skill` (ZIP).
//!
//! Layout produzido (idêntico ao que `skills::import` consome):
//! ```text
//! <name>/
//! ├── SKILL.md
//! ├── assets/*
//! └── references/*
//! ```
//!
//! Fluxo do command `export_skill` no frontend:
//!   1. Backend cria `<temp_dir>/<name>.skill` e retorna o path.
//!   2. Frontend abre `dialog.save()` pra perguntar onde salvar.
//!   3. Frontend chama `move_file(src=temp, dest=user_choice)` pra
//!      mover o ZIP pro destino final + apagar o temp.
//!
//! Esse fluxo de duas etapas separa "criar o ZIP" (precisa só de
//! acesso ao skills_dir + temp_dir) de "salvar arquivo arbitrário"
//! (precisa do consentimento via dialog), evitando que o command
//! de export tenha permissão de escrita em qualquer lugar do disco.

use std::fs;
use std::io::Write;
use std::path::PathBuf;

use zip::write::FileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

use crate::skills::storage as skill_storage;

/// Empacota `~/.genesis/skills/<name>/` como `<temp_dir>/<name>.skill`.
/// Sobrescreve o arquivo se já existir (tipicamente um export anterior
/// que não foi finalizado pelo dialog.save). Caller é responsável por
/// movê-lo (ou apagá-lo) — o backend não dá housekeeping automático
/// porque um export pode ser cancelado mid-flow no frontend.
///
/// Erros user-actionable:
/// - "skill `<name>` não encontrada": pasta da skill ausente.
/// - "falha ao criar `<temp>/<name>.skill`": permissão / disco.
/// - "zip ...": stream do `zip` crate falhou.
pub fn export_skill_package(name: &str) -> Result<PathBuf, String> {
    let dir = skill_storage::skill_dir(name)?;
    if !dir.is_dir() {
        return Err(format!("skill `{name}` não encontrada"));
    }

    let dest = std::env::temp_dir().join(format!("{name}.skill"));
    let file = fs::File::create(&dest)
        .map_err(|e| format!("falha ao criar {}: {e}", dest.display()))?;
    let mut zip = ZipWriter::new(file);
    let opts = FileOptions::default().compression_method(CompressionMethod::Deflated);

    // Walk próprio (raiz + 1 subpasta basta — packages não têm
    // estrutura mais profunda). Os arquivos vão como `<name>/<...>`
    // dentro do ZIP pra casar com o que o importer espera no inspect_archive.
    for entry in fs::read_dir(&dir)
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| format!("read_dir entry: {e}"))?;
        let path = entry.path();
        let rel_top = entry.file_name().to_string_lossy().into_owned();
        if path.is_file() {
            write_zip_entry(&mut zip, opts, &format!("{name}/{rel_top}"), &path)?;
        } else if path.is_dir() {
            for child in fs::read_dir(&path)
                .map_err(|e| format!("cannot read {}: {e}", path.display()))?
            {
                let child = child.map_err(|e| format!("read_dir child: {e}"))?;
                let cpath = child.path();
                if !cpath.is_file() {
                    continue;
                }
                let cname = child.file_name().to_string_lossy().into_owned();
                write_zip_entry(
                    &mut zip,
                    opts,
                    &format!("{name}/{rel_top}/{cname}"),
                    &cpath,
                )?;
            }
        }
    }
    zip.finish().map_err(|e| format!("zip finish: {e}"))?;
    Ok(dest)
}

fn write_zip_entry(
    zip: &mut ZipWriter<fs::File>,
    opts: FileOptions,
    rel_path: &str,
    src: &std::path::Path,
) -> Result<(), String> {
    zip.start_file(rel_path, opts)
        .map_err(|e| format!("zip start_file: {e}"))?;
    let data = fs::read(src)
        .map_err(|e| format!("falha ao ler {}: {e}", src.display()))?;
    zip.write_all(&data).map_err(|e| format!("zip write: {e}"))?;
    Ok(())
}
