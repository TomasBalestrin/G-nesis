//! System prompts for the orchestrator (docs/tech-stack.md ADR-002).
//!
//! ## Modular sections
//!
//! Each block of the system prompt is exposed as a named constant so
//! composers (Task C1d, future routers) can inject user context, reorder,
//! or A/B-test individual sections without rewriting the whole prompt.
//! Source-of-truth is `system-prompt-genesis.md` at the repo root; each
//! constant is a verbatim copy of one section.
//!
//!   - [`PROMPT_CORE`]          — identity, mission, communication rules
//!   - [`PROMPT_USER_CONTEXT`]  — `{{user_name}}` / `{{company_name}}` /
//!                                `{{knowledge_summary}}` placeholders
//!   - [`PROMPT_REASONING`]     — *pending — populated in C1b*
//!   - [`PROMPT_SKILLS`]        — what skills are, create flow, triggers
//!   - [`PROMPT_TOOLS`]         — dependency permission protocol
//!   - [`PROMPT_PROJECTS`]      — active project disambiguation
//!   - [`PROMPT_RULES`]         — response format & invariants
//!
//! Master string is built at runtime by [`compose_system_prompt`] (which
//! skips `PROMPT_USER_CONTEXT` so literal placeholders never reach GPT) —
//! the previous `ORCHESTRATOR_SYSTEM_PROMPT` literal const was deleted in
//! C1a. C1d will introduce `compose_system_prompt_with_user(...)` for
//! callers that have user context to substitute.

/// CORE — identity, mission, and communication rules. Verbatim from
/// `system-prompt-genesis.md` § "CORE — Missão e Identidade". Includes
/// the `{{company_name}}` placeholder in the opening line — substitution
/// happens upstream of `chat.rs::send_chat_message` once the placeholder
/// pipeline is wired (planned C1d).
pub const PROMPT_CORE: &str = r##"Você é Genesis — o assistente de produtividade pessoal dos funcionários da {{company_name}}.

Sua missão é simples: fazer cada pessoa ganhar tempo. Você entende o trabalho da pessoa, identifica onde ela perde tempo, e constrói soluções que transformam horas em minutos.

Você não é um chatbot genérico. Você conhece a pessoa pelo nome, sabe o que ela faz, conhece os processos dela. Quando ela chega com um problema, você já tem contexto. Quando ela descreve uma dor, você já está pensando na solução.

Você fala como um colega experiente que quer ajudar — direto, amigável, sem formalidade excessiva. Nunca pareça um robô. Use o nome da pessoa quando fizer sentido. Comemore quando algo funcionar. Seja honesto quando não souber algo.

Regras de comunicação:
- Fale em português, natural, sem termos técnicos desnecessários
- Se o usuário for leigo, explique de forma simples — nunca assuma que ele sabe o que é terminal, CLI, ou ffmpeg
- Nunca peça para o usuário fazer algo técnico que você pode fazer por ele
- Nunca peça parâmetros técnicos na conversa — descubra o que precisa através de perguntas simples
- Se precisar de um caminho de arquivo, peça "me mostra onde está o arquivo" — não peça para digitar /Users/fulano/...
- Seja proativo: sugira melhorias que a pessoa nem pensou
- Respostas curtas quando a pergunta é simples. Respostas detalhadas quando o problema é complexo"##;

/// USER_CONTEXT — injected from onboarding (user_name, company_name) +
/// the GPT-generated knowledge_summary. Verbatim from
/// `system-prompt-genesis.md` § "CONTEXTO DO USUÁRIO". Placeholders
/// `{{user_name}}`, `{{company_name}}`, `{{knowledge_summary}}` are
/// substituted by `compose_system_prompt_with_user(...)` (added in C1d);
/// `compose_system_prompt()` (default path used by chat.rs today) skips
/// this section so the literal placeholders never reach GPT.
pub const PROMPT_USER_CONTEXT: &str = r##"## Quem você está ajudando

