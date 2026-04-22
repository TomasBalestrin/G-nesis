> 💚 Hulk | 21/04/2026 | v1.0

# Schema — Genesis (SQLite)

---

## 1. Diagrama de Relacionamentos

```
projects 1──N executions 1──N execution_steps
                         1──N chat_messages
```

---

## 2. SQL — Migration Order

Executar nesta ordem exata. SQL compatível com SQLite.

### 2.1 Tabelas

```sql
-- ============================================================
-- GENESIS — SQLite Schema
-- ============================================================

-- 1. projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_projects_name ON projects(name);

-- 2. executions
CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    skill_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'paused', 'completed', 'failed', 'aborted')),
    started_at TEXT,
    finished_at TEXT,
    total_steps INTEGER NOT NULL DEFAULT 0,
    completed_steps INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_executions_project ON executions(project_id);
CREATE INDEX idx_executions_status ON executions(status);
CREATE INDEX idx_executions_created ON executions(created_at);

-- 3. execution_steps
CREATE TABLE IF NOT EXISTS execution_steps (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    tool TEXT NOT NULL CHECK(tool IN ('claude-code', 'bash', 'api')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'success', 'failed', 'skipped')),
    input TEXT NOT NULL,
    output TEXT,
    error TEXT,
    retries INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_steps_execution ON execution_steps(execution_id);
CREATE INDEX idx_steps_status ON execution_steps(status);
CREATE UNIQUE INDEX idx_steps_order ON execution_steps(execution_id, step_order);

-- 4. chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_messages_execution ON chat_messages(execution_id);
CREATE INDEX idx_messages_created ON chat_messages(created_at);
```

### 2.2 Triggers

```sql
-- Auto-update updated_at em projects
CREATE TRIGGER trg_projects_updated_at
    AFTER UPDATE ON projects
    FOR EACH ROW
BEGIN
    UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;

-- Auto-update completed_steps em executions quando step muda para success
CREATE TRIGGER trg_step_success_count
    AFTER UPDATE OF status ON execution_steps
    WHEN NEW.status = 'success'
BEGIN
    UPDATE executions
    SET completed_steps = (
        SELECT COUNT(*) FROM execution_steps
        WHERE execution_id = NEW.execution_id AND status = 'success'
    )
    WHERE id = NEW.execution_id;
END;

-- Auto-marcar execution como completed quando todos os steps são success
CREATE TRIGGER trg_execution_auto_complete
    AFTER UPDATE OF completed_steps ON executions
    WHEN NEW.completed_steps = NEW.total_steps AND NEW.total_steps > 0
BEGIN
    UPDATE executions
    SET status = 'completed',
        finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id AND status = 'running';
END;
```

### 2.3 Pragmas (executar no startup)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

---

## 3. Rust Structs (models.rs)

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub repo_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Execution {
    pub id: String,
    pub project_id: String,
    pub skill_name: String,
    pub status: String,         // pending|running|paused|completed|failed|aborted
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub total_steps: i32,
    pub completed_steps: i32,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExecutionStep {
    pub id: String,
    pub execution_id: String,
    pub step_id: String,
    pub step_order: i32,
    pub tool: String,           // claude-code|bash|api
    pub status: String,         // pending|running|success|failed|skipped
    pub input: String,
    pub output: Option<String>,
    pub error: Option<String>,
    pub retries: i32,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub execution_id: Option<String>,
    pub role: String,           // user|assistant|system
    pub content: String,
    pub created_at: String,
}
```

---

## 4. Notas

- **UUID gerado no Rust** via `uuid::Uuid::new_v4().to_string()`
- **Timestamps ISO8601** — SQLite não tem tipo datetime nativo; usar TEXT com format padrão
- **ON DELETE CASCADE** em executions e steps — deletar projeto limpa tudo
- **ON DELETE SET NULL** em chat_messages.execution_id — manter mensagens gerais
- **WAL mode** — permite leituras concorrentes durante escrita (importante para streaming de logs)
- **Sem soft delete** — app local, deletar é deletar
- **Sem RLS** — SQLite local, single-user, não se aplica
