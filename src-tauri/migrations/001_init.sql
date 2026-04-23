-- Genesis SQLite schema — see docs/schema.md
-- Idempotent: safe to run at every startup.

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

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

CREATE INDEX IF NOT EXISTS idx_executions_project ON executions(project_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_created ON executions(created_at);

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

CREATE INDEX IF NOT EXISTS idx_steps_execution ON execution_steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_steps_status ON execution_steps(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_steps_order ON execution_steps(execution_id, step_order);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    execution_id TEXT REFERENCES executions(id) ON DELETE SET NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_execution ON chat_messages(execution_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON chat_messages(created_at);

-- Triggers

CREATE TRIGGER IF NOT EXISTS trg_projects_updated_at
    AFTER UPDATE ON projects
    FOR EACH ROW
BEGIN
    UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_step_success_count
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

CREATE TRIGGER IF NOT EXISTS trg_execution_auto_complete
    AFTER UPDATE OF completed_steps ON executions
    WHEN NEW.completed_steps = NEW.total_steps AND NEW.total_steps > 0
BEGIN
    UPDATE executions
    SET status = 'completed',
        finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = NEW.id AND status = 'running';
END;
