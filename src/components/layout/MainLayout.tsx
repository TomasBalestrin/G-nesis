import { Outlet } from "react-router-dom";

import { useLayoutMode } from "@/hooks/useLayoutMode";

import { AppHeader } from "./AppHeader";
import { Sidebar } from "./Sidebar";

/**
 * App shell agnóstico de modo: Sidebar (315px expandida / 122px
 * colapsada) + coluna principal com Header (103px) + Outlet.
 *
 * O modo (chat / settings / skill-detail) é derivado da rota pelo
 * `useLayoutMode`. O auto-collapse em skill-detail é honrado aqui;
 * sub-painéis (settings menu, skill tree) são responsabilidade do
 * `SettingsLayout` (ele intercepta `/settings/*` e adiciona os
 * painéis no contexto).
 *
 * Mobile drawer foi removido nesta refatoração — Genesis é desktop
 * (Tauri); a porção mobile do shell antigo era especulativa e não
 * estava sendo usada.
 */
export function MainLayout() {
  const { sidebarCollapsed, toggleCollapsed } = useLayoutMode();

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: "var(--gv2-bg)",
        color: "var(--gv2-text)",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleCollapsed}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
