import { create } from "zustand";

import {
  listSkillPackages as bridgeListPackages,
  listSkills as bridgeList,
  type SkillPackage,
} from "@/lib/tauri-bridge";
import type { SkillMeta } from "@/types/skill";

interface SkillsState {
  /** Frontmatter parsed (name/description/version/author). */
  items: SkillMeta[];
  /** Package metadata indexado por name (has_assets, references_count, etc).
   *  Skills v1 legacy (.md soltos) não aparecem aqui — só v2 packages. */
  packages: Record<string, SkillPackage>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refetch o catálogo do disco (meta + packages em paralelo). */
  refresh: () => Promise<void>;
  /** Cheap noop quando já hidratado; primeiro call popula. */
  ensureLoaded: () => Promise<void>;
}

function sortByName(items: SkillMeta[]): SkillMeta[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function indexByName(packages: SkillPackage[]): Record<string, SkillPackage> {
  const out: Record<string, SkillPackage> = {};
  for (const p of packages) out[p.name] = p;
  return out;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  items: [],
  packages: {},
  loading: false,
  loaded: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const [items, packages] = await Promise.all([
        bridgeList(),
        bridgeListPackages().catch(() => [] as SkillPackage[]),
      ]);
      set({
        items: sortByName(items),
        packages: indexByName(packages),
        loading: false,
        loaded: true,
      });
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
}));
