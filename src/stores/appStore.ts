import { create } from "zustand";

import { getAppState, setAppState } from "@/lib/tauri-bridge";

const KEY_ACTIVE_PROJECT = "active_project_id";
const KEY_ACTIVE_MODEL = "active_model_id";
const DEFAULT_MODEL = "gpt-4o";

interface AppState {
  sidebarOpen: boolean;
  activeRoute: string;
  needsSetup: boolean;
  /** UUID of the project the user picked in the chat footer. Empty until set. */
  activeProjectId: string;
  /** Model id for the orchestrator (gpt-4o, gpt-4o-mini, …). */
  activeModelId: string;
  /** True after the first hydrateFromBackend resolves — avoids overwriting
   *  persisted state with the in-memory defaults during first-paint. */
  appStateLoaded: boolean;

  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setActiveRoute: (route: string) => void;
  setNeedsSetup: (needs: boolean) => void;
  /** Persist + update activeProjectId. Empty string clears the selection. */
  setActiveProjectId: (id: string) => Promise<void>;
  /** Persist + update activeModelId. Falls back to default on empty input. */
  setActiveModelId: (id: string) => Promise<void>;
  /** Read both keys from the backend app_state table once on app boot. */
  hydrateFromBackend: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  sidebarOpen: true,
  activeRoute: "/",
  needsSetup: true,
  activeProjectId: "",
  activeModelId: DEFAULT_MODEL,
  appStateLoaded: false,

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setActiveRoute: (activeRoute) => set({ activeRoute }),
  setNeedsSetup: (needsSetup) => set({ needsSetup }),

  async setActiveProjectId(id) {
    set({ activeProjectId: id });
    try {
      await setAppState({ key: KEY_ACTIVE_PROJECT, value: id });
    } catch {
      // Persist is best-effort. The UI still reflects the choice for the
      // current session; failures surface via the toast wrappers when
      // callers wrap the call themselves.
    }
  },

  async setActiveModelId(id) {
    const value = id.trim() || DEFAULT_MODEL;
    set({ activeModelId: value });
    try {
      await setAppState({ key: KEY_ACTIVE_MODEL, value });
    } catch {
      // Same best-effort policy as above.
    }
  },

  async hydrateFromBackend() {
    if (get().appStateLoaded) return;
    try {
      const [project, model] = await Promise.all([
        getAppState({ key: KEY_ACTIVE_PROJECT }),
        getAppState({ key: KEY_ACTIVE_MODEL }),
      ]);
      set({
        activeProjectId: project?.value ?? "",
        activeModelId: model?.value || DEFAULT_MODEL,
        appStateLoaded: true,
      });
    } catch {
      // Migration 003 seeds defaults so this should not happen in practice.
      // If it does (DB locked, etc.) we still mark loaded so consumers
      // don't infinitely retry.
      set({ appStateLoaded: true });
    }
  },
}));
