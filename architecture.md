> 🔮 Doutor Estranho | 21/04/2026 | v1.0

# Architecture — Genesis

---

## 1. Estrutura de Diretórios

```
genesis/
├── src-tauri/                      # Backend Rust (Tauri)
│   ├── src/
│   │   ├── main.rs                 # Entry point Tauri
│   │   ├── lib.rs                  # Module declarations
│   │   ├── commands/               # Tauri commands (IPC handlers)
│   │   │   ├── mod.rs
│   │   │   ├── skills.rs           # list_skills, read_skill, save_skill, parse_skill
│   │   │   ├── projects.rs         # list_projects, create_project, delete_project
│   │   │   ├── execution.rs        # execute_skill, abort, pause, resume
│   │   │   └── chat.rs             # send_chat_message, call_openai
│   │   ├── orchestrator/           # Lógica de orquestração
│   │   │   ├── mod.rs
│   │   │   ├── skill_parser.rs     # Parser de skills .md → ParsedSkill
│   │   │   ├── variable_resolver.rs # Resolve {{variáveis}}
│   │   │   ├── executor.rs         # Máquina de estados de execução
│   │   │   ├── validator.rs        # Validação de resultados por step
│   │   │   └── state.rs            # ExecutionState, StepState enums
│   │   ├── channels/               # Canais de execução
│   │   │   ├── mod.rs              # Trait Channel + dispatch
│   │   │   ├── claude_code.rs      # Subprocess claude -p
│   │   │   ├── bash.rs             # Subprocess shell
│   │   │   └── api.rs              # HTTP via reqwest
│   │   ├── ai/                     # Integração OpenAI
│   │   │   ├── mod.rs
│   │   │   ├── client.rs           # OpenAI HTTP client
│   │   │   └── prompts.rs          # System prompts para orquestração
│   │   ├── db/                     # SQLite
│   │   │   ├── mod.rs              # init, migrations
│   │   │   ├── models.rs           # Structs: Project, Execution, Step, Message
│   │   │   └── queries.rs          # CRUD operations
│   │   └── config.rs               # Leitura de config.toml + env vars
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── build.rs
├── src/                            # Frontend React (WebView)
│   ├── main.tsx                    # React entry point
│   ├── App.tsx                     # Router + layout wrapper
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx         # Navegação lateral
│   │   │   ├── Header.tsx          # Barra superior
│   │   │   └── MainLayout.tsx      # Layout wrapper
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx       # Painel de chat completo
│   │   │   ├── MessageBubble.tsx   # Mensagem individual
│   │   │   ├── CommandInput.tsx    # Input com detecção de /comandos
│   │   │   └── ExecutionControls.tsx # Pausar/Retomar/Abortar
│   │   ├── skills/
│   │   │   ├── SkillList.tsx       # Lista de skills
│   │   │   ├── SkillViewer.tsx     # Visualizar skill .md
│   │   │   └── SkillEditor.tsx     # Editar/criar skill
│   │   ├── progress/
│   │   │   ├── ProgressDashboard.tsx # Dashboard de progresso
│   │   │   ├── StepCard.tsx        # Card individual de step
│   │   │   ├── LogViewer.tsx       # Viewer de logs por step
│   │   │   └── ProgressBar.tsx     # Barra de progresso geral
│   │   ├── projects/
│   │   │   ├── ProjectList.tsx     # Lista de projetos
│   │   │   ├── ProjectDetail.tsx   # Detalhes + histórico
│   │   │   └── NewProjectForm.tsx  # Form de criação
│   │   └── ui/                     # shadcn/ui components
│   ├── hooks/
│   │   ├── useTauriCommand.ts      # Wrapper para invoke
│   │   ├── useTauriEvent.ts        # Wrapper para listen
│   │   ├── useExecution.ts         # Estado de execução ativa
│   │   └── useChat.ts              # Lógica de chat
│   ├── stores/
│   │   ├── appStore.ts             # Estado global (sidebar, tema)
│   │   ├── executionStore.ts       # Execução ativa, steps, logs
│   │   └── chatStore.ts            # Mensagens do chat
│   ├── lib/
│   │   ├── tauri-bridge.ts         # Funções tipadas para invoke/listen
│   │   └── utils.ts                # Helpers genéricos
│   ├── types/
│   │   ├── skill.ts                # ParsedSkill, SkillMeta, Step
│   │   ├── project.ts              # Project, Execution, ExecutionStep
│   │   ├── chat.ts                 # ChatMessage, ChatRole
│   │   └── events.ts               # Tipos dos eventos Tauri
│   └── styles/
│       └── globals.css             # Tailwind + CSS variables
├── skills/                         # Skills .md (versionáveis)
│   ├── criar-sistema.md
│   ├── debug-sistema.md
│   └── criar-skill.md
├── index.html                      # Entry HTML (Vite)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
└── CLAUDE.md
```

---

## 2. Nomenclatura

| Tipo | Padrão | Exemplo |
|------|--------|---------|
| Componentes React | PascalCase.tsx | `ChatPanel.tsx` |
| Hooks | use*.ts | `useTauriCommand.ts` |
| Stores | *Store.ts | `executionStore.ts` |
| Utils/libs | camelCase.ts | `tauri-bridge.ts` |
| Rust modules | snake_case.rs | `skill_parser.rs` |
| Rust structs | PascalCase | `ParsedSkill` |
| Rust functions | snake_case | `execute_skill` |
| Pastas | kebab-case | `claude-code` |
| Types | PascalCase | `ExecutionStep` |
| Constantes | UPPER_SNAKE | `MAX_RETRIES` |
| Variáveis | camelCase (TS) / snake_case (Rust) | |

