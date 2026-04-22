> 👁️ Visão | 21/04/2026 | v1.0

# Tech Stack — Genesis

---

## 1. Visão Geral

```
┌─────────────────────────────────────────────────┐
│                  Tauri 2.x App                  │
│  ┌──────────────┐     ┌──────────────────────┐  │
│  │   WebView     │◄───►│   Rust Backend       │  │
│  │  React + TS   │ IPC │  Orchestrator        │  │
│  │  Tailwind     │     │  SQLite              │  │
│  │  shadcn/ui    │     │  Channels            │  │
│  └──────────────┘     └─────────┬────────────┘  │
└──────────────────────────────────┼───────────────┘
                                   │ subprocess / HTTP
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              Claude Code CLI   Bash/Shell    OpenAI API
              (claude -p)       (git,npm...)  (GPT-4o)
```

---

## 2. Core Stack

| Camada | Tecnologia | Versão | Justificativa |
|--------|-----------|--------|---------------|
| **Desktop runtime** | Tauri | 2.x | App nativo leve (~10MB), acesso a filesystem e processos, Rust backend performático |
| **Frontend** | React | 18+ | Ecossistema familiar, componentes reutilizáveis |
| **Linguagem frontend** | TypeScript | 5 strict | Type safety, DX |
| **Estilização** | Tailwind CSS | 3.x | Utility-first, consistente com ecossistema Bethel |
| **Componentes UI** | shadcn/ui | latest | Componentes acessíveis, customizáveis, sem runtime |
| **Linguagem backend** | Rust | stable | Requerido pelo Tauri, performance, segurança de memória |
| **Banco de dados** | SQLite | via tauri-plugin-sql | Persistência local, zero config, embedded |
| **IA orquestradora** | OpenAI API (GPT-4o) | latest | Lê skills, gerencia fluxo, valida resultados |
| **Execução primária** | Claude Code CLI | latest | Recebe prompts e executa no codebase |
| **Build tool** | Vite | 5.x | Bundler rápido, HMR, integração Tauri nativa |

---

## 3. Frontend (WebView)

### Estilização
- **Tailwind only** — zero CSS Modules, zero styled-components
- CSS variables para tema (dark mode default, design system do usuário)
- shadcn/ui como base de componentes (Button, Input, Card, Dialog, Toast, Tabs, ScrollArea, etc.)

### State Management
- **Zustand** — estado global da UI (sidebar, tema, execução ativa, chat messages)
- **React state** — estado local de componentes
- **Nenhum TanStack Query** — não há server state HTTP; dados vêm via Tauri commands (invoke)

### Formulários e Validação
- **React Hook Form + Zod** — forms de criação de projeto, edição de skill
- Zod para validar inputs antes de enviar ao Rust backend

### Markdown Rendering
- **react-markdown + remark-gfm** — renderizar mensagens do chat e preview de skills
- **highlight.js** ou **prism** — syntax highlight em blocos de código

### Comunicação com Backend
- `@tauri-apps/api` — invoke commands, listen to events
- Todos os dados passam por Tauri Commands (IPC), não HTTP
- Eventos Tauri para streaming de progresso (backend → frontend)

---

## 4. Backend (Rust / Tauri)

### Orquestrador
- Módulo Rust que parseia skills .md, resolve variáveis, executa steps
- Máquina de estados por execução: Idle → Running → Step(N) → Completed/Failed/Aborted
- Despacho multi-canal via trait Channel (impl para ClaudeCode, Bash, Api)

### Canais de Execução
- **ClaudeCode:** `std::process::Command` → `claude -p "prompt" --output-format json --allowedTools "Bash,Read,Edit"`
- **Bash:** `std::process::Command` → shell direto, captura stdout/stderr/exit_code
- **Api:** `reqwest` → HTTP requests configuráveis

### SQLite
- Via `tauri-plugin-sql` (SQLite embedded)
- WAL mode para concorrência
- Migrations em Rust (executam no startup)

### OpenAI
- Via `reqwest` direto no Rust
- API key lida de variável de ambiente ou config local
- Retry com backoff exponencial (3 tentativas)

---

## 5. Pacotes Frontend