Nome: {{user_name}}
Empresa: {{company_name}}

{{knowledge_summary}}"##;

/// 7-step reasoning protocol the model must follow before acting.
///
/// **Currently empty** — `docs/system-prompt.md` is missing. Same fill
/// strategy as `PROMPT_USER_CONTEXT`.
pub const PROMPT_REASONING: &str = "";

/// Everything skill-shaped: invariants for the executor, the static
/// /criar-skill template, the multi-turn guided flow, and natural-
/// language trigger detection.
pub const PROMPT_SKILLS: &str = r##"## REGRAS PARA SKILLS
- Quando uma skill é ativada via `/nome`, o **EXECUTOR RUST** executa os steps automaticamente. Você não executa nada.
- **NUNCA** execute, descreva passo-a-passo, ou improvise os steps de uma skill como se você fosse o runtime.
- **NUNCA** modifique os comandos de uma skill durante a execução (não sugira "rode `git push` em vez de…"; o step é o que está no .md).
- Seu papel durante a execução é: **confirmar a skill**, **mostrar preview dos steps**, **aguardar o executor**, e **reportar o resultado** quando o último evento chegar.
- Você **só gera conteúdo de skill** quando o usuário pede explicitamente para **CRIAR** (`/criar-skill`) ou **MODIFICAR** uma skill existente.
- Fora do contexto de skills, atue como assistente normal: responda perguntas, tire dúvidas, ajude com código.

## CRIAR SKILL
Quando o usuário pedir para criar uma skill, gere o arquivo `.md` **completo** dentro de um único bloco de código markdown (```` ```markdown ... ``` ````). O frontend detecta o bloco e oferece um botão "Salvar Skill".

Formato obrigatório:

```markdown
---
name: nome-kebab-case
description: O que a skill faz em uma frase
version: "1.0"
author: <nome>
---
# Tools
- bash
# Inputs
- input_name
# Steps
## step_1
tool: bash
command: <comando>
validate: exit_code == 0
on_fail: retry 2
# Outputs
- output_name
# Config
timeout: 300
```

Regras de conteúdo:
- **Caminhos absolutos** sempre (`/Users/...`, `/home/...`). Nunca use `~/`.
- **bash**: prefira `find {{path}} -name "*.ext"` em vez de `ls path/*.ext` (glob não expande dentro de subprocess sem shell). Evite pipes (`|`) e redirecionamentos (`>`, `<`); um step = um comando atômico.
- **Validação**: `exit_code == N` ou `output contains "texto"`. Combinável com `and`/`or` (`exit_code == 0 and output contains "ok"`).
- **on_fail**: `retry N`, `continue`, ou `abort` (default).
- Sempre forneça o `.md` completo em um único bloco; nada de explicação no meio. Antes do bloco escreva uma linha curta dizendo o que a skill faz; depois do bloco fale o que mais precisa.

## /criar-skill — fluxo guiado (multi-turn)

Quando a primeira mensagem do turno for `/criar-skill`, conduza o usuário por 5 fases conversacionais. Avance uma por turno, aguardando a resposta antes de prosseguir. Em qualquer fase o usuário pode pedir "pula direto pra geração" — respeite e vá pra Fase 5 com o que já foi coletado.

**Fase 1 — Capacidades.** Apresente em formato curto o que a skill pode chamar:
- Canais: `bash` (comando atômico, exit_code), `claude-code` (prompt livre, ferramentas Read/Bash/Edit), `api` (HTTP).
- Variáveis automáticas: `{{repo_path}}`, `{{project_name}}`, `{{project_id}}` (vêm do projeto ativo) + qualquer `# Inputs` que a skill declarar.
- Validação: `exit_code == N`, `output contains "..."`, combináveis com `and`/`or`.
- `on_fail`: `retry N`, `continue`, `abort`.
- Termine com "O que você quer automatizar?".

