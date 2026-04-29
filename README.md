# Genesis

Desktop skill orchestrator for Claude Code + bash + APIs, coordinated by GPT-4o.

Write a skill once as a Markdown file — Genesis parses it, dispatches each step
to the right channel (`claude-code`, `bash`, or `api`), validates output, and
streams progress back to the chat UI in real time.

## Installation

### macOS

1. Download **Genesis.dmg** from Releases.
2. Open the `.dmg` and drag **Genesis** into **Applications**.
3. Launch Genesis. The unified 5-step onboarding will guide you:
   - **Step 1** — Welcome
   - **Step 2** — Paste your OpenAI API key; click **Testar** to verify
   - **Step 3** — Perfil: name + company (vai pro system prompt)
   - **Step 4** — Documentos: upload `.md` opcionais sobre seu trabalho
   - **Step 5** — Resumo gerado por GPT + botão "Começar"

Configuration lives in `~/.genesis/`:

| File | Purpose |
|------|---------|
| `config.toml` | OpenAI API key + skills directory |
| `genesis.db` | SQLite: caminhos (folder bookmarks), capabilities, executions, chat |
| `skills/<nome>/SKILL.md` | Skill v2 (folder layout). v1 `.md` solto ainda lê. |

## Using Genesis

The chat input supports three trigger characters:

- **`/<skill>`** at start-of-input — slash command. Autocomplete pops up
  with every skill in your `skills/` dir. `/criar-sistema` previews the
  steps, asks you to pick a caminho ativo, then dispatches the executor.
- **`@<capability>`** anywhere mid-text — mention a capability (built-in
  or connector). Examples: `@terminal`, `@code`. The backend injects the
  capability's `doc_ai` snippet into the system prompt for that turn.
- **`#<caminho>`** anywhere mid-text — mention a registered folder
  (caminho). The backend resolves to `repo_path` and uses it as `cwd`
  for any commands the turn dispatches.

Examples:

```
/legendar-videos
@terminal extrai o áudio dos vídeos em #raw-uploads
@code refatora o módulo X em #frontend e roda npm test em @terminal
```

Inline ⏳/✅/❌ status messages stream into the chat as the executor runs;
pause/abort controls appear in a thin bar above the input while a skill
is active.

### Skill v2 layout (folder)

```
~/.genesis/skills/legendar-videos/
├── SKILL.md             # entry point obrigatório
├── references/          # opcional — cheat-sheets que o modelo lê sob demanda
│   └── api-limits.md
├── scripts/             # opcional — scripts shell (chmod 755 auto)
│   └── extract.sh
└── assets/              # opcional — templates / dados
```

`SKILL.md` example:

```markdown
---
name: legendar-videos
description: Gera legendas .srt de qualquer vídeo via Whisper API
version: "2.0"
author: maria
triggers: [legendar, subtítulo]
---

# Quando usar
Pra qualquer vídeo MP4/MOV/MKV — gera SRT na mesma pasta.

# Pré-requisitos
- @terminal pra ffmpeg
- Whisper API key em ~/.genesis/config.toml

# Etapas

## extract-audio
Use @terminal pra rodar `scripts/extract.sh {{input}}`. Se o áudio
passar de 25MB, divida em chunks (ver references/api-limits.md).

## transcribe
Manda o MP3 pra Whisper API e salva o `.srt` ao lado do vídeo.

# Outputs
- `<video>.srt`
```

V2 etapas são **prosa** (não DSL). O modelo traduz `Use @terminal pra ...`
em tool calls em runtime. Spec completa: [`docs/skill-format-v2.md`](docs/skill-format-v2.md).

Pra criar uma skill nova: `/criar-skill` no chat ativa o agente de autoria
que conduz em 6 etapas (entender, pesquisar, propor, construir,
apresentar, validar). Skills v1 (`.md` solto na raiz do `skills_dir`)
continuam sendo lidas como fallback.

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
  orchestrator/     # skill_parser (v1+v2 detection), skill_loader_v2 (folder),
                    # variable_resolver, executor (@-cap + #-caminho resolution)
  channels/         # bash / claude-code / api dispatchers (tokio subprocesses)
  commands/         # caminhos, capabilities, chat, skills, execution, conversations
  db/               # sqlx + SQLite (WAL); migrations 001-007 (capabilities table)
  ai/               # OpenAI client (function-calling loop) + prompts
                    #   (CORE/USER_CONTEXT/SYSTEM_STATE/CAPABILITIES/REASONING/
                    #    SKILLS_V2/CAMINHOS/RULES/PROMPT_SKILL_AGENT)
src/                # React 19 + Tailwind 3 + Zustand
  components/       # chat, caminhos, capabilities, skills, onboarding, settings, workflows
  lib/tauri-bridge  # typed invoke() wrappers — never call @tauri-apps/api directly
  stores/           # appStore, executionStore, chatStore, capabilitiesStore, caminhosStore
```

Commands registered at `src-tauri/src/lib.rs` are the stable IPC contract;
the frontend touches them only through `src/lib/tauri-bridge.ts`. Skills
v2 reads use plugin-fs from the frontend (`SkillViewerV2`) — adjust
capability scope in `src-tauri/capabilities/default.json` if needed.

## License

TBD.
