import { create } from "zustand";

import { listSkills as bridgeList } from "@/lib/tauri-bridge";
import type { SkillMeta } from "@/types/skill";

interface SkillsState {
  items: SkillMeta[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refetch the catalog from disk. Components subscribed to `items` re-render. */
  refresh: () => Promise<void>;
  /** Cheap noop on subsequent calls — first call hydrates. */
  ensureLoaded: () => Promise<void>;
}

function sortByName(items: SkillMeta[]): SkillMeta[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const items = await bridgeList();
      set({ items: sortByName(items), loading: false, loaded: true });
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
