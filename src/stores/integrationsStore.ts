import { create } from "zustand";

import { listIntegrations as bridgeList } from "@/lib/tauri-bridge";
import type { IntegrationRow } from "@/lib/tauri-bridge";
import type { Integration } from "@/types/integration";

interface IntegrationsState {
  items: Integration[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Refetch the catalog from the backend. Subscribers re-render on change. */
  refresh: () => Promise<void>;
  /** Cheap noop on subsequent calls — first call hydrates. */
  ensureLoaded: () => Promise<void>;
  /** Replace items locally (e.g. after add/update) without a roundtrip. */
  setItems: (items: Integration[]) => void;
}

function sortByName(items: Integration[]): Integration[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Map the raw bridge row (which uses `string | null` + always-present
 * `spec_file`) onto the friendlier `Integration` shape (optional fields
 * via `?`). Empty string `spec_file` is treated as "not set" so the UI
 * doesn't render `~/.genesis/integrations/.md` placeholders for rows
 * that never got a spec.
 */
function fromRow(row: IntegrationRow): Integration {
  return {
    id: row.id,
    name: row.name,
    display_name: row.display_name,
    base_url: row.base_url,
    auth_type: row.auth_type,
    spec_file: row.spec_file ? row.spec_file : undefined,
    enabled: row.enabled,
    last_used_at: row.last_used_at ?? undefined,
    created_at: row.created_at,
  };
}

export const useIntegrationsStore = create<IntegrationsState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  error: null,

  async refresh() {
    set({ loading: true, error: null });
    try {
      const rows = await bridgeList();
      set({
        items: sortByName(rows.map(fromRow)),
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

  setItems(items) {
    set({ items: sortByName(items), loaded: true });
  },
}));
