import { create } from "zustand";

type Theme = "blue-dark" | "blue-light" | "orange-dark" | "orange-light";

interface AppState {
  sidebarOpen: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  setTheme: (theme: Theme) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  theme: "blue-dark",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setTheme: (theme) => set({ theme }),
}));
