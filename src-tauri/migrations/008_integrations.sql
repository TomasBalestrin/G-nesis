-- Integrations: metadata index of REST APIs the chat can hit via @<name>.
-- Source-of-truth para auth + api_key é ~/.genesis/config.toml em
-- [integrations.<name>]; esta tabela é a réplica relacional pra list/get
-- rodar rápido sem parsear TOML. API KEY *NUNCA* mora aqui — fica
-- exclusivamente no config.toml.
--
-- auth_type guarda só o DISCRIMINADOR ('bearer', 'header', 'query'); os
-- nomes específicos de header / query param ficam no TOML. Renomear um
-- header não dispara migration.
--
-- last_used_at alimenta o picker (sort por recência); touch_last_used
-- atualiza o campo quando a integração é invocada.
--
-- Migration idempotente: re-rodar não duplica nem clobbera ajustes manuais.

CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    auth_type TEXT NOT NULL DEFAULT 'bearer'
        CHECK(auth_type IN ('bearer', 'header', 'query')),
    spec_file TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    last_used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_integrations_name ON integrations(name);
CREATE INDEX IF NOT EXISTS idx_integrations_enabled ON integrations(enabled);
