# Skill Format v2.0 — Genesis

Especificação do novo formato de skills do Genesis, em vigor a partir
da versão `2.0`. Substitui o `.md` solto de v1 por uma **pasta** com
um ponto de entrada (`SKILL.md`) e três áreas de suporte
(`references/`, `scripts/`, `assets/`).

**Status:** especificação. O parser v1 continua funcionando — skills
existentes não quebram. Novas skills devem nascer em v2.

---

## Sumário

1. [Por que mudar de v1 pra v2](#1-por-que-mudar-de-v1-pra-v2)
2. [Anatomia da pasta](#2-anatomia-da-pasta)
3. [Progressive disclosure](#3-progressive-disclosure)
4. [Formato do SKILL.md](#4-formato-do-skillmd)
5. [Etapas descritivas](#5-etapas-descritivas)
6. [`@` capabilities e `#` caminhos](#6--capabilities-e--caminhos)
7. [Comparativo v1 vs v2](#7-comparativo-v1-vs-v2)
8. [Migração de uma skill v1 pra v2](#8-migração-de-uma-skill-v1-pra-v2)

---

## 1. Por que mudar de v1 pra v2

O `.md` solto da v1 acoplava 3 coisas num único arquivo: prompt do
modelo, scripts shell inline e parâmetros de execução. Skills grandes
viraram ilegíveis e o modelo gastava tokens lendo passos que ele ainda
nem ia executar.

**v2 separa por responsabilidade e por necessidade de leitura:**

| Camada | Quem lê | Quando lê |
|---|---|---|
| `SKILL.md` | Modelo + humano | Sempre que a skill é considerada |
| `references/` | Modelo | Só quando `SKILL.md` aponta pra ela |
| `scripts/` | Executor (bash) | Só quando uma etapa chama o script |
| `assets/` | Templates / dados | Só quando uma etapa precisa deles |

Resultado: o modelo decide ATIVAR a skill com base em ~30 linhas
(`SKILL.md`), e só puxa o resto quando vai executar. Tokens caros
ficam pra quando o trabalho realmente começa.

---

## 2. Anatomia da pasta

```
~/.genesis/skills/
└── legendar-videos/
    ├── SKILL.md             # entry point — sempre lido pelo modelo
    ├── references/
    │   ├── ffmpeg-flags.md  # cheat-sheet de flags pro modelo consultar
    │   └── api-limits.md    # limites da Whisper API
    ├── scripts/
    │   ├── extract-audio.sh
    │   └── chunk-mp3.sh
    └── assets/
        ├── cover-template.svg
        └── progress-bar.gif
```

**Regras:**

- `SKILL.md` é **obrigatório**. Tudo o mais é opcional.
- Scripts **devem** viver em `scripts/`. Nada de comando shell
  inline na descrição da etapa (parser v2 rejeita `bash -c "..."`
  no `command:` por causa das limitações herdadas da v1 — sem
  pipes, sem expansão de `~`, etc.).
- Cada arquivo em `references/` é uma unidade que o modelo pode
  abrir via `read_file`. Tente uma página por tópico (ex:
  `ffmpeg-flags.md` separado de `whisper-api.md`), 200-400 linhas
  no máximo.
- `assets/` aceita qualquer extensão — templates, imagens, JSON
  de exemplo, schemas. O `repo_path` da skill (a pasta inteira)
  fica disponível como variável `{{skill_path}}` nas etapas.

---

## 3. Progressive disclosure

Princípio: **o modelo nunca recebe mais informação do que precisa
pra decidir o próximo passo.** Inspirado em como o Claude Skills da
Anthropic carrega secondary references — só quando solicitado.

### Camadas de informação por turno

```
turno 1 — usuário escreve:    "@legendar-videos esse arquivo aqui"
                              ↓
modelo recebe:                 SKILL.md (≈ 200-500 tokens)
                              ↓
modelo decide:                 ativar a skill, mas precisa do schema
                              da Whisper API
                              ↓
modelo emite tool call:        read_file(skill_path/references/api-limits.md)
                              ↓
backend retorna:               conteúdo do arquivo (≈ 800 tokens)
                              ↓
modelo executa:                etapas com contexto suficiente
```

Sem essa hierarquia, o modelo precisaria carregar TODOS os references
no system prompt da skill ativa, mesmo os que ele nunca vai consultar.
Em skills grandes (whisper, ffmpeg, claude-code wrappers) isso vira
~10k tokens por turno só de boilerplate.

### Quando criar uma reference vs inline no SKILL.md

| Põe inline no SKILL.md | Move pra `references/` |
|---|---|
| Regra que **toda** etapa segue | Cheat-sheet consultado em uma etapa específica |
| < 5 linhas | > 10 linhas |
| Crítico pra ativar a skill | Útil só durante execução |
| Muda toda a forma da etapa | Detalhe de uma flag / parâmetro |

Quando em dúvida: comece inline. Promova pra `references/` quando o
`SKILL.md` passar de 100 linhas.

---

## 4. Formato do SKILL.md

### Estrutura mínima

```markdown
---
name: legendar-videos
description: Gera legendas .srt de qualquer vídeo via Whisper API
version: "2.0"
author: maria
---

# Quando usar

Ativada quando o usuário pede legendas, transcrição ou subtítulo de
um arquivo de vídeo. Suporta MP4, MOV, MKV.

# Pré-requisitos

- @terminal pra rodar ffmpeg
- Whisper API key configurada em `~/.genesis/config.toml`

# Etapas

## extract-audio
Extrai a faixa de áudio do vídeo de entrada para um MP3 de baixa taxa.
Use o script `scripts/extract-audio.sh` passando o vídeo de origem
e o caminho de saída.

## transcribe
Manda o MP3 pra Whisper API e salva a resposta SRT.
Se o áudio passar de 25MB, divida em chunks (ver
`references/api-limits.md`) antes de mandar.

## save-output
Salva o `.srt` final na mesma pasta do vídeo de origem com o mesmo
nome base.

# Outputs

- `<video>.srt` ao lado do vídeo original
```

### Frontmatter obrigatório

```yaml
---
name: kebab-case-only
description: Uma linha — vai pro picker do @ e pro index do modelo
version: "2.0"      # discriminador da versão do parser
author: usuario     # quem escreveu
---
```

Campos opcionais:
- `triggers: [legendar, subtítulo]` — palavras que ativam sugestão
  da skill mesmo sem o usuário digitar `@nome`.
- `tags: [video, audio]` — categorização pra UI da settings.
- `requires: [@terminal, @code]` — capabilities que a skill assume
  estarem habilitadas. Skill é escondida quando alguma `required`
  estiver com `enabled = 0`.

### Seções obrigatórias

| Seção | Conteúdo |
|---|---|
| `# Quando usar` | 2-4 linhas em prosa. O modelo lê isso pra decidir ativar. |
| `# Etapas` | Lista de `## etapa-nome` em prosa descritiva (ver §5). |

### Seções opcionais

- `# Pré-requisitos` — capabilities, paths, env vars.
- `# Outputs` — o que a skill produz (arquivos, mensagens, side
  effects). Útil pro modelo reportar resultado ao usuário.
- `# Erros conhecidos` — falhas observadas + correção sugerida.
  Encurta o ciclo de `step_failed → analyze_step_failure → análise`.

---

## 5. Etapas descritivas

A diferença mais radical entre v1 e v2: **etapas em v2 são prosa
direcionada ao executor, não DSL com campos.**

### v1 (DSL estruturada)

```
## step_1
tool: bash
command: bash /Users/bruno/.genesis/scripts/extract-audio.sh {{repo_path}}
validate: exit_code == 0
on_fail: retry(2)
```

### v2 (prosa)

```markdown
## extract-audio
Roda o script `scripts/extract-audio.sh` passando o caminho do
vídeo de origem (recebido como input) e gravando o MP3 em
`/tmp/<nome>.mp3`. Se falhar, repita uma vez com `-y` pra
sobrescrever artefatos parciais antes de abortar.
```

O modelo **traduz** a etapa em uma chamada apropriada (tool call
para `execute_skill` / `read_file` / `bash` via @terminal capability)
em runtime. Vantagens:

- Skill autora descreve **intenção**, não sintaxe shell. Skills
  legíveis por humanos não-técnicos.
- Mudança de canal (bash → claude-code → api) não exige rewrite
  da skill; o modelo escolhe baseado nas capabilities mencionadas.
- O parser v2 NÃO valida campos `validate:` / `on_fail:` /
  `retry:` — essas decisões viram função do GPT lendo a prosa.

### Convenções de prosa pra etapa

- **Comece com um verbo no infinitivo** (`Roda`, `Lê`, `Manda`,
  `Salva`).
- **Mencione caminhos de arquivo entre crases** quando referenciar
  scripts/refs da própria skill.
- **Encadeie condições** com "Se ... então ..." em vez de criar
  ramificação separada.
- **Limite a 3-5 linhas por etapa.** Lógica complexa vai pro
  script `.sh` ou pra reference que a etapa cita.

---

## 6. `@` capabilities e `#` caminhos

V2 herda os triggers de mention introduzidos no chat (D1-D3).

### `@nome-da-capability`

Marca **qual capability deve ser usada pra esta etapa**. O modelo
resolve `@terminal` para o canal `bash`, `@code` para `claude-code`,
etc. — e o doc_ai da capability é injetado no system prompt
automaticamente quando ela é mencionada.

```markdown
## install-deps
Use @terminal pra rodar `npm install` na raiz do projeto. Se o
projeto for monorepo (existir `pnpm-workspace.yaml`), use
`pnpm install -r` em vez disso.
```

Múltiplas capabilities por etapa são permitidas:

```markdown
## refactor
Combine @code (lê o arquivo, propõe diff) com @terminal (roda
`npm test` depois pra validar).
```

### `#nome-do-caminho`

Aponta a etapa pra um **caminho cadastrado** (ver `commands/caminhos.rs`).
O modelo trata como contexto: usa o `repo_path` daquele caminho como
`cwd` quando dispara comandos.

```markdown
## extract-audio
Pega o vídeo de #meu-projeto/raw-uploads/ e gera o MP3 em
#meu-projeto/processed/.
```

`#meu-projeto` resolve pra `repo_path` do caminho registrado. Se o
caminho não existe, o modelo deve avisar o usuário antes de
inventar um path.

### Combinando @ e #

```markdown
## test-flow
Use @terminal pra rodar `npm test` em #frontend e #backend em
paralelo. Se algum falhar, abra @code com o output do erro pra
sugerir fix.
```

---

## 7. Comparativo v1 vs v2

| Aspecto | v1 (`1.0`) | v2 (`2.0`) |
|---|---|---|
| Unidade | 1 arquivo `.md` | 1 pasta com `SKILL.md` + subpastas |
| Frontmatter | `version: "1.0"` (string ou number) | `version: "2.0"` (string obrigatória) |
| Steps | DSL com `tool:`, `command:`, `validate:`, `on_fail:` | Prosa descritiva por etapa |
| Scripts | Inline `command:` ou path manual | Pasta `scripts/` com convenção |
| Validação | `exit_code == 0` / `output contains "x"` | Avaliação pelo modelo via prosa |
| Tools | `# Tools` declara canais usados | `@capabilities` na etapa que precisa |
| Inputs | `# Inputs` lista variáveis | Mention `#caminho` ou prosa direta |
| Progressive disclosure | Nada — tudo carregado de uma vez | `references/` carrega sob demanda |
| Outputs | `# Outputs` (free-form) | `# Outputs` (free-form, idem) |
| Erros conhecidos | Não documentado | Seção dedicada `# Erros conhecidos` |
| Tamanho típico | 50-300 linhas em 1 arquivo | 30-80 linhas em `SKILL.md` + N refs |

**Compatibilidade:** o parser detecta a versão pelo frontmatter
`version`. `1.0`/`1.x` segue o pipeline v1; `2.0` segue v2. Não há
auto-conversão — migrar exige reescrita manual.

---

## 8. Migração de uma skill v1 pra v2

### Passo a passo

1. **Crie a pasta.** `~/.genesis/skills/<nome>/` (mesmo nome do
   arquivo `.md` antigo, sem extensão).
2. **Mova scripts inline pra `scripts/`.** Se a skill v1 tinha
   `command: bash /path/to/script.sh ...`, o conteúdo vira
   `scripts/<nome>.sh` na pasta.
3. **Quebre referências longas.** Qualquer bloco de
   "explicação/cheat-sheet/limites" com mais de 10 linhas dentro
   de um `context:` da v1 vira um arquivo em `references/`.
4. **Reescreva os steps em prosa.** Cada `## step_N` da v1 vira
   `## etapa-nome` em v2 com 2-4 linhas em português descrevendo
   o que fazer. Substitua `tool: bash` por `Use @terminal`,
   `tool: claude-code` por `Use @code`, etc.
5. **Atualize o frontmatter.** `version: "2.0"`.
6. **Salve `SKILL.md`.** O arquivo `.md` antigo pode ser
   deletado depois que a v2 for testada.

### Exemplo: `legendar-videos.md` (v1) → `legendar-videos/` (v2)

**Antes (v1, ~120 linhas):**
```
~/.genesis/skills/legendar-videos.md
```

**Depois (v2):**
```
~/.genesis/skills/legendar-videos/
├── SKILL.md              # 45 linhas — quando usar + 3 etapas em prosa
├── references/
│   └── api-limits.md     # 30 linhas — limites da Whisper, formatos aceitos
└── scripts/
    ├── extract-audio.sh  # ffmpeg call
    └── chunk-mp3.sh      # divide MP3 em pedaços < 25MB
```

A skill em si fica metade do tamanho (45 linhas no SKILL.md vs 120
no .md v1), com a outra metade movida pra references e scripts que
só são puxados durante execução.

---

## Referência rápida

```markdown
---
name: minha-skill
description: O que faz, em uma linha
version: "2.0"
author: seu-nome
triggers: [palavra-chave-1, palavra-chave-2]
---

# Quando usar
Prosa curta — 2-4 linhas — sobre quando ativar.

# Pré-requisitos
- @capability1, @capability2
- Algum env var

# Etapas

## etapa-1
Verbo descrição. Use @terminal / @code conforme necessário.
Se condição X, faça Y.

## etapa-2
Continua a partir do output da etapa-1.

# Outputs
- arquivo / mensagem / side effect

# Erros conhecidos
- Erro X → causa Y → correção Z
```
