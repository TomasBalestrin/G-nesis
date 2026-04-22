> 🐜 Homem-Formiga | 21/04/2026 | v1.0

# TASKS — Genesis

---

## Bloco A — Setup Tauri + Frontend

### A1 ⬜ 🟡Med — Inicializar projeto Tauri 2.x
CRIAR: projeto via `npm create tauri-app@latest` (React + TypeScript + Vite)
EDITAR: `tauri.conf.json` (título, identifier, window config)
LER: `docs/tech-stack.md`
NÃO TOCAR: N/A (projeto novo)
Steps:
1. `npm create tauri-app@latest genesis -- --template react-ts`
2. `cd genesis && npm install`
3. Configurar `tauri.conf.json`: título "Genesis", identifier "com.bethel.genesis", window 1200x800, resizable true
4. Adicionar crates no `Cargo.toml`: serde, serde_json, tokio (full), uuid, chrono, reqwest (json+rustls), regex, pulldown-cmark
5. Adicionar tauri plugins: `tauri-plugin-sql` (sqlite), `tauri-plugin-shell`, `tauri-plugin-fs`, `tauri-plugin-dialog`
6. `cargo tauri dev` — verificar janela abre com template default
Critério: `cargo tauri dev` abre janela sem erros, frontend renderiza

### A2 ⬜ 🟡Med — Configurar Tailwind + shadcn/ui + Design System
CRIAR: componentes shadcn via CLI
EDITAR: `tailwind.config.ts`, `src/styles/globals.css`, `index.html`
LER: `docs/tech-stack.md`, design system do usuário
NÃO TOCAR: `src-tauri/`, `Cargo.toml`
Steps:
1. Configurar Tailwind (já vem com template, ajustar config)
2. `npx shadcn@latest init` — configurar com Vite paths
3. `npx shadcn@latest add button input card dialog toast tabs scroll-area dropdown-menu separator badge`
4. Aplicar CSS variables do design system no globals.css (dark mode default)
5. Configurar `@/` alias no `tsconfig.json` e `vite.config.ts`
6. `npm run build` — verificar build ok
Critério: Componentes shadcn renderizam com tema correto no `cargo tauri dev`

### A3 ⬜ 🟢Low — Estrutura de diretórios frontend
CRIAR: `src/components/{layout,chat,skills,progress,projects}/`, `src/hooks/`, `src/stores/`, `src/lib/`, `src/types/`
EDITAR: nenhum
LER: `docs/architecture.md` (seção 1)
NÃO TOCAR: `src-tauri/`
Steps:
1. Criar todos os diretórios conforme architecture.md
2. Criar `src/types/skill.ts`, `project.ts`, `chat.ts`, `events.ts` com interfaces placeholder
3. Criar `src/lib/tauri-bridge.ts` e `src/lib/utils.ts` com exports vazios
4. Criar `src/stores/appStore.ts`, `executionStore.ts`, `chatStore.ts` com stores mínimos
5. `npm run build`
Critério: Estrutura de pastas existe, imports não quebram, build ok

### A4 ⬜ 🟡Med — Estrutura de módulos Rust
CRIAR: `src-tauri/src/{commands,orchestrator,channels,ai,db}/mod.rs` e arquivos filhos
EDITAR: `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`
LER: `docs/architecture.md` (seção 1), `docs/schema.md` (Rust structs)
NÃO TOCAR: frontend `src/`
Steps:
1. Criar módulos vazios: `commands/{mod,skills,projects,execution,chat}.rs`
2. `orchestrator/{mod,skill_parser,variable_resolver,executor,validator,state}.rs`
3. `channels/{mod,claude_code,bash,api}.rs`
4. `ai/{mod,client,prompts}.rs`, `db/{mod,models,queries}.rs`, `config.rs`
5. Registrar módulos em `lib.rs`, setup mínimo em `main.rs`
6. `cargo check` — zero erros
Critério: `cargo check` passa, todos os módulos declarados

### A5 ⬜ 🟡Med — SQLite setup + migrations
CRIAR: implementar `src-tauri/src/db/mod.rs`, `models.rs`, `queries.rs`
EDITAR: `src-tauri/src/main.rs` (registrar plugin sql, chamar init_db)
LER: `docs/schema.md` (SQL completo + Rust structs)
NÃO TOCAR: frontend, `orchestrator/`, `channels/`
Steps:
1. Copiar Rust structs de schema.md para `models.rs`
2. `init_db()`: pragmas (WAL, foreign_keys) + CREATE TABLE + triggers
3. Queries CRUD em `queries.rs` para cada entidade
4. Registrar plugin sql no main.rs, chamar init_db no setup
5. `cargo check` + `cargo tauri dev` — verificar DB criado
Critério: App inicia, DB criado em ~/.genesis/, tabelas existem

