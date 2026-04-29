# Architecture — Genesis

App desktop local Tauri 2.x. Rust backend orquestra subprocessos (bash,
Claude Code CLI, HTTP) coordenados por GPT-4o; frontend React renderiza
chat + tela de capabilities/caminhos/skills + onboarding.

## Diretórios

```
genesis/
├── src-tauri/           # Rust backend + entry point Tauri
│   ├── src/
│   │   ├── lib.rs           # invoke_handler, setup, plugin registration
│   │   ├── config.rs        # ~/.genesis/config.toml
│   │   ├── ai/              # OpenAI client (function calling) + prompts modulares
│   │   ├── channels/        # bash, claude-code, api, terminal (PTY)
│   │   ├── commands/        # Tauri IPC handlers (1 módulo por feature)
│   │   ├── db/              # sqlx + SQLite (WAL), models, queries
│   │   └── orchestrator/    # skill_parser, skill_loader_v2, executor, validator
│   ├── migrations/      # 001-007 SQL idempotente
│   └── capabilities/    # Tauri capability/permissions (fs, dialog, shell, sql)
├── src/                 # React 19 + Tailwind 3 + Zustand + Vite
│   ├── App.tsx              # rotas + ErrorBoundary + onboarding gate
│   ├── components/
│   │   ├── caminhos/        # CaminhoList, CaminhoDetail, NewCaminhoForm
│   │   ├── capabilities/    # CapabilityList, CapabilityDetail
│   │   ├── chat/            # ChatPanel, CommandInput, MessageBubble,
│   │   │                    # ExecutionStatusMessage, ExecutionControlBar,
│   │   │                    # CaminhoSelector, ModelSelector,
│   │   │                    # SlashCommandModal, AtCommandModal, HashCommandModal
│   │   ├── layout/          # MainLayout, Sidebar
│   │   ├── onboarding/      # OnboardingPage (5 steps unificados)
│   │   ├── settings/        # SettingsPage, KnowledgeSection
│   │   ├── skills/          # SkillEditor (v1), SkillViewerV2 (v2 read-only)
│   │   └── workflows/       # WorkflowList, WorkflowEditor, WorkflowViewer
│   ├── hooks/               # useTauriEvent, useExecution, useThinking, etc.
│   ├── lib/
│   │   └── tauri-bridge.ts  # único ponto de invoke() — components NÃO chamam direto
│   ├── stores/              # Zustand: appStore, chatStore, executionStore,
│   │                        # capabilitiesStore, caminhosStore, skillsStore
│   └── types/               # skill, project (= caminho alias), capability,
│                            # chat, events
├── docs/                # PRD, architecture, ux-flows, skill-format-v2
├── system-prompt-genesis.md # Source-of-truth do system prompt
├── skills/              # Skills v2 (pastas) + v1 (.md) embarcadas pra dev
└── CLAUDE.md
```

## Comunicação WebView ↔ Rust

```
React component
   │ invoke("send_chat_message", args)  via lib/tauri-bridge.ts
   ▼
Tauri IPC bridge (auto camelCase ↔ snake_case)
   │
   ▼
Rust #[tauri::command] em src-tauri/src/commands/*.rs
   │
   ├─ SQLite (sqlx, WAL)
   ├─ Subprocess (tokio::process)
   └─ HTTP (reqwest)
```

**Eventos (backend → frontend):** `app.emit("execution:step_started", payload)`
streamados via `useTauriEvent("execution:step_started", handler)`. Tipos
em `src/types/events.ts`.

## Padrões críticos

### Bridge tipada
Todo IPC passa por `src/lib/tauri-bridge.ts` com tipos em `src/types/`.
Components nunca chamam `@tauri-apps/api` direto (regra CLAUDE.md §4).

### Channels (Rust)
Trait `Channel` com `execute(input) -> Result<ChannelOutput>`. Dispatch
via `channel_for(tool)` — bash/claude-code/api. Capability rows do DB
hopam um nível de indireção: `@terminal` → channel `bash`.

### Skills v1 vs v2 (loader)
`skill_loader_v2.rs` detecta `.md` solto (v1) ou pasta com `SKILL.md`
(v2). Pasta vence durante coexistência. `skill_parser.rs` tolera ambos
formatos no frontmatter (`version: "1.0"` vs `"2.0"`).

### System prompt composição
`prompts.rs::build_system_prompt(...)` agrupa em ordem:
1. CORE (identidade)
2. USER_CONTEXT (substitui `{{user_name}}` etc.)
3. SYSTEM_STATE (snapshot DB: caminho ativo, skills, execução em vôo)
4. CAPABILITIES (lista DB-backed via `build_capabilities_prompt`)
5. REASONING
6. SKILLS_V2 (formato pasta + etapas em prosa)
7. TOOLS (bash/claude-code/api channels)
8. CAMINHOS (#-mention)
9. RULES

`chat.rs::send_chat_message` adiciona seções dinâmicas no fim:
- `## Skills disponíveis` (with_skill_catalog)
- `## Capabilities mencionadas` (extract_at_mentions + format_mentions_block)
- `## Caminhos mencionados` (extract_hash_mentions)
- `PROMPT_SKILL_AGENT` (quando `/criar-skill` ou natural triggers)

### Execução de skill
`execute_skill(skill_name, project_id, conversation_id)` insere row em
`executions`, spawn task. `Executor::run` itera steps:
1. Resolve channel via `resolve_channel_for_step` — capability lookup
   primeiro, fallback `channel_for(tool)`.
2. Resolve cwd via `resolve_cwd_for_step` — primeiro `#caminho` no
   command sobrescreve project-level cwd.
3. variable_resolver substitui `{{repo_path}}`, etc.
4. Channel.execute → emit `execution:step_started/completed/failed`.
5. useExecution hook persiste cada event como `chat_messages.kind =
   "execution-status"`. step_failed também dispara `analyze_step_failure`
   pra GPT diagnosticar.

## ADRs implícitos

- **Tauri 2.x** — bundle nativo (~10MB) vs Electron, plugin-fs/dialog/sql
  prontos.
- **SQLite WAL** — único processo escreve, leituras concorrentes ok.
- **Zustand** — stores leves, sem context API.
- **shadcn/ui + CSS variables** — design tokens em design-system.css,
  tema gold default.
- **Function calling no chat** — OpenAI tool use loop com 7 tools
  (execute_skill, list_skills, read_skill, save_skill, read_file,
  list_files, abort_execution). Loop até 10 iterações por turn.
- **Triple prefix** (/, @, #) — slash command (start-of-input only),
  @capability (qualquer posição), #caminho (qualquer posição). Boundary
  check `(?:^|\s)` evita falso positivo (email@host, issue#123).
