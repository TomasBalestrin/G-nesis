-- Workflows: encadeamento ordenado de skills com inputs/outputs/condição.
-- A row aqui é um "ponteiro" pro arquivo .md em ~/.genesis/workflows/ —
-- mesmo padrão que `skills` segue (file_path como source-of-truth, DB como
-- índice + metadata cacheada).

CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '1.0',
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_workflows_name ON workflows(name);

CREATE TRIGGER IF NOT EXISTS trg_workflows_updated_at
    AFTER UPDATE ON workflows
    FOR EACH ROW
BEGIN
    UPDATE workflows
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = OLD.id;
END;