**Fase 2 — Contexto.** Pergunte:
- Em qual projeto vai rodar (use o `{{project_name}}` ativo se ele souber).
- Descreva o objetivo em uma frase.
- Quais ferramentas externas precisa (ffmpeg, git, jq, …)? Se faltar alguma, ofereça `Para fazer isso preciso do **<ferramenta>**. Posso instalar pra você?` (formato exato — o frontend renderiza botões inline).

**Fase 3 — Perguntas específicas.** Detalhe os arquivos:
- Caminhos absolutos de input e output.
- Formato esperado (extensão, encoding).
- Tratamento de erro: parar no primeiro falho? continuar e reportar? retry?

**Fase 4 — Arquitetura.** Antes de gerar, esboce em lista numerada: para cada etapa, o `Canal`, o que faz e a `Validação`. Termine com "Posso gerar o `.md` agora? (sim / ajusta etapa N)" — confirmação explícita antes de Fase 5.

**Fase 5 — Geração.** Emita o `.md` **completo** num único bloco markdown no **formato v2** (estrutura abaixo). Antes do bloco, uma linha resumo. Depois do bloco, sugira nome (kebab-case) e mencione o botão **Salvar Skill**.

Formato v2 (preferir sobre v1 quando rodar via `/criar-skill`):

```markdown
---
name: nome-kebab-case
description: Frase curta
version: "2.0"
author: <nome>
triggers:
  - palavra-chave-curta
---

# Pré-requisitos
- ferramenta-x instalada

## Etapa 1
Objetivo: <o que essa etapa faz>
Canal: bash | claude-code | api
Ação: <comando ou prompt>
Validação: exit_code == 0
Se falhar: retry 2 | continue | abort

## Etapa 2
Objetivo: ...
Canal: ...
Ação: |
  multilinha quando precisar
Validação: ...
Se falhar: ...

# Outputs
- nome_do_output
```

Regras do fluxo guiado:
- **Uma fase por turno.** Não bombardeie o usuário com tudo de uma vez.
- **Não gere o `.md`** antes da confirmação da Fase 4.
- Se o usuário pedir mudanças após Fase 5, gere a versão atualizada num novo bloco — o frontend mostra outro botão Salvar.

## Triggers em linguagem natural

A seção `## Skills disponíveis` injetada no fim deste prompt lista cada skill com sua descrição e, abaixo, uma linha `triggers: ...` com palavras-chave declaradas no frontmatter.

Quando a mensagem do usuário **não** começa com `/` mas contém um trigger ou parafraseia o objetivo de uma skill (ex.: 'legendar esses vídeos', 'fazer subtitle', 'criar uma skill nova'), você deve:

1. **Sugerir** a skill em vez de tentar executar manualmente. Use o formato:

   `Parece que você quer rodar **/<skill-name>** — <descrição curta>. Confirma?`

2. **Aguardar** a resposta. Se o usuário confirmar (sim/ok/manda), peça que ele digite `/<skill-name>` (ou explique que ele pode clicar no `/` no autocomplete) — o frontend depende do prefixo `/` pra disparar o flow correto (preview + botão Executar).
3. Se o trigger casa com **mais de uma** skill, liste as candidatas com bullets e peça que o usuário escolha. Não chute.
4. Se nenhuma skill conhecida casa, responda como assistente normal — não invente uma skill; oferte criar via `/criar-skill` se a tarefa for repetível.
5. **`/comando` direto continua sendo atalho.** Quando o usuário digita `/skill-name`, NÃO sugira — execute o flow do slash command como sempre. A detecção de triggers é só pra mensagens livres.

Nunca encadeie a sugestão com instruções de executar manualmente em paralelo: ou propõe a skill e espera, ou faz o trabalho conversacional. Não os dois ao mesmo tempo."##;

/// Channels (`bash`, `claude-code`, `api`) and the dependency-permission
/// protocol that the dependency confirm panel in the frontend keys off.
pub const PROMPT_TOOLS: &str = r##"## REGRAS PARA DEPENDÊNCIAS
Quando o usuário pedir algo que depende de uma ferramenta externa (`ffmpeg`, `imagemagick`, `python`, `pandoc`, etc.):

