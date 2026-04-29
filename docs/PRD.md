# PRD — Genesis

App desktop local que ajuda profissionais não-técnicos a automatizar
rotinas. O usuário descreve o problema em linguagem natural; Genesis
guia a criação de uma skill (procedimento empacotado) e executa
quando ativada.

## Personas

**Usuário-fim** — funcionário de uma empresa, não-dev. Tem rotinas
repetitivas (legendar vídeos, gerar relatórios, sincronizar pastas).
Não conhece bash, ffmpeg, ou APIs. Quer apertar um botão e o
trabalho acontecer.

**Desenvolvedor de skill** — pode ser o próprio usuário (via agente
de criação) ou um técnico colaborador. Escreve `SKILL.md` em prosa
descritiva.

## Features (estado atual)

### F1 — Onboarding unificado (5 steps)
Welcome → API key (com Testar) → Perfil (nome+empresa) → Documentos
(.md opcionais) → Resumo GPT + Começar. Substitui o flow legado de
2 wizards encadeados.

### F2 — Chat com triple prefix
- `/<skill>` (start-of-input) — slash command com preview canned
- `@<capability>` (mid-text) — mention de ação invocável
- `#<caminho>` (mid-text) — mention de pasta cadastrada

Detecção via `extract_*_mentions` em `chat.rs` com boundary check.

### F3 — Capabilities
Tabela `capabilities` (migration 007) com 2 tipos:
- **Native** — embarcadas, channel-backed (`bash`/`claude-code`/`api`).
  Seeds: `terminal`, `code`.
- **Connector** — integrações de terceiros (futuro). `channel = NULL`,
  config JSON.

`doc_ai` per-row injeta no system prompt quando o usuário menciona
`@nome`. UI: `/capabilities` lista; `/capabilities/:name` detalha.

### F4 — Caminhos
Renomeação de "projetos" pra "caminhos" (folder bookmarks pt-BR).
Schema continua `projects` table. UI: `/caminhos`, `/caminhos/new`,
`/caminhos/:id`. Redirects `/projects/*` → `/caminhos/*` pra compat.
Sidebar entry com ícone Route.

### F5 — Skills v2 (folder)
Pasta `<nome>/` com `SKILL.md` + `references/` + `scripts/` + `assets/`.
Etapas em prosa (não DSL — modelo traduz pra tool calls). Progressive
disclosure: cheat-sheets em `references/` lidos sob demanda. v1 (`.md`
solto) continua suportado via fallback no `skill_loader_v2`.

### F6 — Agente de criação de skills
`/criar-skill` ou triggers naturais ("criar uma skill...") ativam
o `PROMPT_SKILL_AGENT` que conduz a criação em 6 etapas (entender,
pesquisar, propor, construir, apresentar, validar). Frontend detecta
`SKILL.md` block + frontmatter `version: "2.0"`, oferece "Ver" +
"Salvar" via `save_skill_folder`.

### F7 — Execução com chat inline
Eventos do executor (`step_started/completed/failed/completed`)
viram `chat_messages.kind = "execution-status"`. `step_failed` dispara
`analyze_step_failure` pra GPT diagnosticar e postar análise como
mensagem normal logo abaixo. Pause/abort numa thin bar acima do input.

### F8 — Function calling
OpenAI tool use loop em `chat.rs::send_chat_message`. 7 tools:
`execute_skill`, `list_skills`, `read_skill`, `save_skill`,
`read_file`, `list_files`, `abort_execution`. Loop até 10 iterações
por turno. Dispatcher async em `execute_tool`.

### F9 — Workflows
Encadeamento ordenado de skills com inputs/outputs/condição. Schema
migration 005. UI: `/workflows`, `/workflows/new`, `/workflows/:name`.

### F10 — Knowledge base
Documentos `.md` sobre o trabalho do usuário viram um `summary` GPT-
gerado injetado no system prompt (USER_CONTEXT). Persistido em tabela
`knowledge_files` + singleton `knowledge_summary`.

## Modelo de dados

```
projects (legacy name; surface chama "caminhos")
  id TEXT PK, name, repo_path UNIQUE, created_at, updated_at

executions
  id, project_id FK, skill_name, status, total_steps, completed_steps,
  conversation_id (rota das status messages), started_at, finished_at

execution_steps
  id, execution_id FK, step_id, step_order, tool, status, input,
  output, error, retries, started_at, finished_at, duration_ms

capabilities (migration 007)
  id, name UNIQUE, display_name, description, type, channel,
  config JSON, doc_ai, doc_user, enabled, created_at, updated_at

chat_messages
  id, execution_id, conversation_id FK, role, content, created_at,
  kind (text|execution-status), thinking, thinking_summary

conversations
  id, title, created_at, updated_at

app_state (key/value)
  key UNIQUE, value, updated_at — usado pra activeProjectId,
  user_name, company_name, active_model_id, onboarding_complete

knowledge_files / knowledge_summary

workflows (migration 005)
```

## Comandos Tauri (estabilidade)

Backend `#[tauri::command]` é a fronteira do contrato. Lista oficial
em `src-tauri/src/lib.rs::invoke_handler`. Frontend só toca via
`src/lib/tauri-bridge.ts`. Mudanças em assinatura quebram bridge —
update sempre em pareis.

Núcleo:
- caminhos: `list_caminhos`, `create_caminho`, `delete_caminho`
- capabilities: `list_capabilities`, `get_capability`,
  `list_capabilities_by_type`
- chat: `send_chat_message`, `call_openai`, `analyze_step_failure`,
  `insert_execution_status_message`, `save_skill_folder`,
  `list_messages_by_conversation`
- execution: `execute_skill`, `abort`, `pause`, `resume`
- skills: `list_skills`, `read_skill`, `save_skill`, `delete_skill`,
  `parse_skill`
- conversations / knowledge / workflows / app_state / config /
  dependencies

## Integrações

- **OpenAI** — chat completion + Whisper. Key em `~/.genesis/config.toml`.
- **Anthropic** — opcional, via `ANTHROPIC_API_KEY`. AiClient enum
  dispatcha por modelo selecionado em `app_state.active_model_id`.
- **Claude Code CLI** — channel `claude-code` invoca o binário local.
- **Bash + ferramentas CLI** — qualquer coisa instalada no PATH.

## Não-objetivos

- Cloud/SaaS — Genesis é local-first, sem backend próprio.
- Multi-usuário — uma instância por máquina, dados isolados em
  `~/.genesis/`.
- Auto-execução — qualquer ação destrutiva exige confirmação
  explícita do usuário.
- Web — só desktop nativo (Tauri).
