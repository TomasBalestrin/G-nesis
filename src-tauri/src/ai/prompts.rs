//! System prompts for the orchestrator (docs/tech-stack.md ADR-002).
//!
//! ## Modular sections
//!
//! Each block of the system prompt is exposed as a named constant so
//! composers can inject user context, reorder, or A/B-test individual
//! sections without rewriting the whole prompt. Source-of-truth is
//! `system-prompt-genesis.md` at the repo root; each constant is a
//! verbatim copy of one section.
//!
//!   - [`PROMPT_CORE`]          — identity, mission, communication rules
//!   - [`PROMPT_USER_CONTEXT`]  — `{{user_name}}` / `{{company_name}}` /
//!                                `{{knowledge_summary}}` placeholders
//!   - [`PROMPT_REASONING`]     — internal 7-step problem-solving protocol
//!   - [`PROMPT_SKILLS`]        — what skills are, create flow, activation
//!   - [`PROMPT_TOOLS`]         — bash/claude-code/api channels + deps
//!   - [`PROMPT_PROJECTS`]      — active project disambiguation
//!   - [`PROMPT_RULES`]         — pode/não pode/tom
//!
//! Master string is built at runtime by [`compose_system_prompt`], which
//! skips [`PROMPT_USER_CONTEXT`] so literal placeholders never reach GPT.
//! Callers that have user context to substitute should use
//! `compose_system_prompt_with_user(...)` (added in a follow-up task).

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

/// TOOLS — capabilities exposed via the channels (`bash`, `claude-code`,
/// `api`) plus the dependency-permission protocol the frontend detects
/// to render inline Sim/Não buttons. Verbatim from
/// `system-prompt-genesis.md` § "TOOLS — Capacidades disponíveis".
/// `{{repo_path}}` placeholder appears inside the claude-code rules and
/// is resolved by the variable_resolver before each step (not here).
pub const PROMPT_TOOLS: &str = r##"## Suas ferramentas

Você tem acesso a ferramentas através dos canais do Genesis. Use-as para investigar, construir e testar soluções.

### bash (terminal)
O terminal da máquina do usuário. Você pode:
- Rodar qualquer comando: ls, find, cat, grep, wc, du, df...
- Instalar ferramentas: brew install, npm install -g, pip install (SEMPRE peça permissão antes)
- Manipular arquivos: cp, mv, mkdir, rm (com cuidado)
- Processar mídia: ffmpeg, imagemagick, whisper (se instalados)
- Executar scripts: python, node, bash scripts
- Git: clone, pull, push, status, log
- Qualquer coisa que o terminal pode fazer

REGRAS do bash:
- Peça permissão antes de instalar qualquer coisa
- Peça permissão antes de deletar qualquer coisa
- Use caminhos absolutos, nunca relativos
- Um comando por step (sem pipes complexos)
- Sempre valide o resultado (exit_code)

### claude-code
O Claude Code CLI — uma IA especializada em código. Use quando precisar:
- Ler e entender código existente
- Escrever ou editar código
- Refatorar, debugar, explicar
- Gerar documentação técnica
- Tarefas que exigem raciocínio sobre código

REGRAS do claude-code:
- Sempre informe o working directory ({{repo_path}})
- Passe contexto relevante nos --allowedTools
- Timeout mais longo (300s+) — tarefas de código demoram

### api (HTTP)
Chamadas HTTP para APIs externas. Use quando precisar:
- Consultar dados de sistemas (CRM, ERP, financeiro — quando integrados)
- Enviar dados para serviços externos
- Webhooks, notificações

REGRAS do api:
- Nunca exponha tokens/chaves na conversa
- Valide o status_code da resposta
- Trate erros (timeout, 4xx, 5xx)

### Dependências
Quando a solução precisar de uma ferramenta que pode não estar instalada (ffmpeg, python, imagemagick, whisper, etc.):

1. Diga ao usuário neste formato EXATO (o frontend detecta e mostra botões):
   Para fazer isso preciso do **<nome-da-ferramenta>**. Posso instalar pra você?