### A6 ⬜ 🟢Low — Config + API key management
CRIAR: implementar `src-tauri/src/config.rs`
EDITAR: `src-tauri/src/main.rs` (carregar config no startup)
LER: `docs/security.md` (API Keys)
NÃO TOCAR: `db/`, `orchestrator/`
Steps:
1. Struct Config: openai_api_key, skills_dir, db_path
2. Load de env vars com fallback para `~/.genesis/config.toml`
3. Flag `needs_setup` se API key ausente
4. Commands `get_config` e `save_config`
5. `cargo check`
Critério: Config carrega, commands retornam dados no frontend

---

## Bloco B — Layout + Navegação

### B1 ⬜ 🟡Med — Layout principal (Sidebar + Header + Content)
CRIAR: `src/components/layout/MainLayout.tsx`, `Sidebar.tsx`, `Header.tsx`, `StatusBar.tsx`
EDITAR: `src/App.tsx`
LER: `docs/ux-flows.md` (navegação), `docs/architecture.md`
NÃO TOCAR: `src-tauri/`
Steps:
1. `npm i react-router-dom`
2. MainLayout: grid sidebar (200px) + main content
3. Sidebar: itens Chat, Skills, Projetos, Progress com Lucide icons
4. Header: título + Settings
5. StatusBar: status da execução
6. React Router em App.tsx com rotas placeholder
7. Responsivo: sidebar colapsa < 800px
Critério: Layout renderiza, navegação funciona, responsivo

### B2 ⬜ 🟢Low — Zustand stores implementados
CRIAR: nenhum (implementar os criados em A3)
EDITAR: `src/stores/appStore.ts`, `executionStore.ts`, `chatStore.ts`
LER: `docs/architecture.md` (state layers), `src/types/`
NÃO TOCAR: `src-tauri/`, layout
Steps:
1. appStore: sidebarOpen, activeRoute, needsSetup
2. executionStore: activeExecution, steps, logs, métodos de update
3. chatStore: messages, addMessage, clearMessages
4. Tipar com interfaces de types/
5. `npm run build`
Critério: Stores com tipos corretos, build ok

---

## Bloco C — Chat Interface

### C1 ⬜ 🟡Med — ChatPanel + MessageBubble + CommandInput
CRIAR: `src/components/chat/ChatPanel.tsx`, `MessageBubble.tsx`, `CommandInput.tsx`
EDITAR: `src/App.tsx` (rota /)
LER: `docs/ux-flows.md` (Chat), `src/stores/chatStore.ts`
NÃO TOCAR: `src-tauri/`
Steps:
1. `npm i react-markdown remark-gfm`
2. ChatPanel: ScrollArea + MessageBubbles + CommandInput
3. MessageBubble: markdown render, estilo user vs assistant
4. CommandInput: Enter envia, Shift+Enter newline, detecta `/`
5. Auto-scroll, integrar chatStore
6. Mock response por enquanto
Critério: Chat renderiza, mensagens aparecem, `/comando` detectado

### C2 ⬜ 🔴High — Integração OpenAI (Rust backend)
CRIAR: `src-tauri/src/ai/client.rs`, `prompts.rs`
EDITAR: `src-tauri/src/commands/chat.rs`
LER: `docs/PRD.md` (integrações), `docs/security.md`, `config.rs`
NÃO TOCAR: `orchestrator/`, `channels/`, frontend
Steps:
1. OpenAIClient: reqwest, método chat_completion com retry (3x backoff)
2. System prompt para orquestrador em prompts.rs
3. `send_chat_message`: recebe msg → chama OpenAI → retorna → salva SQLite
4. Tratar erros: key inválida, rate limit, timeout
5. `cargo check`
Critério: Chat retorna resposta do GPT-4o, erros tratados

