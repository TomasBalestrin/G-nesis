import { create } from "zustand";

import {
  getSkill,
  listSkills as bridgeList,
  type SkillPackage,
} from "@/lib/tauri-bridge";
import type { Skill, SkillDetail } from "@/types/skill";

/** Arquivo atualmente em foco no SkillDetailView. `kind: "skill"`
 *  representa o canonical SKILL.md (sem filename); os demais carregam
 *  o filename relativo da subpasta correspondente. */
export type SelectedSkillFile =
  | { kind: "skill" }
  | { kind: "reference"; filename: string }
  | { kind: "asset"; filename: string }
  | { kind: "script"; filename: string };

const DEFAULT_SELECTION: SelectedSkillFile = { kind: "skill" };

interface SkillsState {
  /** Skills v2 unificadas. Sorted por name pra UI determinística. */
  items: Skill[];
  /** Skill atualmente aberta no SkillDetailView — full bundle com
   *  content + references + assets. `null` quando nenhuma view ativa. */
  activeSkill: SkillDetail | null;
  /** Arquivo destacado no preview do SkillDetailView. Compartilhado
   *  com o SkillTreePanel — ele escreve, a view lê. Reset pra
   *  SKILL.md sempre que `setActive` troca de skill. */
  selectedFile: SelectedSkillFile;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refetch o catálogo (uma chamada listSkills agora traz tudo). */
  refresh: () => Promise<void>;
  /** Cheap noop quando já hidratado; primeiro call popula. */
  ensureLoaded: () => Promise<void>;
  /** Carrega o bundle completo de uma skill via getSkill IPC e seta
   *  como activeSkill. Erra silenciosamente — caller pode inspecionar
   *  `activeSkill === null` pós-call pra detectar falha. */
  setActive: (name: string) => Promise<void>;
  /** Reset de `activeSkill` — útil ao desmontar SkillDetailView. */
  clearActive: () => void;
  setSelectedFile: (file: SelectedSkillFile) => void;
}

/**
 * SkillPackage (do backend, com metadata de frontmatter + counts +
 * mirror SQLite) → Skill (shape consumido pela UI). A diferença é
 * cosmética hoje — `id` cai pra `name` quando o mirror está ausente,
 * `created_at` cai pra "" — mas mantemos a tradução pra desacoplar a
 * shape de IPC da shape de view.
 */
function packageToSkill(pkg: SkillPackage): Skill {
  return {
    id: pkg.id ?? pkg.name,
    name: pkg.name,
    description: pkg.description,
    version: pkg.version,
    author: pkg.author,
    has_references: pkg.has_references,
    has_assets: pkg.has_assets,
    has_scripts: pkg.has_scripts,
    files_count: pkg.files_count,
    references_count: pkg.references_count,
    assets_count: pkg.assets_count,
    scripts_count: pkg.scripts_count,
    created_at: pkg.created_at ?? "",
  };
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  items: [],
  activeSkill: null,
  selectedFile: DEFAULT_SELECTION,
  loading: false,
  loaded: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const packages = await bridgeList();
      const items = packages
        .map(packageToSkill)
        .sort((a, b) => a.name.localeCompare(b.name));
      set({ items, loading: false, loaded: true });
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async ensureLoaded() {
    if (get().loaded || get().loading) return;
    await get().refresh();
  },

  async setActive(name) {
    await get().ensureLoaded();
    try {
      const bundle = await getSkill({ name });
      const cached = get().items.find((s) => s.name === name);
      const skill: Skill = cached ?? packageToSkill(bundle.package);
      set({
        activeSkill: {
          ...skill,
          content: bundle.skill_md,
          references: bundle.references,
          assets: bundle.assets,
          scripts: bundle.scripts,
        },
        selectedFile: DEFAULT_SELECTION,
      });
    } catch (err) {
      set({
        activeSkill: null,
        selectedFile: DEFAULT_SELECTION,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clearActive() {
    set({ activeSkill: null, selectedFile: DEFAULT_SELECTION });
  },

  setSelectedFile(file) {
    set({ selectedFile: file });
  },
}));
