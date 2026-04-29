# UX Flows — Genesis

Rotas, navegação e fluxos principais.

## Rotas

```
/                              → ChatIndexRedirect (vai pra /chat/<convId> ou /chat/new)
/chat/:conversationId          → ChatPanel (empty state ou messages)

/skills/new                    → SkillEditor (criar v1)
/skills/:name                  → SkillRouteDispatch (auto v1 SkillEditor / v2 SkillViewerV2)
/skills/:name/edit             → SkillEditor (sempre, mesmo pra v2)

/caminhos                      → CaminhoList
/caminhos/new                  → NewCaminhoForm
/caminhos/:id                  → CaminhoDetail
/projects                      → Navigate /caminhos (compat redirect)
/projects/new                  → Navigate /caminhos/new
/projects/:id                  → ProjectIdRedirect (preserva :id)

/capabilities                  → CapabilityList (Native + Connectors agrupados)
/capabilities/:name            → CapabilityDetail (header + doc_user + doc_ai colapsável)

/workflows                     → WorkflowList
/workflows/new                 → WorkflowEditor
/workflows/:name               → WorkflowViewer
/workflows/:name/edit          → WorkflowEditor

/settings                      → SettingsPage (API key, Knowledge, Caminhos)
*                              → 404
```

Onboarding gate (`!onboardingDone`) curto-circuita TODAS as rotas pra
`<OnboardingPage>`. ErrorBoundary wrappa cada branch (onboarding e
main); `<FatalErrorDialog>` mora FORA dos boundaries pra sobreviver
quando o subtree morre.

## Layout

`MainLayout` (todas as rotas exceto onboarding):
- **Sidebar** esquerda — Conversas + Skills + Capabilities + Caminhos + Workflows
- **Main** — rota ativa (Outlet)

Sem layout em onboarding (fullscreen overlay).

## Fluxos principais

### Onboarding (primeiro launch)
1. Welcome (Sparkles + "Vamos configurar")
2. API key (Eye toggle + Testar persiste e valida via callOpenAI)
3. Perfil (nome + empresa → app_state)
4. Documentos (drag/drop .md, upload incremental)
5. Resumo (regenerateKnowledgeSummary se hasFiles, senão "Tudo pronto")
   → Começar dispara `setAppStateValue("onboarding_complete", "true")`

Botão Voltar disponível em cada step (exceto Welcome). Pular em
Documentos vai direto pra step 5.

### Chat — empty state
Conversa nova: SkillRouteDispatch carrega ou cria conversation,
ChatPanel monta. Sem messages → renderiza `EmptyStateGreeting`
(Sparkles + "Olá, {user_name}") + CommandInput centralizado max-w-2xl.
Após primeira message: layout normal (ScrollArea + input fixo bottom).

### Chat — turno regular
1. User digita/cola mensagem (eventualmente com `@cap` ou `#caminho`).
2. Submit → optimistic add em `setMessages` + `startThinking`.
3. `sendChatMessage(content, conversationId)` IPC.
4. Backend monta system_prompt completo (CORE → ... → mentions → skill
   agent se aplicável) + chama OpenAI.
5. Tool calling loop (até 10 iterações) executa cada tool requested.
6. Reply final persiste como `chat_messages.role=assistant`.
7. `chat:thinking_*` events streamam reasoning → `useChatStore` →
   `<ThinkingBlock>` colapsável.

### Chat — slash command
1. User digita `/` no start-of-input → `SlashCommandModal` abre acima
   do input com filter.
2. Tab/Enter seleciona → submitRaw(`/<nome>`).
3. Backend `is_ai_routed_slash_command(name)`:
   - `criar-skill` vai pro AI flow (PROMPT_SKILL_AGENT injetado).
   - Outros: canned preview via `try_slash_reply`.
4. Preview: ConfirmationMarker no body → MessageBubble detecta + renderiza
   SkillExecutePanel com seletor de caminho + botão Executar.
5. Executar → `execute_skill(skill_name, project_id, conversation_id)`
   → eventos streamam status messages inline.

### Chat — @capability mention
1. User digita `@` em qualquer posição → `AtCommandModal` filtra
   `useCapabilitiesStore.items`.
2. Tab/Enter insere `@<nome> ` no cursor (não submete — é mention
   inline).
3. No submit, backend `extract_at_mentions` pega cada `@nome`,
   `resolve_at_mentions` busca `doc_ai` no DB, `format_mentions_block`
   monta seção markdown que vai pro fim do system prompt.

### Chat — #caminho mention
Mesma mecânica do `@`, mas com `extract_hash_mentions` +
`resolve_hash_mentions` (busca em `projects` table, retorna
`(name, repo_path)`). Section "## Caminhos mencionados" entra no
system prompt.

### Skill execution (inline)
1. User confirma execução → `execute_skill` retorna execution_id imediato.
2. SkillExecutePanel seeda `useExecutionStore.activeExecution` com
   skill_name + project + conversation_id.
3. Insere "⏳ Executando skill **X** no projeto **Y**..." no chat.
4. Backend Executor itera steps e emite eventos:
   - `execution:step_started` → "⏳ Step X — Executando..." inline
   - `execution:step_completed` → "✅ Step X — Concluído (Xs)"
   - `execution:step_failed` → "❌ Step X falhou — analisando..." +
     `analyzeStepFailure` posta GPT analysis logo abaixo
   - `execution:completed` → "✅ Skill **X** concluída — N/M steps"
5. ExecutionControlBar acima do input expõe Pausar/Retomar/Abortar
   enquanto status ∈ {running, paused}.

### Skill v2 viewer
1. User clica numa skill v2 no sidebar OR navega `/skills/:name`.
2. `SkillRouteDispatch` chama `listSkills`, lê `meta.version`.
3. `version.startsWith("2")` → `SkillViewerV2`:
   - Header: name + version badge + author + Edit button
   - Aside esquerdo: árvore de arquivos (SKILL.md / references/ /
     scripts/ / assets/) via plugin-fs
   - Main: Tabs Rendered/Raw do SKILL.md ou PreviewPane do arquivo
     selecionado
4. v1 → `SkillEditor` (legacy, single-file editor).

### Criar skill (agente)
1. `/criar-skill` ou "quero criar uma skill que...".
2. Chat injeta `PROMPT_SKILL_AGENT` no system prompt.
3. Conduz 6 etapas: ENTENDER, PESQUISAR, PROPOR, CONSTRUIR, APRESENTAR,
   VALIDAR.
4. Quando emite `SKILL.md` em block markdown com `version: "2.0"`,
   frontend renderiza `SkillPreviewCard`:
   - Botão "Ver" toggle Rendered/Raw
   - Botão "Salvar" → `saveSkillFolder({skillName, skillMd})`
5. Idempotente — re-call sobrescreve, suportando iteração CONSTRUIR
   → APRESENTAR → VALIDAR → ajusta → CONSTRUIR de novo.
6. Validação: agente roda a skill com input real, mostra output, pede
   confirmação. Se ajusta, re-grava.

## Responsividade

- Min width testada: 640px (sm).
- Sidebar ocupa 280px fixo até `md` (768px); abaixo, vira drawer
  controlado por `MainLayout` button.
- ChatPanel max-w-3xl (768px) centrado; empty state input max-w-2xl
  (640px).
- CommandInput rounded-2xl com 2 rows: top (textarea + send),
  bottom (CaminhoSelector + ModelSelector).
- Sidebar entries são collapsible sections (Conversas, Skills,
  Workflows) ou flat NavLinks (Capabilities, Caminhos).