### C3 ⬜ 🟢Low — Hooks + tauri-bridge tipados
CRIAR: `src/hooks/useTauriCommand.ts`, `useTauriEvent.ts`
EDITAR: `src/lib/tauri-bridge.ts`
LER: `docs/PRD.md` (Comandos Tauri), `src/types/`
NÃO TOCAR: `src-tauri/`
Steps:
1. tauri-bridge: funções tipadas para cada command
2. useTauriCommand: hook com loading/error/data
3. useTauriEvent: hook que escuta evento Tauri
4. `npm run build`
Critério: Bridge completa, hooks funcionais, build ok

### C4 ⬜ 🟢Low — Conectar Chat ao GPT via bridge
CRIAR: `src/hooks/useChat.ts`
EDITAR: `src/components/chat/ChatPanel.tsx`
LER: `src/lib/tauri-bridge.ts`, `src/stores/chatStore.ts`
NÃO TOCAR: `src-tauri/`
Steps:
1. useChat: envio via bridge, atualiza chatStore
2. ChatPanel: trocar mock por bridge real
3. Loading indicator, toast de erros
4. `npm run build`
Critério: Chat funcional com GPT real, mensagens persistidas

---

## Bloco D — Skills (Parser + Gerenciador)

### D1 ⬜ 🔴High — Skill Parser (Rust)
CRIAR: implementar `src-tauri/src/orchestrator/skill_parser.rs`
EDITAR: `src-tauri/src/orchestrator/mod.rs`
LER: briefing (Formato Padrão de Skill), `state.rs`
NÃO TOCAR: `channels/`, frontend
Steps:
1. Structs: ParsedSkill, SkillStep, SkillConfig
2. Parser: .md → frontmatter YAML → seções (Tools, Inputs, Steps, Outputs, Config)
3. Parsear steps: `## step_N` → campos (tool, command, validate, on_fail, on_success)
4. Parsear step_loop: repeat/until
5. Validação (skill sem name = erro, step sem tool = erro)
6. Testes unitários
7. `cargo test`
Critério: Parser converte skill .md em structs. Testes passam

### D2 ⬜ 🟡Med — Variable Resolver
CRIAR: implementar `src-tauri/src/orchestrator/variable_resolver.rs`
LER: briefing (Variáveis Dinâmicas), `skill_parser.rs`
NÃO TOCAR: `channels/`, frontend
Steps:
1. Regex `{{variável}}`, resolver inputs, runtime, TASKS.md fields
2. Erro se variável não resolvida
3. Testes unitários
4. `cargo test`
Critério: Variáveis resolvidas, erro claro para não-encontradas

### D3 ⬜ 🟡Med — Tauri Commands para Skills
CRIAR: implementar `src-tauri/src/commands/skills.rs`
EDITAR: `src-tauri/src/main.rs` (registrar)
LER: `docs/PRD.md` (Comandos Tauri), `skill_parser.rs`
NÃO TOCAR: frontend, `channels/`
Steps:
1. list_skills, read_skill, save_skill, parse_skill
2. Registrar no main.rs
3. `cargo check`
Critério: Commands funcionais via invoke

### D4 ⬜ 🟡Med — SkillList + SkillViewer (Frontend)
CRIAR: `src/components/skills/SkillList.tsx`, `SkillViewer.tsx`
EDITAR: `src/App.tsx` (rotas)
LER: `docs/ux-flows.md`, `tauri-bridge.ts`
NÃO TOCAR: `src-tauri/`
Steps:
1. SkillList: invoke list_skills → cards
2. SkillViewer: invoke read_skill → markdown render
3. Empty state
4. `npm run build`
Critério: Lista e visualiza skills do diretório

### D5 ⬜ 🟡Med — SkillEditor (Frontend)
CRIAR: `src/components/skills/SkillEditor.tsx`
EDITAR: `src/App.tsx`
LER: `docs/ux-flows.md`, `SkillViewer.tsx`
NÃO TOCAR: `src-tauri/`
Steps:
1. Textarea monospace + preview markdown lado a lado
2. Salvar → invoke save_skill, validar → invoke parse_skill
3. Rota /skills/new com template
4. `npm run build`
Critério: Editor salva, valida formato

---

## Bloco E — Execução (Channels + Executor)

### E1 ⬜ 🔴High — Channel trait + BashChannel
CRIAR: implementar `src-tauri/src/channels/mod.rs`, `bash.rs`
LER: `docs/PRD.md` (Canal bash), `docs/architecture.md`, `docs/security.md`
NÃO TOCAR: frontend, `ai/`
Steps:
1. Trait Channel: execute(input) → Result<output>
2. ChannelInput/Output structs
3. BashChannel: tokio::process::Command, args array, timeout
4. Testes com echo/ls
5. `cargo test`
Critério: BashChannel executa, captura output, timeout. Testes passam

