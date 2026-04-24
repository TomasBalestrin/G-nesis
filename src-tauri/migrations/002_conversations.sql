-- Multi-conversation chat support. Conversations group chat_messages
-- independently of executions so the UI can offer a sidebar with named threads.

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'Nova conversa',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_conversations_updated_at
    AFTER UPDATE ON conversations
    FOR EACH ROW
BEGIN
    UPDATE conversations
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = OLD.id;
END;

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages(conversation_id);
