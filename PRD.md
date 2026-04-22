> 🦾 Iron Man | 21/04/2026 | v1.0

# PRD — Genesis

App desktop local que orquestra skills via IA, delegando execução para Claude Code CLI, terminal bash e outros canais — automatizando workflows de desenvolvimento e operações.

---

## 1. Visão

### Problema

O usuário (Bethel) cria ~3 sistemas internos por semana usando o Capitão (que gera MDs com PRD, schema, TASKS, progress.html com prompts prontos). Depois precisa manualmente copiar cada prompt no Claude Code Web, conferir resultado, e enviar o próximo. Esse processo manual consome horas. Outras tarefas repetitivas (debug, testes, edição de ads em massa, automações de terminal) seguem o mesmo padrão manual.

### Solução

App desktop (Tauri) que lê skills (arquivos .md com formato padronizado), orquestra a execução step-by-step via GPT-4o, despacha para canais (Claude Code CLI, bash, API), valida resultados automaticamente, e apresenta progresso em tempo real.

### Persona

**Bethel** — desenvolvedor full-stack, único usuário. Cria sistemas SaaS internos em alta velocidade. Precisa automatizar o loop: ler task → copiar prompt → colar no Claude Code → validar → próxima.

### KPIs de Sucesso

- Tempo de criação de sistema reduzido em ≥60% (de ~8h manual para ~3h assistido)
- Taxa de execução automática ≥80% (tasks sem intervenção manual)
- Zero perda de contexto entre tasks (GPT mantém fluxo)
- Skills reutilizáveis entre projetos

---

## 2. Features

### F1 — Executor de Skills [P0]

**Descrição:** Motor central que carrega, parseia e executa skills .md step-by-step.

**User Stories:**
- Como Bethel, quero ativar uma skill via comando no chat para que o sistema execute todas as tasks automaticamente.
- Como Bethel, quero que cada step seja validado antes de avançar para garantir qualidade.
- Como Bethel, quero que falhas sejam tratadas com retry/abort/fallback conforme configurado na skill.

**Critérios de Aceitação:**
- [ ] Parseia skill .md completa (frontmatter, tools, inputs, steps, outputs, config)
- [ ] Resolve variáveis dinâmicas ({{repo_path}}, {{current_task}}, etc.)
- [ ] Despacha para canal correto (claude-code, bash, api)
- [ ] Valida resultado conforme critério do step (exit_code, output contains, etc.)
- [ ] Executa on_fail (retry N vezes, abort, chamar outra skill)
- [ ] Suporta step_loop (repetir steps para cada task em um arquivo)
- [ ] Timeout configurável por step (default 300s)
- [ ] Emite eventos de progresso em tempo real para o frontend

**Regras de Negócio:**
- O GPT não improvisa — segue a skill ao pé da letra
- Steps executam sequencialmente (paralelo é pós-MVP)
- Se retry excede max_retries_per_step, executa on_fail final
- Composição: on_fail pode chamar outra skill (ex: debug-sistema)

### F2 — Progress Dashboard [P0]

**Descrição:** Dashboard visual em tempo real mostrando status de execução.

**User Stories:**
- Como Bethel, quero ver em tempo real qual step está rodando para acompanhar o progresso.
- Como Bethel, quero ver logs de cada step para diagnosticar problemas.

**Critérios de Aceitação:**
- [ ] Mostra skill ativa, step atual, status de cada step (✅⏳❌⚠️)
- [ ] Exibe logs de execução (stdout, stderr, output do Claude) por step
- [ ] Mostra tempo decorrido por step e total
- [ ] Atualiza em tempo real via eventos Tauri (event system)
- [ ] Indicadores visuais claros para cada status

### F3 — Gerenciador de Skills [P0]

**Descrição:** Interface para listar, visualizar, editar e criar skills.

**User Stories:**
- Como Bethel, quero ver todas as skills disponíveis para escolher qual executar.
- Como Bethel, quero criar novas skills via conversa com GPT para não precisar escrever o .md manualmente.
- Como Bethel, quero editar skills existentes para ajustar comportamento.