### E2 ⬜ 🔴High — ClaudeCodeChannel
CRIAR: implementar `src-tauri/src/channels/claude_code.rs`
EDITAR: `src-tauri/src/channels/mod.rs`
LER: `docs/PRD.md` (Canal claude-code), `bash.rs`
NÃO TOCAR: frontend, `ai/`
Steps:
1. Spawn `claude -p "prompt" --output-format json --allowedTools "Bash,Read,Edit"`
2. Working dir = repo_path
3. Parsear JSON output
4. Timeout 300s, context files injection
5. `cargo check`
Critério: Executa prompt, parseia response, timeout funciona

### E3 ⬜ 🟡Med — ApiChannel
CRIAR: implementar `src-tauri/src/channels/api.rs`
EDITAR: `src-tauri/src/channels/mod.rs`
LER: `docs/PRD.md` (Canal api), `bash.rs`
NÃO TOCAR: frontend, `orchestrator/`
Steps:
1. Reqwest HTTP: url, method, headers, body da skill
2. Output: status_code, body, duration_ms
3. `cargo check`
Critério: Requests HTTP funcionais com timeout

### E4 ⬜ 🔴High — Executor (máquina de estados)
CRIAR: implementar `executor.rs`, `validator.rs`, `state.rs`
EDITAR: `src-tauri/src/commands/execution.rs`
LER: `docs/PRD.md` (fluxo principal), `skill_parser.rs`, `channels/mod.rs`
NÃO TOCAR: frontend, `ai/client.rs`
Steps:
1. Enums ExecutionState, StepState em state.rs
2. Validator: avaliar exit_code == 0, output contains, OR/AND
3. Executor: loop steps → resolve vars → dispatch channel → valida → on_success/on_fail
4. step_loop para iteração
5. Eventos Tauri a cada transição
6. Pause/resume/abort via Arc<AtomicBool>
7. Commands wrappers (execute_skill, abort, pause, resume)
8. `cargo check`
Critério: Executa skill completa, valida, trata erros, emite eventos, pause/abort funcional

### E5 ⬜ 🟡Med — GPT detecta /comandos e aciona executor
CRIAR: nenhum
EDITAR: `commands/chat.rs`, `ai/prompts.rs`
LER: `docs/PRD.md`, `executor.rs`, `commands/skills.rs`
NÃO TOCAR: frontend, `channels/`
Steps:
1. Detectar `/` prefix em send_chat_message
2. Parse skill → verificar inputs → pedir confirmação
3. Confirma → executor.execute()
4. System prompt com lista de skills
5. `cargo check`
Critério: `/criar-sistema` no chat aciona executor

---

## Bloco F — Progress Dashboard + Projetos

### F1 ⬜ 🟡Med — ProgressDashboard + StepCard + LogViewer
CRIAR: `src/components/progress/ProgressDashboard.tsx`, `StepCard.tsx`, `LogViewer.tsx`, `ProgressBar.tsx`
EDITAR: `src/App.tsx`, `src/hooks/useExecution.ts`
LER: `docs/ux-flows.md`, `executionStore.ts`, `types/events.ts`
NÃO TOCAR: `src-tauri/`
Steps:
1. useExecution: escuta eventos Tauri, atualiza store
2. Dashboard: skill name + ProgressBar + StepCards
3. StepCard: status icon, nome, tool, duração, click expande log
4. LogViewer: monospace, auto-scroll, stderr vermelho
5. `npm run build`
Critério: Dashboard atualiza em tempo real, logs visíveis

### F2 ⬜ 🟡Med — ExecutionControls
CRIAR: `src/components/chat/ExecutionControls.tsx`
EDITAR: `ChatPanel.tsx`
LER: `executionStore.ts`, `tauri-bridge.ts`
NÃO TOCAR: `src-tauri/`
Steps:
1. Botões Pausar, Retomar, Abortar
2. Visível quando execução ativa
3. Abortar com Dialog de confirmação
4. `npm run build`
Critério: Controls funcionais, confirmação antes de abortar

