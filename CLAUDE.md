> ⚡ Thor | 21/04/2026 | v1.0

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
│   ├── orchestrator/       # Skill parser, executor, validator
│   ├── channels/           # Claude Code, bash, API
│   ├── ai/                 # OpenAI client
│   ├── db/                 # SQLite models + queries
│   └── config.rs
├── src/                    # React frontend
│   ├── components/{layout,chat,skills,progress,projects,ui}/
│   ├── hooks/              # useTauriCommand, useTauriEvent, useExecution, useChat
│   ├── stores/             # appStore, executionStore, chatStore (Zustand)
│   ├── lib/                # tauri-bridge.ts, utils.ts
│   └── types/              # skill.ts, project.ts, chat.ts, events.ts
├── skills/                 # Skills .md
└── CLAUDE.md
```

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
- shadcn/ui para componentes base
- CSS variables para tema (design system do usuário)
- Dark mode default

### State
- Zustand: estado global (execução ativa, chat, sidebar, tema)
- React state: estado efêmero (inputs, modais, toggles)
- SQLite: persistência durável (projetos, histórico)
- Events Tauri: streaming (logs, progresso em tempo real)

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

- `docs/PRD.md` — features, modelo de dados, comandos Tauri, integrações
- `docs/tech-stack.md` — stack completo, pacotes, ADRs
- `docs/architecture.md` — diretórios, comunicação WebView↔Rust, patterns
- `docs/schema.md` — SQLite schema, triggers, Rust structs
- `docs/security.md` — API keys, subprocessos, filesystem
- `docs/ux-flows.md` — rotas, navegação, fluxos, responsividade
- `docs/TASKS.md` — tasks de implementação
