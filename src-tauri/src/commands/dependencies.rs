//! Tauri IPC handlers for CLI dependency discovery + install.
//!
//! `check_dependency` runs `which <name>` and returns true if the binary is
//! on PATH. `install_dependency` runs `brew install <name>` (macOS-focused;
//! on Linux/Windows this errors out cleanly — we'll expand to apt/winget
//! when there's a real user on those platforms).
//!
//! Name sanitisation keeps shell shenanigans out: only ASCII alphanumerics
//! plus `- _ . +` are accepted, so `$(rm -rf ~)` or `;curl …` never reach
//! `Command::new`.

use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const INSTALL_TIMEOUT_SECS: u64 = 600;
const CHECK_TIMEOUT_SECS: u64 = 15;

fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
}

#[tauri::command]
pub async fn check_dependency(name: String) -> Result<bool, String> {
    if !is_safe_name(&name) {
        return Err(format!("nome inválido: `{name}`"));
    }

    let child = Command::new("which")
        .arg(&name)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("falha ao executar which: {e}"))?;

    match timeout(Duration::from_secs(CHECK_TIMEOUT_SECS), child.wait_with_output()).await {
        Ok(Ok(output)) => Ok(output.status.success()),
        Ok(Err(e)) => Err(format!("erro de I/O em which: {e}")),
        Err(_) => Err("timeout em which".into()),
    }
}

#[tauri::command]
pub async fn install_dependency(name: String) -> Result<String, String> {
    if !is_safe_name(&name) {
        return Err(format!("nome inválido: `{name}`"));
    }

    let child = Command::new("brew")
        .arg("install")
        .arg(&name)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if let std::io::ErrorKind::NotFound = e.kind() {
                "`brew` não encontrado no PATH. Instalar manualmente ou adicionar \
                 suporte a apt/winget em versões futuras."
                    .to_string()
            } else {
                format!("falha ao executar brew: {e}")
            }
        })?;

    let output = match timeout(
        Duration::from_secs(INSTALL_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("erro de I/O em brew: {e}")),
        Err(_) => return Err(format!("timeout ({INSTALL_TIMEOUT_SECS}s) em brew install")),
    };

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

    if output.status.success() {
        Ok(if stdout.is_empty() {
            format!("{name} instalado.")
        } else {
            stdout
        })
    } else {
        Err(if stderr.is_empty() {
            format!("brew install {name} falhou (exit {:?}).", output.status.code())
        } else {
            stderr
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_safe_name_accepts_simple_names() {
        assert!(is_safe_name("ffmpeg"));
        assert!(is_safe_name("node_modules"));
        assert!(is_safe_name("clang-format"));
        assert!(is_safe_name("gcc14"));
        assert!(is_safe_name("g++"));
        assert!(is_safe_name("python3.11"));
    }

    #[test]
    fn is_safe_name_rejects_shell_metachars() {
        assert!(!is_safe_name(""));
        assert!(!is_safe_name("foo; rm -rf /"));
        assert!(!is_safe_name("$(malicious)"));
        assert!(!is_safe_name("foo bar"));
        assert!(!is_safe_name("../evil"));
        assert!(!is_safe_name("foo|bar"));
        assert!(!is_safe_name("foo`cmd`"));
    }

    #[test]
    fn is_safe_name_enforces_length_limit() {
        let long = "a".repeat(65);
        assert!(!is_safe_name(&long));
        let ok = "a".repeat(64);
        assert!(is_safe_name(&ok));
    }
}
