---
name: criar-skill
description: Walk-through guiado para criar uma skill nova do zero
version: "2.0"
author: Bethel
triggers:
  - criar skill
  - nova skill
  - criar-skill
---

# Pré-requisitos

- Saber, em uma frase, o que a skill deve fazer
- Conhecer os caminhos absolutos de onde os arquivos vivem (entrada/saída)

> Esta skill é **conversacional** — não roda steps via executor. O comando
> `/criar-skill` redireciona o turno pra IA com o prompt `criar-skill — fluxo
> guiado`, que conduz cinco fases até gerar o `.md` final num bloco de código
> que o usuário salva via o botão **Salvar Skill** da `MessageBubble`.

## Etapa 1
Objetivo: Apresentar capacidades disponíveis (canais bash/claude-code/api,
gramática de validate, on_fail, variáveis {{repo_path}}, etc.) pra que o
usuário saiba o que pode pedir
Canal: claude-code
Ação: Listar canais, validações e variáveis disponíveis em formato breve.
Validação: output contains "canais"
Se falhar: continue

## Etapa 2
Objetivo: Coletar o contexto do usuário — qual problema ele está
resolvendo, em qual projeto, com que ferramentas externas
Canal: claude-code
Ação: Perguntar projeto, descrever o objetivo da skill em uma frase,
identificar dependências externas (ffmpeg, git, etc).
Validação: exit_code == 0
Se falhar: continue

## Etapa 3
Objetivo: Fazer perguntas específicas sobre inputs, outputs e formato dos
arquivos envolvidos
Canal: claude-code
Ação: Perguntar paths absolutos de input/output, formato esperado,
tratamento de erro desejado.
Validação: exit_code == 0
Se falhar: continue

## Etapa 4
Objetivo: Esboçar a arquitetura — quantas etapas, qual canal cada uma usa,
o que cada etapa valida
Canal: claude-code
Ação: Apresentar lista numerada das etapas com Canal e Validação propostas;
pedir confirmação antes de gerar o `.md` final.
Validação: output contains "confirmar"
Se falhar: continue

## Etapa 5
Objetivo: Gerar o arquivo `.md` completo no formato v2 dentro de um único
bloco de código, com frontmatter, Pré-requisitos e Etapas
Canal: claude-code
Ação: Emitir o `.md` num bloco ```markdown ... ``` seguindo o formato v2.
O frontend detecta o bloco e oferece "Salvar Skill".
Validação: output contains "---"
Se falhar: abort

# Outputs

- skill_md_gerada
