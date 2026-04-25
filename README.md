# Genesis

Desktop skill orchestrator for Claude Code + bash + APIs, coordinated by GPT-4o.

Write a skill once as a Markdown file — Genesis parses it, dispatches each step
to the right channel (`claude-code`, `bash`, or `api`), validates output, and
streams progress back to the chat UI in real time.

## Installation

### macOS

1. Download **Genesis.dmg** from Releases.
2. Open the `.dmg` and drag **Genesis** into **Applications**.
3. Launch Genesis. The setup wizard will guide you through:
   - **Step 1** — Welcome
   - **Step 2** — Paste your OpenAI API key; click **Testar** to verify
   - **Step 3** — Check optional dependencies (`ffmpeg`, `claude` CLI); install
     with one click (Homebrew) or copy the suggested command
   - **Step 4** — Done — jump into the chat

Configuration lives in `~/.genesis/`:

| File | Purpose |
|------|---------|
| `config.toml` | OpenAI API key + skills directory |
| `genesis.db` | SQLite: projects, executions, chat history, conversations |
| `skills/*.md` | Your skill definitions |

## Using skills

In chat:

- Type `/` — autocomplete pops up with every skill in your `skills/` dir.
- Type `/criar-sistema` (or the name of any skill) and press **Enter**.
- Genesis previews the steps, asks you to pick a project, then kicks off
  execution. Pause / resume / abort buttons appear while it runs.
- Progress (per-step status, logs, duration) streams in the right pane at
  widths ≥ 1200px, or in the dedicated **Progress** view otherwise.

Skill file format (`skills/exemplo.md`):

```markdown
---
name: exemplo
description: O que a skill faz
version: "1.0"
author: Bethel
---
# Tools
- bash
# Inputs
- repo_path
# Steps
## step_1
tool: bash
command: find {{repo_path}} -name "*.mov"
validate: exit_code == 0
on_fail: retry 2
# Config
timeout: 300
```

See `skills/criar-sistema.md` and `skills/debug-sistema.md` in this repo for
full examples.

## Dev

Requirements:

- Node.js 20+
- Rust stable (`rustup install stable`)
- `cargo tauri` CLI (`cargo install tauri-cli`)
- On Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `libsoup-3.0-dev`,
  `libxdo-dev`, `libayatana-appindicator3-dev`

Clone + bootstrap:

```bash
git clone https://github.com/TomasBalestrin/G-nesis.git genesis
cd genesis
npm install
```

Run the dev shell (Vite HMR + Rust hot-reload):

```bash
cargo tauri dev
```

Build a release binary (writes to `src-tauri/target/release/bundle/`):

```bash
cargo tauri build
# macOS: dmg in bundle/dmg/ and .app in bundle/macos/
```

Run tests:

```bash
cd src-tauri
cargo test           # Rust unit + integration (skill_parser, validator, etc.)
cargo check
cd ..
npm run build        # tsc + vite strict build
```

### Environment

The OpenAI API key normally lives in `~/.genesis/config.toml` (written by the
Settings / wizard). For CI or one-off experiments you can also export:

```bash
export OPENAI_API_KEY=sk-...
export GENESIS_SKILLS_DIR=/path/to/skills   # optional override
```

The config file wins over env vars — editing Settings is always the source of
truth. Env only fills blanks.

### Architecture

```
src-tauri/          # Rust backend
  orchestrator/     # skill parser, variable resolver, state machine, validator
  channels/         # bash / claude-code / api dispatchers (tokio subprocesses)
  commands/         # Tauri IPC handlers exposed to the WebView
  db/               # sqlx + SQLite (WAL) schema & queries
  ai/               # OpenAI client with 3-retry backoff
src/                # React 19 + Tailwind 3 + Zustand
  components/       # chat, skills, layout, onboarding, settings, progress
  lib/tauri-bridge  # typed invoke() wrappers — never call @tauri-apps/api directly
  stores/           # Zustand stores
```

Commands registered at `src-tauri/src/lib.rs` are the stable IPC contract; the
frontend touches them only through `src/lib/tauri-bridge.ts`.

## License

TBD.
