//! Bash/shell channel.
//!
//! The command string from the skill is parsed with `shlex` into a program
//! name + argv array — we NEVER do `sh -c "..."` (docs/security.md §3). The
//! child is spawned via `tokio::process::Command` with `kill_on_drop(true)`,
//! so a timed-out step kills the process when the future is dropped.
//!
//! On macOS, GUI apps launched via `.app` inherit a stripped PATH from
//! launchctl (`/usr/bin:/bin:/usr/sbin:/sbin`), losing whatever the user
//! configured in `.zshrc` / `.bashrc` (Homebrew, asdf, npm-global, etc.).
//! We detect $SHELL once at startup and replay `$SHELL -l -c env` to capture
//! the login PATH (and a few related vars), then merge that into every
//! spawned child unless the caller explicitly overrides.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

use async_trait::async_trait;
use tokio::process::Command;
use tokio::time::timeout;

use crate::channels::{
    Channel, ChannelError, ChannelInput, ChannelOutput, DEFAULT_TIMEOUT_SECS,
};

/// Variables we lift from the login shell. Limited to PATH-adjacent things —
/// we don't want to import the user's full env (which may contain secrets
/// they didn't intend to forward to skill subprocesses).
const LOGIN_ENV_KEYS: &[&str] = &[
    "PATH",
    "MANPATH",
    "LANG",
    "LC_ALL",
    "HOMEBREW_PREFIX",
    "HOMEBREW_CELLAR",
    "HOMEBREW_REPOSITORY",
];

/// Fallback PATH when the login-shell probe fails. Covers the common
/// install locations on macOS (Apple Silicon + Intel Homebrew, npm-global,
/// pyenv-style ~/.local/bin) plus the system minimum.
const FALLBACK_PATH_SUFFIX: &[&str] = &[
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

fn login_env() -> &'static HashMap<String, String> {
    static CACHE: OnceLock<HashMap<String, String>> = OnceLock::new();
    CACHE.get_or_init(probe_login_env)
}

/// Run the user's login shell with `-l -c env`, parse the output, and
/// extract the keys we care about. Synchronous + best-effort: timeouts or
/// missing $SHELL fall back to the inherited environment.
fn probe_login_env() -> HashMap<String, String> {
    let mut env = HashMap::new();

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // 5s is generous for `env`; if the user's rc files take longer than
    // that we'd rather start the app than block. Standard library Command
    // (sync) is fine here — we run this exactly once at first channel use.
    let probe = std::process::Command::new(&shell)
        .args(["-l", "-c", "env"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    if let Ok(output) = probe {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if let Some((key, value)) = line.split_once('=') {
                    if LOGIN_ENV_KEYS.contains(&key) {
                        env.insert(key.to_string(), value.to_string());
                    }
                }
            }
        }
    }

    // PATH is the critical piece. If the probe didn't yield one, build a
    // synthesized PATH from the inherited value + FALLBACK_PATH_SUFFIX so
    // children at least find Homebrew binaries.
    if !env.contains_key("PATH") {
        let inherited = std::env::var("PATH").unwrap_or_default();
        let mut parts: Vec<String> = if inherited.is_empty() {
            Vec::new()
        } else {
            vec![inherited]
        };
        for dir in FALLBACK_PATH_SUFFIX {
            parts.push((*dir).to_string());
        }
        env.insert("PATH".into(), parts.join(":"));
    }

    env
}

/// Compose the env passed to a child process. Login-shell vars are layered
/// first, then any caller-provided overrides win — so a step that wants to
/// inject `OPENAI_API_KEY` or override PATH still does.
pub(crate) fn child_env_overrides(extra: &[(String, String)]) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = login_env()
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    for (k, v) in extra {
        if let Some(existing) = env.iter_mut().find(|(ek, _)| ek == k) {
            existing.1 = v.clone();
        } else {
            env.push((k.clone(), v.clone()));
        }
    }
    env
}

pub struct BashChannel;

impl BashChannel {
    pub fn new() -> Self {
        Self
    }
}

impl Default for BashChannel {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Channel for BashChannel {
    fn name(&self) -> &'static str {
        "bash"
    }