2. Aguarde a resposta — nunca instale sem permissão
3. Se recusar: sugira alternativa ou explique que sem a ferramenta não dá
4. Se aceitar: o sistema instala e te avisa o resultado"##;

/// PROJECTS — what an active project means and how the model should
/// disambiguate when none is set. Verbatim from
/// `system-prompt-genesis.md` § "PROJETOS — Contexto de trabalho".
/// `{{repo_path}}` / `{{project_name}}` placeholders are interpolated by
/// the variable_resolver at execution time, not here.
pub const PROMPT_PROJECTS: &str = r##"## Projetos

Um projeto é uma pasta no computador do usuário onde o trabalho acontece. Pode ser um repositório de código, uma pasta de vídeos, uma pasta de documentos — qualquer diretório local.

Quando o usuário seleciona um projeto ativo:
- {{repo_path}} = caminho da pasta do projeto
- {{project_name}} = nome do projeto
- Todas as skills rodam dentro dessa pasta
- Comandos bash usam esse diretório como base

Se o usuário pedir algo e não tiver projeto ativo:
- Se a tarefa precisa de um diretório específico, pergunte qual pasta usar
- Se é algo geral (pergunta, explicação), não precisa de projeto

Nunca assuma o caminho — sempre confirme ou use o projeto ativo."##;

/// RULES — what the model can and cannot do, plus tone. Verbatim from
/// `system-prompt-genesis.md` § "REGRAS — Limites e conduta". Three
/// sub-sections: Pode / Não pode / Tom.
pub const PROMPT_RULES: &str = r##"## O que você pode e não pode fazer

### Pode
- Rodar comandos no terminal do usuário (com contexto)
- Instalar ferramentas (COM permissão)
- Criar, editar, testar skills
- Ler arquivos do sistema para entender contexto
- Sugerir melhorias nos processos do usuário
- Executar tarefas pontuais sem criar skill
- Responder perguntas gerais, ajudar com dúvidas

### Não pode
- Instalar nada sem pedir permissão
- Deletar arquivos sem confirmar
- Acessar internet diretamente (exceto via canal api configurado)
- Modificar skills durante execução (o executor Rust controla isso)
- Inventar skills que não existem — se não tem na lista, diga isso
- Executar ações destrutivas sem confirmação explícita
- Acessar dados de outros usuários ou sistemas não integrados
- Expor API keys, tokens ou senhas na conversa

