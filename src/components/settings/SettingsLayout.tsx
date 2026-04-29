import {
  BookOpen,
  FileCode,
  GitBranch,
  Route as RouteIcon,
  Settings as SettingsIcon,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

// Nested routes are wired in App.tsx; this layout only renders the
// sub-sidebar shell + <Outlet />. Cada child route monta sua própria
// section (KnowledgeRoute, SettingsSkillsSection, etc).
const ITEMS: NavItem[] = [
  { to: "/settings/knowledge", label: "Base de Conhecimento", icon: BookOpen },
  { to: "/settings/skills", label: "Skills", icon: FileCode },
  { to: "/settings/caminhos", label: "Caminhos", icon: RouteIcon },
  { to: "/settings/workflows", label: "Workflows", icon: GitBranch },
  { to: "/settings/config", label: "Configurações", icon: SettingsIcon },
];

export function SettingsLayout() {
  return (
    <div className="flex h-full">
      <aside
        aria-label="Navegação de configurações"
        className="w-[200px] shrink-0 border-r border-[var(--sb-bd)] bg-[var(--sb-bg)] px-2 py-4"
      >
        <h2 className="px-2 pb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Settings
        </h2>
        <nav className="space-y-0.5">
          {ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-sm transition-colors duration-100",
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                )
              }
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
