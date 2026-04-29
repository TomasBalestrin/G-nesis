//! Tauri IPC handlers for CLI dependency discovery + install.
//!
//! `check_dependency` looks for the binary in the common Homebrew locations
//! (`/opt/homebrew/bin` on Apple Silicon, `/usr/local/bin` on Intel) plus the
//! parent process PATH. macOS GUI apps inherit a minimal PATH from launchctl
//! (`/usr/bin:/bin:/usr/sbin:/sbin`) so anything installed via Homebrew is
//! invisible without these explicit lookups.
//!
//! `install_dependency` resolves `brew` itself the same way and runs
//! `brew install <name>` with an augmented PATH so brew's own helpers find
//! `git`, `curl`, etc.
//!
//! Name sanitisation keeps shell shenanigans out: only ASCII alphanumerics
//! plus `- _ . +` are accepted, so `$(rm -rf ~)` or `;curl …` never reach
//! `Command::new`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;
use tokio::time::timeout;

const INSTALL_TIMEOUT_SECS: u64 = 600;
const CHECK_TIMEOUT_SECS: u64 = 15;

/// Directories we always probe for installed CLIs, in priority order. Apple
/// Silicon Homebrew lives under `/opt/homebrew`; Intel under `/usr/local`.
const HOMEBREW_DIRS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
}

/// Returns the absolute path of `name` if it exists and is executable in any
/// of the Homebrew dirs or the inherited PATH. `None` means "not found".
fn locate_binary(name: &str) -> Option<PathBuf> {
    for dir in HOMEBREW_DIRS {
        let candidate = Path::new(dir).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    // Fallback to PATH lookup so anything the user has elsewhere (rbenv,
    // asdf, custom installs) still resolves.
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// PATH value passed to spawned children. Prepends Homebrew dirs so brew
/// helpers (`git`, `curl`, …) resolve even when the parent PATH is the
/// minimal launchctl default.
fn augmented_path() -> String {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = HOMEBREW_DIRS.iter().map(|s| (*s).to_string()).collect();
    if !inherited.is_empty() {
        parts.push(inherited);
    }
    parts.join(":")
}

#[tauri::command]
pub async fn check_dependency(name: String) -> Result<bool, String> {
    if !is_safe_name(&name) {
        return Err(format!("nome inválido: `{name}`"));
    }
    // Direct filesystem probe is faster (and more reliable in .app subprocesses)
    // than spawning `which`, which itself may not be on the inherited PATH.
    if locate_binary(&name).is_some() {
        return Ok(true);
    }
    // Belt-and-suspenders: also try `which` with the augmented PATH for
    // anything the static dir list missed.
    let child = Command::new("which")
        .arg(&name)
        .env("PATH", augmented_path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn();
    let Ok(child) = child else {
        return Ok(false);
    };
    match timeout(
        Duration::from_secs(CHECK_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(output)) => Ok(output.status.success()),
        // Spawning `which` failing is not the same as the binary being absent —
        // we already returned the negative path, so report false rather than err.
        Ok(Err(_)) => Ok(false),
        Err(_) => Err("timeout em which".into()),
    }
}

#[tauri::command]
pub async fn install_dependency(name: String) -> Result<String, String> {
    if !is_safe_name(&name) {
        return Err(format!("nome inválido: `{name}`"));
    }

    let brew = locate_binary("brew").ok_or_else(|| {
        "`brew` não encontrado em /opt/homebrew/bin nem /usr/local/bin. \
         Instale o Homebrew primeiro: https://brew.sh"
            .to_string()
    })?;

    let child = Command::new(&brew)
        .arg("install")
        .arg(&name)
        .env("PATH", augmented_path())
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("falha ao executar brew: {e}"))?;

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
            format!(
                "brew install {name} falhou (exit {:?}).",
                output.status.code()
            )
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

    #[test]
    fn augmented_path_includes_homebrew_first() {
        let path = augmented_path();
        let opt_idx = path.find("/opt/homebrew/bin");
        let usr_idx = path.find("/usr/local/bin");
        assert!(opt_idx.is_some());
        assert!(usr_idx.is_some());
        assert!(opt_idx.unwrap() < usr_idx.unwrap());
    }
}
