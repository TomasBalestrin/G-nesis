> ⚡ Thor | 30/04/2026 | v1.1

# CLAUDE.md — Genesis

App desktop local (Tauri 2.x) que orquestra skills via IA, delegando execução para Claude Code CLI, bash e APIs.

**Stack:** Tauri 2.x (Rust) + React 18 + TypeScript 5 strict + Vite + Tailwind 3 + shadcn/ui + SQLite + OpenAI GPT-4o + Zustand

---

## Comandos

```bash
# Dev (frontend + backend hot reload)
cargo tauri dev

# Build (binário nativo)
cargo tauri build

# Frontend only
npm run dev

# Rust check
cd src-tauri && cargo check

# Rust format
cd src-tauri && cargo fmt

# Rust lint
cd src-tauri && cargo clippy
```

---

## Estrutura

```
genesis/
├── src-tauri/src/          # Rust backend
│   ├── commands/           # Tauri IPC handlers
│   │   ├── caminhos.rs     # caminhos (renomeado projects surface)
│   │   ├── capabilities.rs # @-mention registry
│   │   ├── chat.rs         # send_chat_message, save_skill_folder, save_skill, mention helpers
│   │   ├── execution.rs    # execute_skill, abort, pause, resume
│   │   ├── skills.rs       # list/read/save/delete (v1 + v2 via skill_loader_v2)
│   │   └── ...
│   ├── orchestrator/       # Skill parser, executor, validator
│   │   ├── executor.rs     # @capability + #caminho resolution
│   │   ├── skill_loader_v2.rs # v2 folder loader, v1 fallback
│   │   └── skill_parser.rs # v1 + v2 frontmatter detection
│   ├── channels/           # Claude Code, bash, API
│   ├── ai/                 # OpenAI client + prompts (CORE/CAPABILITIES/SKILLS_V2/CAMINHOS/SYSTEM_STATE/PROMPT_SKILL_AGENT)
│   ├── db/                 # SQLite models + queries (capabilities, caminhos via projects table)
│   └── config.rs
├── src/                    # React frontend
│   ├── components/{layout,chat,caminhos,capabilities,skills,onboarding,settings,workflows,ui}/
│   ├── hooks/              # useTauriCommand, useTauriEvent, useExecution, useThinking
│   ├── stores/             # appStore, executionStore, chatStore, capabilitiesStore, caminhosStore, skillsStore
│   ├── lib/                # tauri-bridge.ts, utils.ts
│   └── types/              # skill.ts, project.ts (= caminho.ts alias), capability.ts, chat.ts, events.ts
├── skills/                 # Skills v2 (pastas <nome>/SKILL.md) + v1 (.md soltos legacy)
├── docs/                   # PRD, architecture, ux-flows, skill-format-v2
├── system-prompt-genesis.md # Source-of-truth do system prompt do orquestrador
└── CLAUDE.md
```

### Conceitos do surface

- **Capabilities** (`@nome`): ações invocáveis no chat — ex: `@terminal`, `@code`. Backend resolve cada `@` pra um `doc_ai` injetado no system prompt. Native (channel-backed) ou connector (config JSON).
- **Caminhos** (`#nome`): pastas locais cadastradas, refer cwd da execução. Substitui o termo legacy "projeto".
- **Skills** (`/nome`): procedimentos repetitivos. v2 = pasta com `SKILL.md` (entry point) + `references/` + `scripts/` + `assets/`. v1 = `.md` solto continua suportado.
- **Triple prefix**: `/` (start-of-input, slash command), `@` (qualquer posição, capability mention), `#` (qualquer posição, caminho mention) — extraídos do conteúdo da mensagem por `extract_*_mentions` em `chat.rs`.

---

## Protocolo de Execução

### §1 Pesquisar antes
Antes de criar/editar qualquer arquivo, ler arquivos similares existentes no projeto. Copiar padrões encontrados. Não inventar convenções novas.

### §2 Escopo fechado
Listar explicitamente CRIAR e EDITAR antes de começar. Não tocar em arquivos fora da lista.

### §3 Isolamento
1 componente = 1 arquivo ≤ 200 linhas. Lógica complexa vai para hooks/ ou stores/. Rust: 1 módulo = 1 responsabilidade.

### §4 Bridge tipada
Toda comunicação frontend↔Rust passa por `src/lib/tauri-bridge.ts` com tipos definidos em `src/types/`. Nunca invoke() direto em componentes.

### §5 Não quebrar
Após qualquer alteração: `cargo check` (Rust) + `npm run build` (frontend). Se editou types/interfaces, verificar todos os consumidores.

