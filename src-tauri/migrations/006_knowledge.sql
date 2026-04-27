-- Knowledge base — arquivos .md sobre o usuário (cargo, processos,
-- ferramentas) que alimentam um resumo gerado pela IA, depois injetado
-- no system prompt. Layout em 2 tabelas:
--
--   * knowledge_files: 1 linha por upload, com conteúdo bruto guardado
--     pra reprocessar quando o resumo é regenerado.
--   * knowledge_summary: singleton (id = 'singleton'). Uma única linha
--     que é UPSERT-ada toda vez que a IA gera um novo resumo. source_count
--     guarda quantos files entraram no input pra debug/UI.
--
-- A tabela app_state também é incluída pra sobreviver dbs antigos que
-- não rodaram a migration 003 — todos os CREATE são IF NOT EXISTS, então
-- é seguro re-rodar mesmo onde a tabela já existe.

CREATE TABLE IF NOT EXISTS knowledge_files (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_files_uploaded
    ON knowledge_files(uploaded_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_summary (
    id TEXT PRIMARY KEY DEFAULT 'singleton',
    summary TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    source_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
