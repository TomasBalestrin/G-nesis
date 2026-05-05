import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Layout mode derivado da rota atual. Define quantos painéis o
 * MainLayout/SettingsLayout renderizam:
 *
 *   - "chat"         → Sidebar + Outlet                (2 painéis lógicos)
 *   - "settings"     → Sidebar + SettingsMenu + Outlet (3)
 *   - "skill-detail" → Sidebar (colapsada por default) + SettingsMenu +
 *                       SkillTreePanel + Outlet         (4)
 *
 * Skill detail vive em `/settings/skill/:name` desde Prompt 02 — é
 * uma sub-rota de settings, não mais uma rota de topo.
 */
export type LayoutMode = "chat" | "settings" | "skill-detail";

export function deriveLayoutMode(pathname: string): LayoutMode {
  if (pathname.startsWith("/settings/skill/")) return "skill-detail";
  if (pathname.startsWith("/settings")) return "settings";
  return "chat";
}

interface LayoutState {
  mode: LayoutMode;
  /** True quando a sidebar deve renderizar em 122px (só ícones).
   *  Default: auto-collapse em skill-detail; manual override
   *  (toggle button) ganha. */
  sidebarCollapsed: boolean;
  /** Toggle pelo botão da sidebar. Define o manual override —
   *  preserva a escolha do usuário entre navegações. */
  toggleCollapsed: () => void;
}

/**
 * Hook composto: deriva o modo da rota + mantém o estado de
 * collapse da sidebar. Manual override (`null` = follow auto)
 * persiste em React state local; é resetado quando o usuário
 * clica no toggle.
 *
 * Auto-collapse: se manual override é null, a sidebar fica
 * colapsada quando `mode === "skill-detail"` e expandida no
 * resto. Manual: clique inverte o estado atual e fixa a escolha.
 */
export function useLayoutMode(): LayoutState {
  const location = useLocation();
  const mode = deriveLayoutMode(location.pathname);

  // null = sem override; bool = escolha manual do usuário.
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null);

  const sidebarCollapsed =
    manualCollapsed !== null ? manualCollapsed : mode === "skill-detail";

  // Quando o modo muda (navegação) e o usuário não tinha override
  // ativo, mantemos null pra que o auto continue valendo. Não é
  // necessário fazer nada no useEffect — sidebarCollapsed é derivado.
  // Apenas garantimos que mudanças de rota não vazem state stale.
  useEffect(() => {
    // No-op: deixado como ponto de extensão se quisermos resetar
    // overrides em transições específicas (ex: ao sair de
    // skill-detail). Por ora, manual override é sticky.
  }, [mode]);

  const toggleCollapsed = () => {
    setManualCollapsed(!sidebarCollapsed);
  };

  return { mode, sidebarCollapsed, toggleCollapsed };
}
