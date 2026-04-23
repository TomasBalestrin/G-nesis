---
name: debug-sistema
description: Analisa um erro vindo de outra skill, propõe correção mínima e valida rodando o build
version: 1.0.0
author: Bethel
---

# Tools
- claude-code
- bash

# Inputs
- repo_path
- error_message

# Steps

## step_1
tool: claude-code
prompt: |
  Analise o erro abaixo e proponha a correção mínima no repositório
  `{{repo_path}}`:

  ```
  {{error_message}}
  ```

  Use os tools Read/Edit para inspecionar os arquivos relevantes, aplique
  a correção e explique em uma linha o que foi alterado. Não refatore
  fora do escopo do erro.
context: |
  O error_message vem do step que falhou em outra skill (stderr + exit code).
  Preserve o comportamento existente; só ajuste o necessário pra destravar
  o fluxo original.
validate: exit_code == 0
on_fail: retry(2) then abort

## step_2
tool: bash
command: npm --prefix {{repo_path}} run build
context: Roda o build pra confirmar que a correção não quebrou o restante.
validate: exit_code == 0
on_fail: abort

# Outputs
- error_analyzed
- build_passing

# Config
timeout: 600
retries: 2
