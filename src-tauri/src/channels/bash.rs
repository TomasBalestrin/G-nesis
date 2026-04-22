//! Bash/shell channel.
//!
//! The command string from the skill is parsed with `shlex` into a program
//! name + argv array — we NEVER do `sh -c "..."` (docs/security.md §3). The
//! child is spawned via `tokio::process::Command` with `kill_on_drop(true)`,
//! so a timed-out step kills the process when the future is dropped.

use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use tokio::process::Command;
use tokio::time::timeout;

use crate::channels::{
    Channel, ChannelError, ChannelInput, ChannelOutput, DEFAULT_TIMEOUT_SECS,
};

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
        for (k, v) in &input.env {
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
