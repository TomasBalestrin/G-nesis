import { NavLink } from "react-router-dom";
import { Activity, FileCode, FolderGit2, MessageSquare } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Chat", icon: MessageSquare, end: true },
  { to: "/skills", label: "Skills", icon: FileCode },
  { to: "/projects", label: "Projetos", icon: FolderGit2 },
  { to: "/progress", label: "Progress", icon: Activity },
];

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

/**
 * Three layouts based on viewport width (docs/ux-flows.md §6):
 * - `< 800px`  → fixed drawer overlay, slides in from the left (200px wide).
 * - `800–1200px` → narrow rail (60px), icons centered, labels hidden.
 * - `≥ 1200px` → full sidebar (200px) with icon + label.
 */
export function Sidebar({ open, onNavigate }: SidebarProps) {
  return (
    <aside
      aria-label="Navegação principal"
      className={cn(
        "flex flex-col border-r bg-[var(--sb-bg)] border-[var(--sb-bd)]",
        // Width per breakpoint
        "w-[200px]",
        "min-[800px]:max-[1200px]:w-[60px]",
        // Mobile drawer
        "max-[800px]:fixed max-[800px]:inset-y-0 max-[800px]:z-40",
        "max-[800px]:transition-transform max-[800px]:duration-200",
        open
          ? "max-[800px]:translate-x-0"
          : "max-[800px]:-translate-x-full",
      )}
    >
      <nav className="flex-1 space-y-1 px-2 py-4">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>
    </aside>
  );
}

interface SidebarLinkProps {
  item: NavItem;
  onNavigate: () => void;
}

function SidebarLink({ item, onNavigate }: SidebarLinkProps) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      // Native browser tooltip — useful in narrow mode where the label is hidden.
      title={item.label}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          // Narrow rail: collapse padding + center icon, hide label below.
          "min-[800px]:max-[1200px]:justify-center min-[800px]:max-[1200px]:px-2",
          "hover:bg-[var(--sb-hover)]",
          isActive
            ? "bg-[var(--sb-active)] text-[var(--sb-text-a)]"
            : "text-[var(--sb-text)]",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-[800px]:max-[1200px]:hidden">{item.label}</span>
    </NavLink>
  );
}