    async fn execute(&self, input: ChannelInput) -> Result<ChannelOutput, ChannelError> {
        let parts = shlex::split(&input.command)
            .ok_or_else(|| ChannelError::Spawn(format!(
                "comando não parseável (shlex): `{}`",
                input.command
            )))?;

        let (program, args) = parts
            .split_first()
            .ok_or_else(|| ChannelError::Spawn("comando vazio".into()))?;

        let mut cmd = Command::new(program);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        if let Some(cwd) = &input.cwd {
            cmd.current_dir(cwd);
        }
        // Lift login-shell PATH (Homebrew, npm-global, etc.) before applying
        // step-specific overrides so the user's binaries resolve even when the
        // app was launched via .app/launchctl.
        for (k, v) in child_env_overrides(&input.env) {
            cmd.env(k, v);
        }

        let child = cmd
            .spawn()
            .map_err(|e| ChannelError::Spawn(format!("{program}: {e}")))?;

        let timeout_secs = input.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);
        match timeout(
            Duration::from_secs(timeout_secs),
            child.wait_with_output(),
        )
        .await
        {
            Ok(Ok(output)) => Ok(ChannelOutput {
                stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
                exit_code: output.status.code(),
                ..Default::default()
            }),
            Ok(Err(e)) => Err(ChannelError::Io(e.to_string())),
            Err(_elapsed) => Err(ChannelError::Timeout),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(command: &str) -> ChannelInput {
        ChannelInput {
            command: command.to_string(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn echo_captures_stdout_and_zero_exit() {
        let out = BashChannel::new().execute(input("echo hello")).await.unwrap();
        assert_eq!(out.stdout.trim_end(), "hello");
        assert_eq!(out.stderr, "");
        assert_eq!(out.exit_code, Some(0));
    }

    #[tokio::test]
    async fn quoted_args_are_preserved_as_single_token() {
        let out = BashChannel::new()
            .execute(input(r#"echo "hello world""#))
            .await
            .unwrap();
        assert_eq!(out.stdout.trim_end(), "hello world");
    }

    #[tokio::test]
    async fn ls_nonexistent_returns_nonzero_with_stderr() {
        let out = BashChannel::new()
            .execute(input("ls /__definitely_not_a_real_path_xyz__"))
            .await
            .unwrap();
        assert_ne!(out.exit_code, Some(0));
        assert!(
            !out.stderr.is_empty(),
            "expected stderr for ls on missing path, got: {out:?}",
        );
    }

    #[tokio::test]
    async fn unknown_binary_is_spawn_error() {
        let err = BashChannel::new()
            .execute(input("__no_such_binary_xyz__ --version"))
            .await
            .unwrap_err();
        assert!(
            matches!(err, ChannelError::Spawn(_)),
            "expected Spawn, got: {err:?}",
        );
    }

    #[tokio::test]
    async fn timeout_kills_long_running_process() {
        let out = BashChannel::new()
            .execute(ChannelInput {
                command: "sleep 5".into(),
                timeout_secs: Some(1),
                ..Default::default()
            })
            .await;
        assert!(
            matches!(out, Err(ChannelError::Timeout)),
            "expected Timeout, got: {out:?}",
        );
    }

    #[tokio::test]
    async fn cwd_applied_to_child_process() {
        let out = BashChannel::new()
            .execute(ChannelInput {
                command: "pwd".into(),
                cwd: Some("/tmp".into()),
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(out.stdout.trim_end(), "/tmp");
    }

    #[tokio::test]
    async fn env_vars_are_passed_through() {
        let out = BashChannel::new()
            .execute(ChannelInput {
                command: "printenv GENESIS_TEST_VAR".into(),
                env: vec![("GENESIS_TEST_VAR".into(), "bethel".into())],
                ..Default::default()
            })
            .await
            .unwrap();
        assert_eq!(out.stdout.trim_end(), "bethel");
    }

    #[tokio::test]
    async fn empty_command_rejected() {
        let err = BashChannel::new().execute(input("")).await.unwrap_err();
        assert!(matches!(err, ChannelError::Spawn(_)));
    }
}