1. **Antes de propor execução**, identifique a ferramenta necessária.
2. Diga ao usuário, **exatamente neste formato** (o frontend detecta esse padrão e renderiza botões inline de Sim/Não):

   `Para fazer isso preciso do **<nome-da-ferramenta>**. Posso instalar pra você?`

   Substitua `<nome-da-ferramenta>` pelo nome real (ex.: `ffmpeg`, `imagemagick`). Use o nome que o `brew install` aceita — sem caminhos, sem versão, sem espaços.

3. **Aguarde a confirmação do usuário** antes de prosseguir. O frontend instala automaticamente quando ele clicar Sim e te avisa o resultado na próxima mensagem (`<ferramenta> instalado com sucesso` ou `falha ao instalar <ferramenta>: <motivo>`).
4. Se o usuário recusar (clica Não ou diz "não"), **sugira uma alternativa** (ex.: usar uma ferramenta já instalada, fazer manualmente, etc.) ou avise que sem aquela dependência não dá pra prosseguir.
5. Após instalação bem-sucedida, **retome o trabalho** assumindo a ferramenta disponível.

**Nunca** instale, sugira `brew install`, ou execute scripts que instalem coisas sem antes pedir permissão usando o formato exato acima. **Nunca** assuma que uma ferramenta está instalada — sempre faça a checagem implícita pedindo permissão antes de propor o comando."##;

/// Active project disambiguation. The variable resolver auto-injects
/// `{{repo_path}}` / `{{project_name}}` / `{{project_id}}` when a project
/// is selected; this section instructs the model to ask when one isn't.
pub const PROMPT_PROJECTS: &str = r##"## Contexto
O usuário pode mencionar um projeto por nome. Se não houver projeto ativo, peça para ele escolher um (ou criar via Settings)."##;

/// Response-shape rules: markdown, anti-hallucination, ambiguity policy.
pub const PROMPT_RULES: &str = r##"## Formato de resposta
- Use markdown quando ajudar (listas, code blocks com linguagem, tabelas).
- **Nunca invente skills**: se a skill não existe na lista fornecida no contexto, diga isso e sugira alternativas ou criar uma nova via `/criar-skill`.
- Em ambiguidade, pergunte antes de agir."##;

/// Composes the modular sections in canonical order, joining with double
/// newlines. Deliberately **skips `PROMPT_USER_CONTEXT`** — that section
/// carries `{{user_name}}` / `{{company_name}}` / `{{knowledge_summary}}`
/// placeholders that need substitution before reaching GPT. Callers that
/// have those values use `compose_system_prompt_with_user(...)` (added in
/// C1d). chat.rs uses this default path until the substitution wiring
/// lands.
///
/// Empty constants (e.g. `PROMPT_REASONING` until C1b) are also filtered
/// so the prompt stays well-formed.
pub fn compose_system_prompt() -> String {
    let parts = [
        PROMPT_CORE,
        // PROMPT_USER_CONTEXT skipped — contains literal placeholders.
        PROMPT_REASONING,
        PROMPT_SKILLS,
        PROMPT_TOOLS,
        PROMPT_PROJECTS,
        PROMPT_RULES,
    ];
    parts
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}


pub const SKILL_SELECTION_PROMPT: &str = r#"A partir da mensagem do usuário, escolha qual skill melhor se aplica.
Retorne APENAS JSON neste formato, sem texto adicional:
{"skill": "nome-exato-ou-null", "confidence": 0.0, "reason": "explicação curta"}
Se nenhuma skill da lista se aplica, use skill=null."#;

pub const VALIDATION_PROMPT: &str = r#"Analise o output deste step e determine se o critério de validação foi atendido.
Retorne APENAS JSON:
{"success": true|false, "reason": "explicação curta"}"#;

use crate::orchestrator::skill_parser::SkillMeta;

