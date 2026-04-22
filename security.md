> 🏹 Gavião Arqueiro | 21/04/2026 | v1.0

# Security — Genesis

---

## 1. Contexto

Genesis é um app desktop local, single-user. Não há auth, multi-tenancy, ou APIs públicas. A superfície de ataque é menor que um SaaS web, mas existem preocupações específicas.

---

## 2. API Keys

### Armazenamento
- `OPENAI_API_KEY` — variável de ambiente do sistema ou arquivo `~/.genesis/.env`
- **Nunca** em código-fonte, Cargo.toml, ou package.json
- **Nunca** commitado no git — `.gitignore` inclui `.env`, `*.key`, `config.toml` com secrets
- Leitura via `std::env::var("OPENAI_API_KEY")` com fallback para config file

### Validação
- No startup, verificar se OPENAI_API_KEY está presente
- Se ausente, exibir tela de configuração (input para colar a key)
- Testar key com chamada mínima antes de salvar

---

## 3. Execução de Subprocessos

### Claude Code CLI
- Executar apenas `claude` (binário conhecido) — nunca montar path dinâmico a partir de input do usuário
- Argumentos sanitizados: prompt passado como argumento posicional, não interpolado em shell string
- `--output-format json` garante output parseável
- Timeout obrigatório por step (default 300s) — kill process se exceder
- Working directory fixo: `repo_path` do projeto (validado como existente)

### Bash Channel
- Comandos definidos na skill .md, não pelo usuário em runtime
- Mesmo assim, nunca usar `sh -c "string do user"` — usar array de argumentos
- Capturar stderr para diagnóstico, mas não exibir dados sensíveis (filtrar env vars)
- Limitar a comandos esperados (git, npm, ffmpeg, etc.) [INFERIDO — implementar allowlist no futuro]

### Sanitização
```rust
// CORRETO — argumentos separados
Command::new("claude")
    .arg("-p")
    .arg(&prompt)
    .arg("--output-format")
    .arg("json")

// ERRADO — shell injection possível
Command::new("sh")
    .arg("-c")
    .arg(format!("claude -p \"{}\"", prompt))
```

---

## 4. Filesystem

- Skills directory: acesso read/write via Tauri fs plugin com scope restrito
- Repo path: validar que existe e é diretório antes de operar
- **Nunca** escalar acesso fora dos diretórios configurados
- tauri.conf.json: configurar `fs` scope para restringir caminhos permitidos

```json
{
  "plugins": {
    "fs": {
      "scope": {
        "allow": [
          "$HOME/.genesis/**",
          "$RESOURCE/**"
        ]
      }
    }
  }
}
```

---

## 5. Dados Locais

- SQLite database em `~/.genesis/genesis.db`
- Contém: nomes de projetos, paths, logs de execução, mensagens de chat
- **Sem dados sensíveis** (não armazena API keys, senhas, PII de terceiros)
- WAL mode para integridade
- Backup simples: copiar arquivo .db

---

## 6. Comunicação de Rede

| Destino | Protocolo | Dados enviados |
|---------|-----------|----------------|
| OpenAI API | HTTPS | Prompts de orquestração (conteúdo de skills + contexto de tasks) |
| Canal API (futuro) | HTTPS | Configurável pela skill |

- Todas as chamadas via HTTPS (reqwest com TLS default)
- Sem chamadas a destinos não configurados
- Timeout de rede: 30s para OpenAI, configurável para canal API

---

## 7. Checklist Pre-Build

- [ ] API key não está no código-fonte
- [ ] `.env` no .gitignore
- [ ] Subprocess usa array de args, não shell string
- [ ] Timeout configurado em todos os canais
- [ ] tauri.conf.json com fs scope restrito
- [ ] Nenhum console.log com dados sensíveis no frontend
- [ ] SQLite em WAL mode
- [ ] Foreign keys habilitadas
