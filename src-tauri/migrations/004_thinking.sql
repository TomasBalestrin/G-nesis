-- Extended-thinking storage for assistant messages. Both columns are
-- nullable: regular text turns leave them NULL. Backfilled by the chat
-- router when the active model emits a thinking block (Anthropic
-- thinking_delta events; OpenAI o1/o3 reasoning when wired).
--
-- ALTER TABLE ADD COLUMN is guarded in db/mod.rs::ensure_chat_messages_thinking
-- because SQLite has no `ADD COLUMN IF NOT EXISTS`. This file is included for
-- audit trail / dev who reads the migrations folder; the runtime path goes
-- through pragma_table_info introspection before issuing the ALTER.

-- These statements are intentionally a no-op in normal startup — they exist
-- as documentation of the intended final schema. The actual DDL runs from
-- Rust to stay idempotent across re-launches.

-- ALTER TABLE chat_messages ADD COLUMN thinking TEXT;
-- ALTER TABLE chat_messages ADD COLUMN thinking_summary TEXT;