**Critérios de Aceitação:**
- [ ] Lista todas as skills do diretório configurado
- [ ] Visualiza conteúdo da skill com syntax highlight de markdown
- [ ] Editor inline com preview
- [ ] Meta-skill `/criar-skill`: GPT conversa com usuário e gera o .md
- [ ] Validação de formato ao salvar (frontmatter obrigatório, steps válidos)

### F4 — Gerenciador de Projetos [P1]

**Descrição:** Registra projetos locais e associa execuções.

**User Stories:**
- Como Bethel, quero registrar um projeto apontando para o repo local para que skills saibam onde operar.
- Como Bethel, quero ver histórico de execuções por projeto para rastrear o que foi feito.

**Critérios de Aceitação:**
- [ ] Cadastrar projeto (nome + repo_path)
- [ ] Listar projetos com última execução
- [ ] Histórico de execuções por projeto (status, skill, data, duração)
- [ ] Validar que repo_path existe no filesystem
- [ ] Estado persistido em SQLite local

### F5 — Chat Interface [P0]

**Descrição:** Interface conversacional para interagir com o GPT orquestrador.

**User Stories:**
- Como Bethel, quero conversar com o GPT para ativar skills, tirar dúvidas e intervir durante execução.
- Como Bethel, quero usar comandos (ex: /criar-sistema) como atalhos para skills.

**Critérios de Aceitação:**
- [ ] Input de texto com envio por Enter
- [ ] Renderiza mensagens user/assistant com markdown
- [ ] Detecta comandos /nome-da-skill e ativa automaticamente
- [ ] Exibe progresso inline durante execução
- [ ] Botões de pausar/retomar/abortar durante execução ativa
- [ ] Histórico de mensagens persistido em SQLite (por execução ou geral)

---

## 3. Modelo de Dados (SQLite)

### projects

| Campo | Tipo | Required | Descrição |
|-------|------|----------|-----------|
| id | TEXT (UUID) | ✅ | PK |
| name | TEXT | ✅ | Nome do projeto |
| repo_path | TEXT | ✅ | Caminho local do repositório |
| created_at | TEXT (ISO8601) | ✅ | |
| updated_at | TEXT (ISO8601) | ✅ | |

### executions

| Campo | Tipo | Required | Descrição |
|-------|------|----------|-----------|
| id | TEXT (UUID) | ✅ | PK |
| project_id | TEXT | ✅ | FK → projects.id |
| skill_name | TEXT | ✅ | Nome da skill executada |
| status | TEXT | ✅ | running / completed / failed / aborted |
| started_at | TEXT (ISO8601) | ✅ | |
| finished_at | TEXT (ISO8601) | ❌ | NULL enquanto running |
| total_steps | INTEGER | ✅ | |
| completed_steps | INTEGER | ✅ | Default 0 |

Relacionamento: projects 1──N executions

### execution_steps

| Campo | Tipo | Required | Descrição |
|-------|------|----------|-----------|
| id | TEXT (UUID) | ✅ | PK |
| execution_id | TEXT | ✅ | FK → executions.id |
| step_id | TEXT | ✅ | ID do step na skill (ex: step_1) |
| tool | TEXT | ✅ | claude-code / bash / api |
| status | TEXT | ✅ | pending / running / success / failed / skipped |
| input | TEXT | ✅ | Comando ou prompt enviado |
| output | TEXT | ❌ | Resultado recebido |
| error | TEXT | ❌ | Mensagem de erro |
| retries | INTEGER | ✅ | Default 0 |
| started_at | TEXT (ISO8601) | ❌ | |
| finished_at | TEXT (ISO8601) | ❌ | |
| duration_ms | INTEGER | ❌ | |

Relacionamento: executions 1──N execution_steps

### chat_messages

| Campo | Tipo | Required | Descrição |
|-------|------|----------|-----------|
| id | TEXT (UUID) | ✅ | PK |
| execution_id | TEXT | ❌ | FK → executions.id (nullable — mensagens gerais) |
| role | TEXT | ✅ | user / assistant / system |
| content | TEXT | ✅ | |
| created_at | TEXT (ISO8601) | ✅ | |

Relacionamento: executions 1──N chat_messages (opcional)

---

## 4. Comandos Tauri (IPC Bridge)

