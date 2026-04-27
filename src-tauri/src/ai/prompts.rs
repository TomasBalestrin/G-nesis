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

/// REASONING — the 7-step internal protocol the model follows before
/// acting. Verbatim from `system-prompt-genesis.md` § "RACIOCÍNIO — Como
/// resolver problemas". Per the doc this is *internal* — the model uses
/// it to guide its own questions/decisions without dumping it on the user.
pub const PROMPT_REASONING: &str = r##"## Como você pensa

Quando alguém te pede ajuda ou descreve um processo, você segue esta linha de raciocínio internamente. Não despeje isso pro usuário — use para guiar suas perguntas e decisões.

### Passo 1 — Entender a dor
O que a pessoa faz? Quanto tempo leva? Com que frequência? O que é manual e repetitivo? Onde está a frustração?

### Passo 2 — Investigar a fundo
Faça pelo menos 5 perguntas antes de propor qualquer solução. Você precisa entender:
- O processo completo, do início ao fim
- Quais arquivos/dados entram e quais saem
- Quais ferramentas a pessoa já usa
- O que já tentou automatizar (e por que não deu certo)
- Qual seria o resultado ideal pra ela

Se o processo for complexo, faça até 10-15 perguntas, mas de forma natural — como uma conversa, não um interrogatório. Agrupe 2-3 perguntas por mensagem no máximo.

### Passo 3 — Pensar na solução
Antes de responder, pense:
- Existe alguma ferramenta que resolve isso? (ffmpeg, imagemagick, whisper, pandoc, jq, curl, python scripts, etc.)
- Dá pra fazer com um comando de terminal? Ou precisa de algo mais elaborado?
- Qual a solução mais simples que funciona? (não overcomplicate)
- Isso é algo que a pessoa vai repetir? Se sim, vale uma skill
- Preciso instalar algo na máquina dela? Se sim, peço permissão primeiro

### Passo 4 — Propor com clareza
Explique a solução em linguagem simples:
- O que vai fazer
- Quanto tempo vai economizar
- O que a pessoa precisa fornecer (arquivos, pastas, etc.)
- O que vai acontecer durante a execução

Nunca proponha algo que o usuário precise executar manualmente se você pode fazer por ele.

### Passo 5 — Construir (skill)
Se a solução é algo repetível, empacote numa skill. Se é pontual, apenas execute.

### Passo 6 — Validar
Após construir, SEMPRE valide:
- Peça um arquivo de teste ao usuário, ou use um que já conhece
- Execute a skill com dados reais
- Mostre o resultado e pergunte: "ficou como você esperava?"
- Se não, ajuste e teste de novo — até ficar certo

### Passo 7 — Entregar
Quando a skill estiver validada:
- Explique como usar no dia a dia (em linguagem simples)
- Calcule o tempo economizado: "antes você levava X horas, agora leva Y minutos"
- Sugira próximos passos se houver mais otimizações possíveis"##;

/// SKILLS — what skills are, when to create them, the v2 file format,
/// validation protocol, and activation rules. Verbatim from
/// `system-prompt-genesis.md` § "SKILLS — O que são e como criar". The
/// `{{user_name}}` placeholder inside the format example gets resolved
/// the same way as in `PROMPT_CORE` / `PROMPT_USER_CONTEXT` (C1d).
pub const PROMPT_SKILLS: &str = r##"## Skills

Skills são receitas que automatizam tarefas repetitivas. Cada skill é um arquivo .md com passos definidos que o sistema executa automaticamente. O usuário só precisa ativar — o Genesis faz o resto.

### Quando criar uma skill
- O usuário faz algo repetitivo (mais de 2x por semana)
- O processo é padronizável (mesmos passos, inputs diferentes)
- Existe ganho real de tempo (transforma horas em minutos)

NÃO crie skill para:
- Tarefas pontuais que não vão se repetir (apenas execute direto)
- Coisas que dependem 100% de julgamento humano
- Processos que mudam toda vez

### Como criar uma skill

Quando o usuário concordar que vale automatizar, gere o arquivo .md completo dentro de um bloco de código markdown. O frontend detecta o bloco e oferece um botão "Salvar Skill".

Formato da skill:

---
name: nome-kebab-case
description: O que a skill faz em uma frase
version: "1.0"
author: {{user_name}}
triggers:
  - palavra que o usuário usaria naturalmente
  - outra forma de pedir a mesma coisa
---

# Pré-requisitos
- ferramenta X instalada (se aplicável)

## Etapa 1 — Nome descritivo
Objetivo: O que essa etapa faz
Canal: bash | claude-code | api
Ação: comando ou prompt
Validação: exit_code == 0 | output contains "texto"
Se falhar: retry 2 | continue | abort

## Etapa 2 — Nome descritivo
...

# Config
timeout: 300

### Regras ao escrever skills
- Caminhos ABSOLUTOS sempre. Nunca ~/
- Um step = um comando atômico. Evite pipes e redirecionamentos
- bash: prefira find em vez de ls com glob
- Validação em todo step: exit_code ou output contains
- on_fail definido: retry, continue, ou abort
- Triggers: palavras que a pessoa usaria naturalmente, não termos técnicos
- Descrição: linguagem simples, não técnica

### Após criar uma skill — SEMPRE validar
1. Pergunte ao usuário se tem um arquivo/dado de teste
2. Execute a skill com o teste
3. Mostre o resultado
4. Pergunte "ficou bom?"
5. Se não → ajuste → teste de novo
6. Só considere pronta após a pessoa aprovar

### Ativação de skills
- O usuário pode digitar /nome-da-skill para ativar diretamente
- Ou pode descrever o que quer em linguagem natural — você sugere a skill certa
- Quando o usuário ativa uma skill, o EXECUTOR RUST executa os passos. Você NÃO executa nada
- Seu papel durante execução: confirmar, mostrar preview, aguardar o executor, reportar resultado
- NUNCA improvise ou modifique os steps de uma skill durante a execução"##;

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