---

## 3. Comunicação WebView ↔ Rust ↔ Subprocesses

```
┌──────────────┐         ┌──────────────────────┐         ┌──────────────┐
│   Frontend   │ invoke  │    Rust Backend       │ spawn   │  Subprocess  │
│   (React)    │────────►│  #[tauri::command]    │────────►│ claude -p    │
│              │         │                       │         │ bash         │
│              │◄────────│  emit() events        │◄────────│ stdout/err   │
│   listen()   │ events  │                       │ wait    │              │
└──────────────┘         └──────────────────────┘         └──────────────┘
                                    │
                                    │ reqwest
                                    ▼
                            ┌──────────────┐
                            │  OpenAI API  │
                            │  GPT-4o      │
                            └──────────────┘
```

### Frontend → Rust (Commands)
```typescript
// src/lib/tauri-bridge.ts
import { invoke } from '@tauri-apps/api/core';

export async function executeSkill(skillName: string, projectId: string) {
  return invoke<string>('execute_skill', { skillName, projectId });
}
```

### Rust → Frontend (Events)
```rust
// src-tauri/src/orchestrator/executor.rs
app_handle.emit("execution:step_completed", StepEvent {
    execution_id,
    step_id,
    status: "success",
    output,
})?;
```

### Frontend Listen
```typescript
// src/hooks/useTauriEvent.ts
import { listen } from '@tauri-apps/api/event';

listen<StepEvent>('execution:step_completed', (event) => {
  executionStore.updateStep(event.payload);
});
```

---

## 4. Componentes

### Regras
- Function declaration (não arrow) para componentes
- Named export (nunca default, exceto pages de roteamento)
- Props tipadas com interface no arquivo
- Componentes ≤ 200 linhas — extrair lógica para hooks/stores
- `"use client"` não se aplica (SPA, tudo é client)

### Padrão de componente
```typescript
interface StepCardProps {
  step: ExecutionStep;
  onRetry: (stepId: string) => void;
}

export function StepCard({ step, onRetry }: StepCardProps) {
  // ...
}
```

---

## 5. Data Flow

### Sem server state (tudo via Tauri Commands)
```
Componente → invoke('command', params) → Rust handler → SQLite/subprocess → return → Componente atualiza
```

### State layers
- **Zustand stores** — estado global persistente na sessão (execução ativa, mensagens, UI)
- **React state** — estado local efêmero (form inputs, modais)
- **SQLite** — persistência durável (projetos, histórico, mensagens)
- **Events** — streaming de atualizações (progresso em tempo real)

### Fluxo de execução
```
1. User digita /criar-sistema no chat
2. chatStore → invoke('send_chat_message')
3. Rust: detecta comando → invoke('parse_skill', 'criar-sistema')
4. Rust: resolve inputs → cria Execution no SQLite
5. Rust: loop steps:
   a. emit('execution:step_started')
   b. dispatch para canal (spawn subprocess ou HTTP)
   c. aguarda resultado
   d. valida conforme skill
   e. emit('execution:step_completed') ou emit('execution:step_failed')
   f. atualiza SQLite
6. Frontend: listen eventos → atualiza executionStore → re-render ProgressDashboard
7. Rust: emit('execution:completed')
```

---

## 6. Orchestrator (Rust)

### Trait Channel
```rust
#[async_trait]
pub trait Channel: Send + Sync {
    async fn execute(&self, input: ChannelInput) -> Result<ChannelOutput, ChannelError>;
}
```

### Implementações
- `ClaudeCodeChannel` — spawn `claude -p`, parseia JSON output
- `BashChannel` — spawn shell, captura stdout/stderr/exit_code
- `ApiChannel` — reqwest HTTP, retorna status + body

### Skill Parser
- Lê frontmatter YAML (name, description, version, author)
- Parseia seções: Tools, Inputs, Steps, Outputs, Config
- Cada Step: tool, command/prompt, context, validate, on_fail, on_success
- step_loop: repeat/until com iterador

### Validator
- `exit_code == 0` → checa exit code do subprocess
- `output contains "X"` → busca string no output
- Expressões compostas com OR/AND
- Resultado: StepResult::Success | StepResult::Failed(reason)

---

## 7. Error Handling

### Rust
- `Result<T, E>` em todas as funções
- Custom error enum `GenesisError` com variantes: Io, Db, OpenAi, ClaudeCode, Parse, Validation, Timeout
- Logging via `tracing` crate (info, warn, error)
- Errors emitidos como eventos para o frontend

### Frontend
- Try/catch em torno de todo invoke
- Toast para erros não-fatais (falha em step com retry)
- Dialog para erros fatais (API key inválida, CLI não encontrada)
- Sem error boundaries complexos — app simples

---

## 8. Performance

- **Async Rust** (tokio) para operações I/O (subprocess, HTTP, SQLite)
- **Streaming de logs** via eventos (não espera step completar para exibir output)
- **Lazy loading** de skills (só parseia quando ativada)
- **Debounce** em inputs de busca (300ms)
- **Vite HMR** para dev rápido
