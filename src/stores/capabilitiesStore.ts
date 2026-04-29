import { create } from "zustand";

import { listCapabilities as bridgeList } from "@/lib/tauri-bridge";
import type { Capability, CapabilityType } from "@/types/capability";

interface CapabilitiesState {
  items: Capability[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refetch the registry. Components subscribed to `items` re-render. */
  refresh: () => Promise<void>;
  /** Cheap noop on subsequent calls — first call hydrates. */
  ensureLoaded: () => Promise<void>;
  /** Read-only filter helper — avoids re-creating arrays in selectors
   *  that subscribe directly. Returns an array even when nothing matches
   *  (callers `.length` against it without null guards). */
  byType: (type: CapabilityType) => Capability[];
}

function sortItems(items: Capability[]): Capability[] {
  // Match the backend ORDER BY type, name. Two-key sort keeps natives
  // and connectors visually grouped in any UI that just iterates the
  // store's `items`.
  return [...items].sort((a, b) => {
    const t = a.type.localeCompare(b.type);
    return t !== 0 ? t : a.name.localeCompare(b.name);
  });
}

export const useCapabilitiesStore = create<CapabilitiesState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const items = await bridgeList();
      set({ items: sortItems(items), loading: false, loaded: true });
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

  byType(type) {
    return get().items.filter((c) => c.type === type);
  },
}));
