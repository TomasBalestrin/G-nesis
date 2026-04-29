-- Capabilities: tabela unificada de TUDO que o usuário invoca com @ no chat.
-- Dois tipos:
--   * native    — embarcado no app (terminal, code, etc.). `channel` aponta
--                 pro subprocess / CLI que o executor usa pra rodar a ação.
--   * connector — integração de terceiro (Slack, Notion, futuro). `channel`
--                 fica NULL; auth + endpoints moram no JSON `config`.
--
-- doc_ai é o trecho que entra no system prompt quando a capability é
-- mencionada — o modelo precisa saber o que ela faz e as regras de uso.
-- doc_user é o copy mostrado no picker do @, lido pelo humano.
--
-- enabled vira o toggle do dono (0 = oculto/desabilitado, 1 = ativo).

CREATE TABLE IF NOT EXISTS capabilities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL CHECK(type IN ('native', 'connector')),
    channel TEXT CHECK(channel IS NULL OR channel IN ('bash', 'claude-code', 'api')),
    config TEXT NOT NULL DEFAULT '{}',
    doc_ai TEXT NOT NULL DEFAULT '',
    doc_user TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_capabilities_name ON capabilities(name);
CREATE INDEX IF NOT EXISTS idx_capabilities_type ON capabilities(type);

CREATE TRIGGER IF NOT EXISTS trg_capabilities_updated_at
    AFTER UPDATE ON capabilities
    FOR EACH ROW
BEGIN
    UPDATE capabilities
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = OLD.id;
END;

-- Seeds: as 2 capabilities native que vêm com o app. INSERT OR IGNORE
-- mantém a migration idempotente — re-rodar não duplica nem sobrescreve
-- ajustes que o usuário tenha feito no doc/config depois.

INSERT OR IGNORE INTO capabilities
    (id, name, display_name, description, type, channel, doc_ai, doc_user)
VALUES
    (
        'cap_terminal',
        'terminal',
        'Terminal',
        'Comandos bash e ferramentas CLI instaladas localmente.',
        'native',
        'bash',
        'Executa comandos shell via bash na máquina do usuário. Use para operações de arquivo, ferramentas CLI (ffmpeg, imagemagick, jq, curl, pandoc, etc.), scripts e qualquer coisa que rodaria num terminal.

Regras:
- Prefira flags não-interativas (--yes, --quiet) quando disponíveis.
- Nunca rode comandos destrutivos (rm -rf, mv sem -i, dd, mkfs, drop database) sem confirmação explícita do usuário.
- Capture stdout pro resultado e stderr pro diagnóstico.
- Se um comando exigir input interativo, peça os dados pro usuário antes em vez de rodar com pipe.
- Use caminhos absolutos. Não dependa de cwd implícito.
- Em caso de erro, leia stderr + exit code antes de propor correção.',
        'Acesso ao terminal local — comandos bash e ferramentas instaladas (ffmpeg, jq, curl, etc.).'
    ),
    (
        'cap_code',
        'code',
        'Code',
        'Edição e análise de código via Claude Code CLI.',
        'native',
        'claude-code',
        'Delega tarefas de código pro Claude Code CLI: escrita, refactoring, debugging e análise multi-arquivo dentro de um projeto. Cada invocação é um prompt completo combinado com o contexto do repositório ativo.

Regras:
- Use quando o usuário pedir mudanças em código-fonte ou análise que cruze múltiplos arquivos.
- Não mantém estado entre chamadas — cada prompt deve ser auto-contido (incluir caminho do projeto, arquivos relevantes, objetivo).
- Para mudanças cirúrgicas (1-2 linhas), descreva o arquivo + linha exatamente. Para refactors maiores, descreva o objetivo + restrições e deixe o Claude Code planejar.
- A saída traz a explicação do que foi feito + diff/lista de arquivos tocados; reporte ao usuário em linguagem simples.',
        'Edição e análise de código — Claude Code lê o repositório e aplica mudanças.'
    );
