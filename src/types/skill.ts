// Mirrors src-tauri/src/orchestrator/skill_parser.rs.

import type { Tool } from "./project";

export interface SkillMeta {
  name: string;
  description: string;
  version: string;
  author: string;
}

export interface Step {
  id: string;
  tool: Tool;
  command: string | null;
  prompt: string | null;
  context: string | null;
  validate: string | null;
  on_fail: string | null;
  on_success: string | null;
}

export interface ParsedSkill {
  meta: SkillMeta;
  tools: string[];
  inputs: string[];
  steps: Step[];
  outputs: string[];
}