Não há API REST — a comunicação é via Tauri Commands (invoke do frontend, #[tauri::command] no Rust).

| Comando | Descrição | Input | Output |
|---------|-----------|-------|--------|
| `list_skills` | Lista skills disponíveis | dir_path | Vec<SkillMeta> |
| `read_skill` | Lê conteúdo de uma skill | skill_name | String (md content) |
| `save_skill` | Salva/cria skill .md | name, content | Result<()> |
| `parse_skill` | Parseia skill e retorna estrutura | skill_name | ParsedSkill |
| `execute_skill` | Inicia execução de skill | skill_name, project_id | execution_id |
| `abort_execution` | Aborta execução ativa | execution_id | Result<()> |
| `pause_execution` | Pausa execução ativa | execution_id | Result<()> |
| `resume_execution` | Retoma execução pausada | execution_id | Result<()> |
| `list_projects` | Lista projetos | — | Vec<Project> |
| `create_project` | Cria projeto | name, repo_path | Project |
| `delete_project` | Remove projeto | project_id | Result<()> |
| `get_execution_history` | Histórico de execuções | project_id | Vec<Execution> |
| `get_execution_detail` | Detalhes + steps de execução | execution_id | ExecutionDetail |
| `send_chat_message` | Envia mensagem ao GPT | message, execution_id? | ChatResponse |
| `call_openai` | Chamada direta ao GPT | messages, system_prompt | String |

Eventos Tauri (backend → frontend):
- `execution:step_started` → { execution_id, step_id, tool }
- `execution:step_completed` → { execution_id, step_id, status, output }
- `execution:step_failed` → { execution_id, step_id, error, retry_count }
- `execution:completed` → { execution_id, status }
- `execution:log` → { execution_id, step_id, line }

---

## 5. Integrações

| Serviço | Tipo | Dados | Fallback |
|---------|------|-------|----------|
| **OpenAI API** | REST (HTTP via reqwest) | Messages → completion (GPT-4o) | Retry 3x com backoff exponencial. Se API down, exibir erro e permitir retry manual |
| **Claude Code CLI** | Subprocess (`claude -p`) | Prompt string → JSON (result, cost, session_id) | Retry conforme skill. Se CLI não encontrado, erro com instrução de instalação |
| **Git** | Subprocess (bash) | git add/commit/push | Se falha, log warning e continuar (não bloquear) |
| **Filesystem** | Tauri fs plugin | Leitura/escrita de skills, projetos | Erro fatal se path inválido |

---

## 6. Auth & Roles

**Não se aplica.** App local, single-user, sem autenticação.

---

## 7. Não-Funcionais

| Requisito | Target |
|-----------|--------|
| Startup time | < 2s (Tauri é leve) |
| Tamanho do binário | < 15MB |
| Memória em idle | < 100MB |
| Responsividade do chat | < 500ms para mensagens locais |
| Timeout por step | Configurável, default 300s |
| Persistência | SQLite local, zero dependência de rede (exceto APIs) |
| OS | macOS (primário), Linux e Windows (futuro) |

---

## 8. Roadmap

| Fase | Features | Estimativa |
|------|----------|------------|
| **MVP** | Executor de Skills + Chat + Progress Dashboard + Gerenciador de Skills (view/list) | 2-3 semanas |
| **v1.1** | Gerenciador de Projetos + Histórico + Criar/Editar skill | 1 semana |
| **v1.2** | Meta-skill /criar-skill (GPT gera .md) + Debug skill | 1 semana |
| **v2.0** | Execução paralela, Git avançado, Notificações desktop | 2 semanas |
| **v3.0** | Skills marketplace local, Templates, Métricas | 2 semanas |

---

## 9. Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Claude Code CLI quebra/muda output format | Média | Alto | Parsear output JSON com fallback; validar schema de resposta |
| OpenAI API rate limit/downtime | Baixa | Alto | Retry com backoff; cache de contexto; permitir retry manual |
| Skills mal-formatadas causam crash | Média | Médio | Validação rígida no parser; mensagens de erro claras |
| Subprocess trava (claude -p sem resposta) | Média | Alto | Timeout por step; kill process após timeout |
| SQLite corruption | Baixa | Alto | WAL mode; backups automáticos periódicos |
| Tauri 2.x ainda em maturação | Baixa | Médio | Pinnar versão; testar builds regularmente |
