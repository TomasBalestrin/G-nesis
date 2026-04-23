---
name: criar-sistema
description: Cria um sistema novo a partir de um briefing — instala dependências, itera as tasks via Claude Code e commita o resultado
version: 1.0.0
author: Bethel
---

# Tools
- bash
- claude-code

# Inputs
- briefing_path
- repo_path
- tasks_file

# Steps

## step_1
tool: bash
command: npm install
context: Instala as dependências declaradas no package.json da raiz do repositório.
validate: exit_code == 0
on_fail: retry 2

## step_2
tool: claude-code
prompt: |
  Leia o briefing em {{briefing_path}} e o arquivo de tasks em {{tasks_file}}.

  Para cada task marcada como `- [ ]` no arquivo:
    1. Implemente a mudança descrita seguindo as convenções do projeto.
    2. Rode os testes relevantes para confirmar que não há regressão.
    3. Marque a task como `- [x]` e registre uma linha curta com o resultado.

  Use os tools Read, Edit e Bash como necessário. Não improvise passos
  fora do briefing.
context: |
  O arquivo de tasks está em markdown com checklists.
  Uma task concluída é `- [x]`; uma pendente é `- [ ]`.
  Pare quando todas as tasks estiverem marcadas como concluídas.
validate: exit_code == 0 and output contains "concluída"
on_fail: retry(3) then skill("debug-sistema")

## step_loop
repeat: {{tasks_file}}
until: todas_tasks_concluidas

## step_3
tool: bash
command: git -C {{repo_path}} add -A && git -C {{repo_path}} commit -m "feat: sistema gerado por criar-sistema"
context: Commita todas as alterações produzidas pelas tasks acima.
validate: exit_code == 0
on_fail: continue

# Outputs
- dependencies_installed
- tasks_completed
- committed

# Config
timeout: 900
retries: 3
