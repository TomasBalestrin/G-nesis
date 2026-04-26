import { create } from "zustand";

import { listWorkflows as bridgeList } from "@/lib/tauri-bridge";
import type { WorkflowSummary } from "@/types/workflow";

interface WorkflowsState {
  items: WorkflowSummary[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refetch the catalog from disk. Subscribers re-render on change. */
  refresh: () => Promise<void>;
  /** Cheap noop on subsequent calls — first call hydrates. */
  ensureLoaded: () => Promise<void>;
}

function sortByName(items: WorkflowSummary[]): WorkflowSummary[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
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
