> 🕷️ Viúva Negra | 21/04/2026 | v1.0

# UX Flows — Genesis

---

## 1. Mapa de Rotas (SPA Client-Side)

```
/ ........................... Chat (tela principal)
/skills ..................... Lista de skills
/skills/:name .............. Visualizar/editar skill
/skills/new ................ Criar nova skill
/projects .................. Lista de projetos
/projects/:id .............. Detalhes do projeto + histórico
/projects/new .............. Novo projeto
/progress .................. Dashboard de execução ativa
/settings .................. Configurações (API key, paths)
```

Todas as rotas são privadas (app local, sem auth). Router: React Router DOM (client-side).

---

## 2. Navegação

### Layout Principal
```
┌─────────────────────────────────────────────────┐
│ [≡] Genesis                        [⚙️ Settings]│  Header
├──────────┬──────────────────────────────────────┤
│ 💬 Chat  │                                      │
│ 📋 Skills│         Main Content Area            │
│ 📁 Projetos│                                    │
│ 📊 Progress│                                    │
│          │                                      │
│          │                                      │
│          │                                      │
├──────────┴──────────────────────────────────────┤
│ Status: Idle / Running skill "criar-sistema"    │  Status bar
└─────────────────────────────────────────────────┘
```

**Sidebar (desktop):** Fixa, 200px, ícones + labels. Item ativo destacado com accent color.

**Sidebar (< 800px):** Colapsa. Hamburger menu no header abre drawer.

**Header:** Logo "Genesis" à esquerda, botão Settings à direita.

**Status bar (bottom):** 1 linha mostrando estado atual da execução.

---

## 3. Fluxos por Feature

### F1 — Executar Skill (Fluxo Principal)

**Trigger:** Usuário digita `/criar-sistema` no chat

```
[Chat] → digita /criar-sistema → [GPT processa]
  → skill encontrada? 
    ✅ → exibe confirmação "Executar criar-sistema no projeto X?"
      → [Confirma] → Progress tab ativa automaticamente
      → [Step 1 running] → log streaming → ✅/❌
      → [Step 2 running] → ...
      → [Todos completos] → notificação "Skill concluída"
    ❌ → mensagem "Skill não encontrada. Skills disponíveis: ..."
```

**Passo a passo:**
1. Rota: `/` (Chat)
2. Input: CommandInput detecta `/` prefix
3. GPT recebe mensagem → identifica skill → pede confirmação
4. Usuário confirma → Rust invoke `execute_skill`
5. Frontend muda para tab Progress (ou split view)
6. Eventos Tauri atualizam ProgressDashboard em tempo real
7. Cada step: StepCard muda de ⏳→✅ ou ⏳→❌
8. Se ❌: StepCard exibe erro + botão "Retry" (se configurado)
9. Ao completar: toast "✅ Skill criar-sistema concluída"

**Estados durante execução:**
- Chat: input desabilitado durante execução (exceto "abortar")
- Progress: steps com animação de loading no ativo
- Sidebar: badge "Running" no item Progress

### F2 — Criar Projeto

**Trigger:** Navegar para Projetos → Novo Projeto

```
[Projetos] → [+ Novo Projeto] → [Form: nome, caminho]
  → [Selecionar pasta] → file picker nativo Tauri
  → [Salvar] → valida path existe
    ✅ → redireciona para /projects/:id
    ❌ → erro inline "Diretório não encontrado"
```

**Passo a passo:**
1. Rota: `/projects/new`
2. Form: nome (text input) + repo_path (input + botão "Selecionar")
3. Botão "Selecionar" abre file picker nativo via Tauri dialog plugin
4. Submit: invoke `create_project` → validação no Rust
5. Sucesso: redirect para `/projects/:id`
6. Erro: mensagem inline sob o campo

### F3 — Gerenciar Skills

**Trigger:** Navegar para Skills

```
[Skills] → lista de skills com nome + descrição
  → [Clique] → /skills/:name → visualização markdown
  → [Editar] → editor inline com preview lado a lado
  → [Salvar] → validação de formato → salva .md
  → [+ Nova] → /skills/new → editor vazio ou via GPT (/criar-skill)
```

### F4 — Visualizar Progresso

**Trigger:** Execução ativa ou navegar para Progress

```
[Progress] → 
  Execução ativa?
    ✅ → Dashboard: skill name, progress bar, lista de steps com status
      → Clique em step → expande LogViewer com stdout/stderr
    ❌ → "Nenhuma execução ativa. Inicie uma skill no Chat."
```

---

## 4. Onboarding (Primeiro Uso)

```
[App abre pela primeira vez]
  → Detecta: OPENAI_API_KEY ausente
  → [Tela Settings] → input para API key
  → [Testar] → chamada mínima à API
    ✅ → Salva → redirect para Chat
    ❌ → "Key inválida, tente novamente"
  → Detecta: nenhum projeto cadastrado
  → Toast: "Cadastre seu primeiro projeto em Projetos → Novo"
```

---

## 5. Padrões de Interação

### Forms
- Label acima do input
- Validação no blur (Zod)
- Submit disabled até formulário válido
- Loading spinner no botão durante invoke

### Listas
- Busca com debounce 300ms (skills, projetos)
- Click na row abre detalhe
- Empty state com call-to-action

### Feedback
- **Toast (shadcn):** Sucesso (3s auto-dismiss), Erro (persist até fechar)
- **Confirm dialog:** Antes de abortar execução, deletar projeto
- **Inline errors:** Em forms, sob o campo

### Logs
- LogViewer com scroll automático para o final
- Monospace font
- Cores: stdout em var(--text), stderr em var(--err), info em var(--dim)
- Botão "Copiar log" no topo

---

## 6. Responsividade

| Breakpoint | Mudança |
|------------|---------|
| < 800px | Sidebar → hamburger drawer. Progress como tab, não side panel |
| 800-1200px | Sidebar narrow (ícones only) + main content |
| > 1200px | Sidebar full + main content. Chat + Progress side-by-side quando execução ativa |

---

## 7. Acessibilidade

- Keyboard nav em sidebar (Tab/Enter)
- Focus visible em todos os interativos
- Contraste mínimo 4.5:1 (design system dark theme)
- ARIA labels em botões icon-only (⚙️, ≡, ▶, ⏸)
- Status updates de execução anunciados via aria-live region

---

## 8. Empty States

| Tela | Mensagem | CTA |
|------|----------|-----|
| Chat (sem histórico) | "Digite um comando ou converse com o assistente" | Input focado |
| Skills (vazio) | "Nenhuma skill encontrada no diretório configurado" | "Verificar configurações" |
| Projetos (vazio) | "Nenhum projeto cadastrado" | "+ Novo Projeto" |
| Progress (sem execução) | "Nenhuma execução ativa" | "Ir para Chat" |
| Histórico de projeto | "Nenhuma execução registrada para este projeto" | "Executar skill" |
