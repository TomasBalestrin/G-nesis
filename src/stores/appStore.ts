import { create } from "zustand";

interface AppState {
  sidebarOpen: boolean;
  activeRoute: string;
  needsSetup: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setActiveRoute: (route: string) => void;
  setNeedsSetup: (needs: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  activeRoute: "/",
  needsSetup: true,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setActiveRoute: (activeRoute) => set({ activeRoute }),
  setNeedsSetup: (needsSetup) => set({ needsSetup }),
}));
