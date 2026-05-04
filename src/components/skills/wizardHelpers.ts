// Shared helpers for the CreateSkillWizard. Mantém Step1 e Step2
// sem duplicar a serialização de SKILL.md.

export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
  author: string;
}

/**
 * SKILL.md = frontmatter + corpo. Os steps do wizard chamam isto
 * com corpos diferentes: Step 1 usa o template TODO mínimo (no caso
 * de upgrade futuro de fluxo), Step 2 já entra com as seções
 * sugeridas (## O que faz / ## Regras / ## Passos) que o usuário
 * edita livremente.
 */
export function buildSkillMd(meta: SkillFrontmatter, body: string): string {
  return `${renderFrontmatter(meta)}\n\n${body}\n`;
}

export function renderFrontmatter(meta: SkillFrontmatter): string {
  return [
    "---",
    `name: ${meta.name}`,
    `description: ${escapeYamlString(meta.description)}`,
    `version: ${meta.version}`,
    `author: ${escapeYamlString(meta.author)}`,
    "---",
  ].join("\n");
}

/**
 * Body sugerido na entrada da Etapa 2. Pré-preenche seções comuns
 * (descrever / regras / passos) com a descrição da Etapa 1 já
 * inserida abaixo do H1. O usuário edita livremente — não é
 * formulário rígido.
 */
export function renderStep2Template(
  name: string,
  description: string,
): string {
  return [
    `# ${name}`,
    "",
    description,
    "",
    "## O que faz",
    "(descreva aqui)",
    "",
    "## Regras",
    "(regras que a skill deve seguir)",
    "",
    "## Passos",
    "(passos de execução)",
  ].join("\n");
}

/**
 * Escape de string YAML inline. Cobre os casos comuns no input do
 * wizard (descrição com `:` ou `#`); valores complexos (multilinha,
 * aspas quebradas) ficam pra edição manual via Settings.
 */
export function escapeYamlString(value: string): string {
  if (/[:#"\n]/.test(value)) {
    const inner = value.replace(/"/g, '\\"');
    return `"${inner}"`;
  }
  return value;
}