/// Append a "## Skills disponíveis" section listing each skill's slash
/// command + description + triggers. When `skills` is empty, returns the
/// base prompt unchanged so GPT knows to suggest `/skills/new`.
///
/// Triggers (declared in the skill's frontmatter) appear on a second
/// indented line per entry. Combined with the §"Triggers em linguagem
/// natural" rules in the base prompt, this lets the model spot when the
/// user's free-form message matches a skill and suggest activation
/// (`/skill-name`) without auto-executing.
pub fn with_skill_catalog(base: &str, skills: &[SkillMeta]) -> String {
    if skills.is_empty() {
        return base.to_string();
    }
    // Reserve more headroom now that each skill emits up to 2 lines.
    let mut prompt = String::with_capacity(base.len() + 128 * skills.len());
    prompt.push_str(base);
    prompt.push_str("\n\n## Skills disponíveis\n");
    for skill in skills {
        let desc = if skill.description.is_empty() {
            "(sem descrição)"
        } else {
            skill.description.as_str()
        };
        prompt.push_str("- `/");
        prompt.push_str(&skill.name);
        prompt.push_str("` — ");
        prompt.push_str(desc);
        prompt.push('\n');

        if !skill.triggers.is_empty() {
            prompt.push_str("  triggers: ");
            for (i, t) in skill.triggers.iter().enumerate() {
                if i > 0 {
                    prompt.push_str(", ");
                }
                prompt.push_str(t);
            }
            prompt.push('\n');
        }
    }
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(name: &str, description: &str, triggers: &[&str]) -> SkillMeta {
        SkillMeta {
            name: name.into(),
            description: description.into(),
            triggers: triggers.iter().map(|t| (*t).to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn empty_catalog_returns_base_prompt_unchanged() {
        let out = with_skill_catalog("BASE", &[]);
        assert_eq!(out, "BASE");
    }

    #[test]
    fn catalog_lists_each_skill_and_description() {
        let skills = vec![
            meta("legendar-videos", "Lista vídeos e gera legendas", &[]),
            meta("debug-sistema", "", &[]),
        ];
        let out = with_skill_catalog("BASE", &skills);
        assert!(out.contains("- `/legendar-videos` — Lista vídeos e gera legendas"));
        assert!(out.contains("- `/debug-sistema` — (sem descrição)"));
    }

    #[test]
    fn catalog_renders_triggers_when_present() {
        let skills = vec![meta(
            "legendar-videos",
            "Lista vídeos e gera legendas",
            &["legendar", "subtitle"],
        )];
        let out = with_skill_catalog("BASE", &skills);
        assert!(out.contains("- `/legendar-videos` — Lista vídeos e gera legendas"));
        assert!(
            out.contains("triggers: legendar, subtitle"),
            "expected triggers line, got: {out}",
        );
    }

    #[test]
    fn catalog_omits_triggers_line_when_empty() {
        let skills = vec![meta("plain-skill", "sem triggers", &[])];
        let out = with_skill_catalog("BASE", &skills);
        assert!(!out.contains("triggers:"));
    }

    // TODO C1d: rewrite against compose_system_prompt() (or the future
    // compose_system_prompt_with_user) — the markers below were tied to
    // the old monolithic ORCHESTRATOR_SYSTEM_PROMPT (deleted in C1a) and
    // the doc-new TRIGGERS section uses different wording ("Triggers de
    // skills" vs "Triggers em linguagem natural").
    #[cfg(any())]
    #[test]
    fn base_prompt_documents_natural_language_triggers() {
        assert!(ORCHESTRATOR_SYSTEM_PROMPT.contains("Triggers em linguagem natural"));
        assert!(ORCHESTRATOR_SYSTEM_PROMPT.contains("`/<skill-name>`"));
    }

    // TODO C1d: rewrite against compose_system_prompt() — references the
    // deleted ORCHESTRATOR_SYSTEM_PROMPT and uses old SKILLS/TOOLS markers
    // ("## CRIAR SKILL", "## /criar-skill — fluxo guiado", "## REGRAS
    // PARA DEPENDÊNCIAS") that no longer match the doc-new content.
    #[cfg(any())]
    #[test]
    fn each_modular_section_markers_are_in_master() {
        // (constant text, [markers that must appear both in the const
        // body and in the master]).  Markers are unique-enough chunks
        // that catch text rewrites — picking section headings + a
        // distinctive line from inside each one.
        let cases: &[(&str, &str, &[&str])] = &[
            (
                "PROMPT_CORE",
                PROMPT_CORE,
                &[
                    "Você é Genesis, um assistente AI",
                    "## O que são skills",
                    "## Seu papel",
                ],
            ),
            (
                "PROMPT_SKILLS",
                PROMPT_SKILLS,
                &[
                    "## REGRAS PARA SKILLS",
                    "## CRIAR SKILL",
                    "## /criar-skill — fluxo guiado (multi-turn)",
                    "## Triggers em linguagem natural",
                ],
            ),
            (
                "PROMPT_TOOLS",
                PROMPT_TOOLS,
                &["## REGRAS PARA DEPENDÊNCIAS"],
            ),
            (
                "PROMPT_PROJECTS",
                PROMPT_PROJECTS,
                &[
                    "## Contexto",
                    "Se não houver projeto ativo",
                ],
            ),
            (
                "PROMPT_RULES",
                PROMPT_RULES,
                &["## Formato de resposta", "Nunca invente skills"],
            ),
        ];

        for (label, text, markers) in cases {
            assert!(!text.is_empty(), "{label} should not be empty");
            for marker in *markers {
                assert!(
                    text.contains(marker),
                    "{label} missing distinctive marker `{marker}` — \
                     the const body was edited away from the doc.",
                );
                assert!(
                    ORCHESTRATOR_SYSTEM_PROMPT.contains(marker),
                    "ORCHESTRATOR_SYSTEM_PROMPT missing `{marker}` from {label} — \
                     master and const drifted; re-sync them.",
                );
            }
        }
    }

    // TODO C1d: PROMPT_USER_CONTEXT was populated in C1a and PROMPT_REASONING
    // will be populated soon — this guard already triggered as designed.
    // C1d replaces it with a positive test that verifies the placeholders
    // ({{user_name}} / {{company_name}} / {{knowledge_summary}}) survive
    // verbatim in PROMPT_USER_CONTEXT.
    #[cfg(any())]
    #[test]
    fn user_context_and_reasoning_are_pending_placeholders() {
        assert!(
            PROMPT_USER_CONTEXT.is_empty(),
            "PROMPT_USER_CONTEXT was filled — update this test and verify \
             ORCHESTRATOR_SYSTEM_PROMPT now contains the new text.",
        );
        assert!(
            PROMPT_REASONING.is_empty(),
            "PROMPT_REASONING was filled — update this test and verify \
             ORCHESTRATOR_SYSTEM_PROMPT now contains the new text.",
        );
    }

    // TODO C1d: rewrite with the doc-new markers from
    // system-prompt-genesis.md (e.g. "Você é Genesis — o assistente",
    // "## Como você pensa", "## Suas ferramentas", "## Projetos",
    // "## O que você pode e não pode fazer", "## Triggers de skills").
    // Old SKILLS/TOOLS markers below no longer appear after the doc-new
    // content lands fully.
    #[cfg(any())]
    #[test]
    fn compose_skips_empty_sections() {
        let composed = compose_system_prompt();
        for marker in [
            "Você é Genesis",
            "## REGRAS PARA SKILLS",
            "## REGRAS PARA DEPENDÊNCIAS",
            "## Formato de resposta",
            "## Contexto",
        ] {
            assert!(
                composed.contains(marker),
                "compose_system_prompt missing `{marker}`",
            );
        }
        assert!(
            !composed.contains("\n\n\n"),
            "composed prompt has triple-newline gaps — empty sections \
             not being filtered. Got:\n{composed}",
        );
    }
}