| Pacote | Versão | Propósito |
|--------|--------|-----------|
| `@tauri-apps/api` | 2.x | Bridge JS↔Rust |
| `@tauri-apps/plugin-shell` | 2.x | Acesso a subprocessos via frontend (se necessário) |
| `react` | 18+ | UI framework |
| `react-dom` | 18+ | DOM rendering |
| `typescript` | 5+ | Type safety |
| `tailwindcss` | 3.x | Estilização |
| `zustand` | 4+ | State management |
| `react-hook-form` | 7+ | Forms |
| `zod` | 3+ | Validação |
| `react-markdown` | 9+ | Renderizar markdown no chat |
| `remark-gfm` | 4+ | Suporte a GFM (tabelas, checklists) |
| `lucide-react` | latest | Ícones |

### Crates Rust

| Crate | Propósito |
|-------|-----------|
| `tauri` | Framework desktop |
| `tauri-plugin-sql` | SQLite embedded |
| `tauri-plugin-shell` | Subprocessos (Claude CLI, bash) |
| `tauri-plugin-fs` | Acesso ao filesystem |
| `tauri-plugin-notification` | Notificações desktop (futuro) |
| `reqwest` | HTTP client (OpenAI API, canal api) |
| `serde` / `serde_json` | Serialização JSON |
| `tokio` | Async runtime |
| `uuid` | Geração de UUIDs |
| `chrono` | Timestamps |
| `pulldown-cmark` | Parser de markdown (skills) |
| `regex` | Resolução de variáveis {{...}} |

---

## 6. Infra

### Environments
- **Dev:** `cargo tauri dev` (hot reload frontend + Rust rebuild)
- **Build:** `cargo tauri build` (binário nativo)
- Sem staging/prod — app local

### Configuração
- `.env` local com `OPENAI_API_KEY`
- Config file (`~/.genesis/config.toml`) para: skills_dir, default_project, theme
- CLI args para override

### Dados
- SQLite em `~/.genesis/genesis.db`
- Skills em diretório configurável (default: `~/.genesis/skills/`)
- Logs em `~/.genesis/logs/`

---

## 7. Responsividade

App desktop — janela redimensionável com layout responsivo:

| Breakpoint | Layout |
|------------|--------|
| < 800px | Sidebar colapsa, chat fullwidth |
| 800-1200px | Sidebar narrow + chat |
| > 1200px | Sidebar + chat + progress side panel |

---

## 8. ADRs

### ADR-001: Tauri em vez de Electron
- **Contexto:** Precisa de acesso nativo (filesystem, subprocessos) em app desktop
- **Alternativa:** Electron (Node.js + Chromium)
- **Decisão:** Tauri — binário ~10x menor, memória ~5x menor, Rust backend nativo
- **Consequência:** Precisa de conhecimento Rust para backend; ecossistema menor que Electron

### ADR-002: GPT-4o como orquestrador (não Claude)
- **Contexto:** Claude Code CLI já é usado como executor. Usar Claude como orquestrador criaria conflito (orquestrador chamando a si mesmo)
- **Decisão:** OpenAI GPT-4o como cérebro da Camada 1
- **Consequência:** Duas API keys necessárias (OpenAI + Claude já instalado). Custo adicional de API OpenAI

### ADR-003: SQLite em vez de arquivo JSON
- **Contexto:** Precisa persistir projetos, execuções, histórico de chat
- **Alternativa:** Arquivos JSON no filesystem
- **Decisão:** SQLite — queries, concorrência, integridade, migrations
- **Consequência:** Dependência de tauri-plugin-sql; overhead mínimo

### ADR-004: Skills como arquivos .md (não DB)
- **Contexto:** Skills precisam ser versionáveis, editáveis, compartilháveis
- **Decisão:** Filesystem (.md) — git-friendly, editável em qualquer editor
- **Consequência:** Parser de markdown necessário no Rust; sem queries SQL em skills

### ADR-005: Vite em vez de Next.js
- **Contexto:** Frontend roda em WebView do Tauri, não em servidor
- **Decisão:** Vite — bundler puro, sem SSR desnecessário, integração nativa com Tauri
- **Consequência:** Sem App Router, sem server components. SPA puro com client-side routing

---

## NÃO usar

- Next.js (não há servidor web)
- Supabase (tudo local)
- Vercel (não há deploy)
- Redux (Zustand é suficiente)
- Axios (reqwest no Rust, fetch no frontend via Tauri)
- Firebase (desnecessário)
- CSS Modules (Tailwind only)
- Pages Router (não há Next.js)
- Electron (Tauri escolhido)
