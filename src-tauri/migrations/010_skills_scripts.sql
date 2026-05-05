-- Skills v2 +scripts/: adiciona has_scripts ao mirror SQLite criado em
-- 009. ALTER inline porque SQLite não suporta ADD COLUMN IF NOT EXISTS;
-- o run_migrations chama ensure_skills_has_scripts() com guard via
-- pragma_table_info pra que esta migration seja idempotente em DBs
-- já provisionados.
--
-- O arquivo segue na lista pra documentar a intenção. Caso o banco
-- ainda não tenha a tabela `skills` (fresh install entre 009 e 010),
-- 009 cria + esta ALTER complementa. Quando ambos rodam, o guard
-- detecta a coluna e pula o ALTER sem falhar.

ALTER TABLE skills ADD COLUMN has_scripts INTEGER NOT NULL DEFAULT 0
    CHECK(has_scripts IN (0, 1));
