-- Skills v2: index relacional dos packages em ~/.genesis/skills/<name>/.
-- Mesma filosofia das outras tabelas tipo workflows/integrations: o
-- arquivo .md (SKILL.md aqui) é a source-of-truth do conteúdo, esta
-- tabela é só um mirror de metadata pra listagem rápida sem precisar
-- escanear o filesystem ou parsear N frontmatters.
--
-- Spec da task A2 listava ALTER TABLE pra adicionar 5 colunas (has_
-- assets, has_references, files_count, version, author), mas a
-- tabela `skills` NUNCA existiu — skills sempre foram file-only. Esta
-- migration cria a tabela do zero com TODAS as colunas que o spec
-- queria + identidade (id PK, name UNIQUE) + timestamps padrão.
--
-- Idempotente (CREATE ... IF NOT EXISTS). Re-rodar a migration não
-- duplica nem perturba ajustes manuais futuros.

CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    version TEXT NOT NULL DEFAULT '1.0',
    author TEXT,
    has_assets INTEGER NOT NULL DEFAULT 0 CHECK(has_assets IN (0, 1)),
    has_references INTEGER NOT NULL DEFAULT 0 CHECK(has_references IN (0, 1)),
    files_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);

CREATE TRIGGER IF NOT EXISTS trg_skills_updated_at
    AFTER UPDATE ON skills
    FOR EACH ROW
BEGIN
    UPDATE skills
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = OLD.id;
END;
