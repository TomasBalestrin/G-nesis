import {
  BookOpen,
  FileCode,
  GitBranch,
  Route as RouteIcon,
  Settings as SettingsIcon,
} from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

import { SkillTreePanel } from "./SkillTreePanel";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Match também sub-rotas — ex: `/settings/skill/foo` continua
   *  destacando o item "Skill" mesmo sem corresponder ao path exato. */
  matchPrefix?: string;
}

/**
 * Menu lateral do Settings (Figma v2). 315px de largura, padding 30px,
 * borda direita 1px var(--gv2-border). Items com radius 10px,
 * px 25px py 15px, gap 10px, separador 1px entre eles. Active = bg
 * gv2-active-bg + text gv2-active-text; inactive = text
 * gv2-text-secondary com hover suave.
 *
 * Skill detail (/settings/skill/:name) injeta um 3º painel
 * (SkillTreePanel, 315px) entre o menu e o Outlet — derivado da rota,
 * sem flag global.
 */
const ITEMS: NavItem[] = [
  { to: "/settings/knowledge", label: "Base de Conhecimento", icon: BookOpen },
  {
    to: "/settings/skills",
    label: "Skill",
    icon: FileCode,
    matchPrefix: "/settings/skill",
  },
  { to: "/settings/caminhos", label: "Caminhos", icon: RouteIcon },
  { to: "/settings/workflows", label: "Workflows", icon: GitBranch },
  { to: "/settings/config", label: "Configurações", icon: SettingsIcon },
];

export function SettingsLayout() {
  const location = useLocation();
  const inSkillDetail = location.pathname.startsWith("/settings/skill/");

  return (
    <div className="flex h-full">
      <aside
        aria-label="Navegação de configurações"
        className="flex shrink-0 flex-col border-r"
        style={{
          width: "var(--gv2-panel-width)",
          padding: "30px",
          borderColor: "var(--gv2-border)",
          background: "var(--gv2-bg)",
        }}
      >
        <h2
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 600,
            fontSize: "25px",
            color: "var(--gv2-text)",
            marginBottom: "30px",
          }}
        >
          Configurações
        </h2>
        <nav>
          <ul className="flex flex-col" style={{ gap: "10px" }}>
            {ITEMS.map(({ to, label, icon: Icon, matchPrefix }, idx) => (
              <li key={to} className="flex flex-col">
                <NavLink
                  to={to}
                  end={!matchPrefix}
                  style={({ isActive: routeActive }) => {
                    const active = matchPrefix
                      ? location.pathname.startsWith(matchPrefix) || routeActive
                      : routeActive;
                    return {
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      padding: "15px 25px",
                      borderRadius: "var(--gv2-radius-sm)",
                      fontFamily: "Inter, system-ui, sans-serif",
                      fontSize: "15px",
                      background: active
                        ? "var(--gv2-active-bg)"
                        : "transparent",
                      color: active
                        ? "var(--gv2-active-text)"
                        : "var(--gv2-text-secondary)",
                      transition: "background-color 120ms, color 120ms",
                    };
                  }}
                >
                  <Icon className="shrink-0 h-[18px] w-[18px]" strokeWidth={1.5} />
                  <span className="truncate">{label}</span>
                </NavLink>
                {idx < ITEMS.length - 1 ? (
                  <div
                    aria-hidden
                    style={{
                      height: "1px",
                      marginTop: "10px",
                      background: "var(--gv2-border)",
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {inSkillDetail ? <SkillTreePanel /> : null}

      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