---

## Regras por Camada

### TypeScript (Frontend)
- strict mode, `@/` alias em tsconfig
- Sem `any` — tipar tudo
- Named exports (exceto entry points)
- Function declaration para componentes (não arrow)

### React
- SPA puro (Vite) — sem SSR, sem server components
- Zustand para estado global, React state para local
- React Hook Form + Zod para forms
- Sem useEffect para data fetching — usar hooks customizados sobre invoke()

### Rust (Backend Tauri)
- `#[tauri::command]` para IPC handlers em `commands/`
- `async` em tudo que é I/O (subprocess, HTTP, SQLite)
- `Result<T, GenesisError>` — nunca unwrap em prod
- `serde::{Serialize, Deserialize}` em todos os structs de IPC
- Trait `Channel` para canais de execução — dispatch via pattern match

### SQLite
- WAL mode + foreign_keys ON (pragmas no startup)
- Queries em `db/queries.rs` — nunca SQL inline em commands
- UUIDs como TEXT, timestamps como TEXT (ISO8601)
- Migrations executam no startup via init_db()

### Estilo
- Tailwind only — zero CSS modules, zero inline styles complexos
- shadcn/ui como base de componentes, mas com overrides do **Elite Premium** (ver §Design System abaixo)
- Tokens (cores, tipografia, radii, spacing) consumidos via CSS variables — **fonte de verdade em `DESIGN.md`**
- Dark mode default

### State
- Zustand: estado global (execução ativa, chat, sidebar, tema)
- React state: estado efêmero (inputs, modais, toggles)
- SQLite: persistência durável (projetos, histórico)
- Events Tauri: streaming (logs, progresso em tempo real)

---

## Design System — Elite Premium

Sistema visual usado em todas as superfícies do app. Estética minimalista de luxo discreto: zero brilho, zero sombra, gold contido como único acento.

**Fontes de verdade**:
- `DESIGN.md` — tokens (cores, tipografia, radii, spacing, motion). **Source-of-truth**.
- `design system.html` — referência visual renderizável (abrir no browser pra ver os componentes em vivo).

**Regra obrigatória**: ANTES de criar ou editar qualquer componente visual (TSX, Tailwind class, CSS), **leia `DESIGN.md`**. Se um token não cobre o caso, abrir issue/discussão antes de inventar — nunca fazer one-off.

**Constraints resumidas (não exaustivo — DESIGN.md tem o spec completo)**:
- ❌ **Sem shadows**, sem `box-shadow`, sem elevações por sombra
- ❌ **Sem glow** / outer-glow / drop-shadow neon
- ❌ **Sem gradientes** — cores chapadas; backgrounds sólidos
- ✅ **Gold `#B59A5B`** é o ÚNICO accent permitido (links ativos, focus ring, badges destacados)
- ✅ **Ícones outline 1.5px** (lucide com `strokeWidth={1.5}`) — sem ícones filled
- ✅ **Inputs / cards `border-radius: 20px`** (radius médio); botões pequenos podem ser menores
- ✅ **Lora** apenas em headlines (`<h1>`/`<h2>`); body copy em sans default
- ✅ **Body ≤ 15px** — leitura confortável sem sobrecarregar a hierarquia

Se um componente precisa fugir das constraints (ex: feedback toast com cor crítica vermelha), documentar no PR com link pra rule do DESIGN.md que justifica a exceção.

---

## NÃO Fazer

- `any` em TypeScript
- useEffect para fetch/data
- Arquivo > 200 linhas
- unwrap() em Rust (usar `?` ou handle)
- SQL inline fora de queries.rs
- invoke() direto em componentes (usar tauri-bridge.ts)
- Shell string interpolation para subprocessos (usar args array)
- Commitar .env, API keys, config.toml com secrets
- Console.log em prod (usar tracing no Rust)
- Editar fora do escopo declarado
- Refatorar sem pedir
- Inventar padrão novo — copiar existente

---

## Docs Disponíveis

- `DESIGN.md` — tokens do Elite Premium (cores, tipografia, radii, motion). **Ler antes de mexer em UI.**
- `design system.html` — referência visual renderizável (abre no browser pra inspecionar componentes em vivo)
- `docs/PRD.md` — features, modelo de dados, comandos Tauri, integrações
- `docs/architecture.md` — diretórios, comunicação WebView↔Rust, patterns
- `docs/ux-flows.md` — rotas, navegação, fluxos
- `docs/skill-format-v2.md` — spec da pasta v2 (SKILL.md + references/scripts/assets)
- `system-prompt-genesis.md` — source-of-truth do system prompt