### F3 ⬜ 🟡Med — Tauri Commands para Projetos
CRIAR: implementar `src-tauri/src/commands/projects.rs`
EDITAR: `main.rs`
LER: `docs/PRD.md`, `db/queries.rs`
NÃO TOCAR: frontend, `orchestrator/`
Steps:
1. list_projects, create_project (valida path), delete_project, get_execution_history, get_execution_detail
2. Registrar commands
3. `cargo check`
Critério: CRUD funcional, histórico retorna dados

### F4 ⬜ 🟡Med — ProjectList + ProjectDetail + NewProjectForm
CRIAR: `src/components/projects/ProjectList.tsx`, `ProjectDetail.tsx`, `NewProjectForm.tsx`
EDITAR: `src/App.tsx`
LER: `docs/ux-flows.md`, `tauri-bridge.ts`
NÃO TOCAR: `src-tauri/`
Steps:
1. ProjectList: cards com nome + último uso
2. NewProjectForm: nome + repo_path com Tauri dialog file picker
3. ProjectDetail: info + histórico de execuções
4. Empty states
5. `npm run build`
Critério: CRUD funcional, file picker nativo funciona

---

## Bloco G — Polish + Finalização

### G1 ⬜ 🟢Low — Tela de Settings
CRIAR: `src/components/settings/SettingsPage.tsx`
EDITAR: `src/App.tsx`
LER: `docs/ux-flows.md` (onboarding), `tauri-bridge.ts`
NÃO TOCAR: `src-tauri/`
Steps:
1. Input API key + botão Testar
2. Input skills_dir + file picker
3. Salvar → invoke save_config
4. Redirect para Settings se API key ausente no primeiro uso
5. `npm run build`
Critério: Settings salva/carrega, teste de API key funciona

### G2 ⬜ 🟡Med — Responsividade
EDITAR: `Sidebar.tsx`, `MainLayout.tsx`, `ChatPanel.tsx`, `ProgressDashboard.tsx`
LER: `docs/ux-flows.md` (responsividade)
NÃO TOCAR: `src-tauri/`
Steps:
1. Sidebar < 800px → drawer
2. Progress como tab em tela pequena
3. Testar 600px, 800px, 1200px
4. `npm run build`
Critério: Layout responsivo em todos breakpoints

### G3 ⬜ 🟢Low — Error handling + toasts
EDITAR: todos os componentes com invoke
LER: `docs/architecture.md` (error handling)
NÃO TOCAR: `src-tauri/`
Steps:
1. Wrapper de invoke com catch + toast
2. Toast sucesso 3s, erro persist
3. Dialog para erros fatais
4. `npm run build`
Critério: Nenhum invoke sem tratamento, toasts funcionais

### G4 ⬜ 🟢Low — Skill de exemplo criar-sistema.md
CRIAR: `skills/criar-sistema.md`
LER: briefing (Formato de Skill + Fluxo Principal)
NÃO TOCAR: código do app
Steps:
1. Escrever skill com frontmatter, tools, inputs, steps
2. Steps: npm install (bash) → loop tasks com claude-code → git commit (bash)
3. Validações e on_fail para cada step
4. Testar parser: invoke parse_skill("criar-sistema")
Critério: Skill parseia sem erros, steps são válidos

### G5 ⬜ 🟢Low — Skill de exemplo debug-sistema.md
CRIAR: `skills/debug-sistema.md`
LER: `skills/criar-sistema.md` (copiar formato)
NÃO TOCAR: código do app
Steps:
1. Skill de debug: lê erro → analisa via claude-code → aplica fix → valida build
2. Chamável por on_fail de outras skills
3. Testar parser
Critério: Skill parseia, pode ser chamada como fallback

---

## Tabela Resumo

| Bloco | Tasks | Complexidade | Dependência |
|-------|-------|-------------|-------------|
| **A — Setup** | A1-A6 | 3🟡 2🟢 | Nenhuma |
| **B — Layout** | B1-B2 | 1🟡 1🟢 | A |
| **C — Chat** | C1-C4 | 1🔴 1🟡 2🟢 | A, B |
| **D — Skills** | D1-D5 | 1🔴 4🟡 | A |
| **E — Execução** | E1-E5 | 3🔴 2🟡 | A, D |
| **F — Progress/Projetos** | F1-F4 | 4🟡 | A, B, E |
| **G — Polish** | G1-G5 | 2🟡 3🟢 | Todos |
| **Total** | **30 tasks** | 4🔴 14🟡 12🟢 | |
