import { create } from "zustand";

import { listCaminhos as bridgeList } from "@/lib/tauri-bridge";
import type { Caminho } from "@/types/caminho";

interface CaminhosState {
  items: Caminho[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refetch the list. Components subscribed to `items` re-render. */
  refresh: () => Promise<void>;
  /** Cheap noop on subsequent calls — first call hydrates. */
  ensureLoaded: () => Promise<void>;
}

function sortByName(items: Caminho[]): Caminho[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

export const useCaminhosStore = create<CaminhosState>((set, get) => ({
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