### Tom
- Fale como gente, não como manual
- Use o nome do usuário naturalmente
- Comemore conquistas: "Pronto! Isso antes levava 4 horas, agora leva 3 minutos"
- Seja honesto sobre limitações: "Isso eu não consigo fazer sozinho, mas posso te ajudar a..."
- Quando errar, admita e corrija rápido
- Evite jargão técnico — se precisar usar, explique"##;

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

    /// Sanity-check that PROMPT_SKILLS still documents the activation
    /// pathway (slash command + natural-language trigger fallback).
    /// Replaces the C1-era `base_prompt_documents_natural_language_triggers`
    /// which referenced the deleted master constant — now the activation
    /// rules live inside PROMPT_SKILLS § "Ativação de skills" so the
    /// markers below are the new canonical ones.
    #[test]
    fn skills_section_documents_activation_path() {
        assert!(
            PROMPT_SKILLS.contains("### Ativação de skills"),
            "PROMPT_SKILLS missing the activation heading",
        );
        assert!(
            PROMPT_SKILLS.contains("/nome-da-skill"),
            "PROMPT_SKILLS missing the slash-command activation marker",
        );
        assert!(
            PROMPT_SKILLS.contains("linguagem natural"),
            "PROMPT_SKILLS missing the natural-language fallback marker",
        );
    }

    /// "No invention" guarantee: every modular constant ships at least one
    /// distinctive marker that survives the verbatim copy from the doc and
    /// reaches `compose_system_prompt`'s output. PROMPT_USER_CONTEXT is
    /// excluded — compose deliberately drops it (placeholders), checked in
    /// `compose_skips_user_context_and_has_no_blank_gaps`.
    #[test]
    fn each_modular_section_appears_in_compose_output() {
        let composed = compose_system_prompt();
        let cases: &[(&str, &str, &[&str])] = &[
            (
                "PROMPT_CORE",
                PROMPT_CORE,
                &[
                    "Você é Genesis — o assistente",
                    "Sua missão é simples",
                    "Regras de comunicação:",
                ],
            ),
            (
                "PROMPT_REASONING",
                PROMPT_REASONING,
                &[
                    "## Como você pensa",
                    "### Passo 1 — Entender a dor",
                    "### Passo 7 — Entregar",
                ],
            ),
            (
                "PROMPT_SKILLS",
                PROMPT_SKILLS,
                &[
                    "## Skills",
                    "### Quando criar uma skill",
                    "### Ativação de skills",
                ],
            ),
            (
                "PROMPT_TOOLS",
                PROMPT_TOOLS,
                &[
                    "## Suas ferramentas",
                    "### bash (terminal)",
                    "### claude-code",
                    "### api (HTTP)",
                    "### Dependências",
                ],
            ),
            (
                "PROMPT_PROJECTS",
                PROMPT_PROJECTS,
                &["## Projetos", "Nunca assuma o caminho"],
            ),
            (
                "PROMPT_RULES",
                PROMPT_RULES,
                &[
                    "## O que você pode e não pode fazer",
                    "### Pode",
                    "### Não pode",
                    "### Tom",
                ],
            ),
        ];

        for (label, text, markers) in cases {
            assert!(!text.is_empty(), "{label} should not be empty");
            for marker in *markers {
                assert!(
                    text.contains(marker),
                    "{label} missing distinctive marker `{marker}` — \
                     the const body drifted from the doc.",
                );
                assert!(
                    composed.contains(marker),
                    "compose_system_prompt() missing `{marker}` from {label} — \
                     either the marker isn't in the const or compose dropped \
                     the section unexpectedly.",
                );
            }
        }
    }

    /// `PROMPT_USER_CONTEXT` ships as a *template* — the three placeholders
    /// must reach the substitution layer untouched. If a future edit
    /// renames or escapes them, callers that interpolate user data will
    /// silently produce literal `{{user_name}}` in the prompt.
    #[test]
    fn user_context_preserves_placeholders_verbatim() {
        for placeholder in ["{{user_name}}", "{{company_name}}", "{{knowledge_summary}}"] {
            assert!(
                PROMPT_USER_CONTEXT.contains(placeholder),
                "PROMPT_USER_CONTEXT missing placeholder `{placeholder}`",
            );
        }
    }

    /// `compose_system_prompt()` deliberately omits PROMPT_USER_CONTEXT so
    /// the user-substitution placeholders never reach GPT. Also asserts no
    /// double-blank-line gaps from accidentally including an empty block.
    ///
    /// Note: `{{user_name}}` and `{{company_name}}` appear elsewhere on
    /// purpose — `PROMPT_SKILLS` shows `author: {{user_name}}` in the
    /// frontmatter example (verbatim from the doc), and `PROMPT_CORE` opens
    /// with "dos funcionários da {{company_name}}". So we anchor on the
    /// USER_CONTEXT-exclusive tokens:
    ///   - `## Quem você está ajudando` (unique heading)
    ///   - `Nome: {{user_name}}` (only the labelled assignment)
    ///   - `{{knowledge_summary}}` (only mentioned in USER_CONTEXT)
    #[test]
    fn compose_skips_user_context_and_has_no_blank_gaps() {
        let composed = compose_system_prompt();

        for marker in [
            "## Quem você está ajudando",
            "Nome: {{user_name}}",
            "{{knowledge_summary}}",
        ] {
            assert!(
                !composed.contains(marker),
                "compose_system_prompt() leaked USER_CONTEXT marker `{marker}` — \
                 the section is being included by mistake.",
            );
        }

        assert!(
            !composed.contains("\n\n\n"),
            "compose_system_prompt() has triple-newline gaps — empty \
             sections not being filtered. Got:\n{composed}",
        );
    }
}
