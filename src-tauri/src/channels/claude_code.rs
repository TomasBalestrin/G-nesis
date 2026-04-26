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
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use tokio::process::Command;
use tokio::time::timeout;

use crate::channels::bash::child_env_overrides;
use crate::channels::{
    Channel, ChannelError, ChannelInput, ChannelOutput, DEFAULT_TIMEOUT_SECS,
};
use crate::config;

const ALLOWED_TOOLS: &str = "Bash,Read,Edit";

/// Common install locations for the `claude` CLI, probed in this order
/// before falling back to PATH. Covers npm-global (Node managed by user),
/// Homebrew (Apple Silicon + Intel) and ~/.local/bin.
fn candidate_paths() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    vec![
        home.join(".npm-global/bin/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
        home.join(".local/bin/claude"),
    ]
}

/// Resolve the absolute path of the `claude` CLI. Order:
/// 1. `claude_cli_path` from config.toml (explicit user override)
/// 2. Well-known install dirs (`candidate_paths`)
/// 3. `which claude` against the inherited PATH
///
/// Returns a clear error pointing to install instructions when nothing
/// resolves — better than the generic `NotFound` we'd get from spawn.
fn resolve_claude_binary() -> Result<PathBuf, String> {
    if let Ok(cfg) = config::load_config() {
        if let Some(override_path) = cfg.claude_cli_path.filter(|p| !p.is_empty()) {
            let p = PathBuf::from(&override_path);
            if p.is_file() {
                return Ok(p);
            }
            return Err(format!(
                "claude_cli_path em config.toml aponta para `{override_path}` mas o arquivo \
                 não existe. Corrija o caminho ou remova o campo para usar a busca automática."
            ));
        }
    }

    for candidate in candidate_paths() {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("claude");
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Err(
        "`claude` CLI não encontrado. Instale com `npm install -g @anthropic-ai/claude-code` \
         ou defina `claude_cli_path` em ~/.genesis/config.toml apontando para o binário."
            .into(),
    )
}

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

        let claude_bin = resolve_claude_binary().map_err(ChannelError::Spawn)?;

        let mut cmd = Command::new(&claude_bin);
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
        // Same login-shell PATH lift as BashChannel — claude itself shells
        // out to git/npm/etc. and needs them resolvable.
        for (k, v) in child_env_overrides(&input.env) {
            cmd.env(k, v);
        }

        let child = cmd.spawn().map_err(|e| match e.kind() {
            ErrorKind::NotFound => ChannelError::Spawn(format!(
                "`claude` resolvido em {} mas spawn falhou (NotFound). Reinstale com \
                 `npm install -g @anthropic-ai/claude-code` ou ajuste claude_cli_path \
                 em ~/.genesis/config.toml.",
                claude_bin.display()
            )),
            _ => ChannelError::Spawn(format!("claude ({}): {e}", claude_bin.display())),
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
