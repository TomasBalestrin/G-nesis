//! Claude Code CLI channel.
//!
//! Spawns `claude -p "<prompt>" --output-format json --allowedTools "Bash,Read,Edit"`
//! conforme docs/security.md §3. cwd = input.cwd (tipicamente o repo_path do
//! projeto). Timeout default 300s; `kill_on_drop(true)` garante que timeout
//! mata o processo. O stdout é parseado como JSON e reduzido a `result`
//! (ou `error` se `is_error: true`); stdout não-JSON volta raw (resiliente a
//! mudanças de schema, docs/PRD.md §8).
//!
//! Context files: se `input.context_files` não vazio, o prompt ganha um
//! bloco `# Arquivos de contexto` listando os paths — Claude usa o tool
//! Read pra abri-los sob demanda, em vez de carregarmos conteúdo gigante no
//! argv.

use std::io::ErrorKind;
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use tokio::process::Command;
use tokio::time::timeout;

use crate::channels::{
    Channel, ChannelError, ChannelInput, ChannelOutput, DEFAULT_TIMEOUT_SECS,
};

const CLAUDE_BIN: &str = "claude";
const ALLOWED_TOOLS: &str = "Bash,Read,Edit";

#[derive(Debug, Deserialize)]
struct ClaudeJsonOutput {
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    is_error: Option<bool>,
    #[serde(default)]
    error: Option<String>,
}

pub struct ClaudeCodeChannel;

impl ClaudeCodeChannel {
    pub fn new() -> Self {
        Self
    }

    fn build_prompt(input: &ChannelInput) -> String {
        if input.context_files.is_empty() {
            return input.command.clone();
        }
        let mut prompt = String::with_capacity(input.command.len() + 128);
        prompt.push_str("# Arquivos de contexto\n");
        prompt.push_str(
            "Use o tool Read para consultar os arquivos abaixo conforme necessário:\n\n",
        );
        for path in &input.context_files {
            prompt.push_str("- ");
            prompt.push_str(path);
            prompt.push('\n');
        }
        prompt.push_str("\n---\n\n");
        prompt.push_str(&input.command);
        prompt
    }
}

impl Default for ClaudeCodeChannel {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Channel for ClaudeCodeChannel {
    fn name(&self) -> &'static str {
        "claude-code"
    }

    async fn execute(&self, input: ChannelInput) -> Result<ChannelOutput, ChannelError> {
        let prompt = Self::build_prompt(&input);

        let mut cmd = Command::new(CLAUDE_BIN);
        cmd.arg("-p")
            .arg(&prompt)
            .arg("--output-format")
            .arg("json")
            .arg("--allowedTools")
            .arg(ALLOWED_TOOLS)
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

        let child = cmd.spawn().map_err(|e| match e.kind() {
            ErrorKind::NotFound => ChannelError::Spawn(
                "`claude` CLI não encontrado no PATH. Instale com \
                 `npm install -g @anthropic-ai/claude-code`"
                    .into(),
            ),
            _ => ChannelError::Spawn(format!("claude: {e}")),
        })?;

        let timeout_secs = input.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);
        let output = match timeout(
            Duration::from_secs(timeout_secs),
            child.wait_with_output(),
        )
        .await
        {
            Ok(Ok(out)) => out,
            Ok(Err(e)) => return Err(ChannelError::Io(e.to_string())),
            Err(_elapsed) => return Err(ChannelError::Timeout),
        };

        let stdout_raw = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

        let stdout = match serde_json::from_str::<ClaudeJsonOutput>(stdout_raw.trim()) {
            Ok(parsed) if parsed.is_error.unwrap_or(false) => parsed
                .error
                .unwrap_or_else(|| "claude retornou is_error sem mensagem".into()),
            Ok(parsed) => parsed.result.unwrap_or_default(),
            // Schema drift / non-JSON output → bubble up raw stdout so the
            // validator can still inspect it.
            Err(_) => stdout_raw,
        };

        Ok(ChannelOutput {
            stdout,
            stderr,
            exit_code: output.status.code(),
            ..Default::default()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_prompt_passthrough_without_context() {
        let input = ChannelInput {
            command: "Explique o projeto".into(),
            ..Default::default()
        };
        assert_eq!(ClaudeCodeChannel::build_prompt(&input), "Explique o projeto");
    }

    #[test]
    fn build_prompt_prepends_context_block() {
        let input = ChannelInput {
            command: "Refatore o parser".into(),
            context_files: vec![
                "src/main.rs".into(),
                "docs/PRD.md".into(),
            ],
            ..Default::default()
        };
        let prompt = ClaudeCodeChannel::build_prompt(&input);
        assert!(prompt.starts_with("# Arquivos de contexto"));
        assert!(prompt.contains("- src/main.rs\n"));
        assert!(prompt.contains("- docs/PRD.md\n"));
        assert!(prompt.trim_end().ends_with("Refatore o parser"));
    }

    // Note: spawn/timeout behavior is covered by BashChannel's tests against
    // the same tokio::process pattern; we don't re-test it here because the
    // `claude` binary may or may not be on the dev machine's PATH (present
    // inside Claude Code sandbox, absent in clean CI). The build_prompt unit
    // tests cover what's unique to this channel.
}
