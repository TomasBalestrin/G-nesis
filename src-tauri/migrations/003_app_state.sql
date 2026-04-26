-- Generic key/value store for cross-session UI state. Single-row-per-key
-- semantics with UPSERT (ON CONFLICT replace) on writes. Defaults are seeded
-- below so the table always exposes the expected keys after migration.

CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TRIGGER IF NOT EXISTS trg_app_state_updated_at
    AFTER UPDATE ON app_state
    FOR EACH ROW
BEGIN
    UPDATE app_state
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE key = OLD.key;
END;

-- Defaults — INSERT OR IGNORE keeps existing values intact on re-run. Empty
-- string represents "no project picked yet" since SQLite TEXT columns can't
-- be null with PRIMARY KEY semantics here.
INSERT OR IGNORE INTO app_state (key, value) VALUES ('active_project_id', '');
INSERT OR IGNORE INTO app_state (key, value) VALUES ('active_model_id', 'gpt-4o');
