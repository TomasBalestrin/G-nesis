// Mirrors src-tauri/src/orchestrator/skill_parser.rs.

/**
 * Frontmatter parseado de SKILL.md. Mirror exato de `SkillMeta` em
 * skill_parser.rs — usado pelo slash autocomplete e por código que
 * só precisa de campos do header.
 */
export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  author: string;
}

/**
 * View unificada usada pelo store + UI. Junta SkillMeta (frontmatter)
 * com SkillPackage (storage layout) e mirror SQLite (id, created_at).
 *
 * Construído no frontend via `mergeIntoSkill(meta, pkg)`. `id` cai
 * pra `name` quando o mirror SQLite não tem row (ex: skills criadas
 * antes da migration 009 que ainda não foram tocadas). `created_at`
 * é string ISO8601 quando vem do mirror, "" quando ausente.
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  has_references: boolean;
  has_assets: boolean;
  has_scripts: boolean;
  files_count: number;
  /** Arquivos não-hidden direto em `references/`. Complementa
   *  `has_references` pra renderizar badge de quantidade na sidebar. */
  references_count: number;
  /** Idem pra `assets/`. */
  assets_count: number;
  /** Idem pra `scripts/`. */
  scripts_count: number;
  created_at: string;
}

/**
 * Skill + conteúdo completo do package — retornado pelo `setActive`
 * do skillsStore. `content` é o SKILL.md raw (frontmatter + body).
 * `references`, `assets` e `scripts` são filenames relativos ao
 * package (ex: "iron-man.md", "template.html", "parse.sh").
 */
export interface SkillDetail extends Skill {
  content: string;
  references: string[];
  assets: string[];
  scripts: string[];
}
