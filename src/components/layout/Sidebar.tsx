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

export function Sidebar({ open, onNavigate }: SidebarProps) {
  return (
    <aside
      aria-label="Navegação principal"
      className={cn(
        "w-[200px] border-r bg-[var(--sb-bg)] border-[var(--sb-bd)] flex flex-col",
        // Mobile: fixed drawer, slides in from left
        "max-[800px]:fixed max-[800px]:inset-y-0 max-[800px]:z-40",
        "max-[800px]:transition-transform max-[800px]:duration-200",
        open ? "max-[800px]:translate-x-0" : "max-[800px]:-translate-x-full",
      )}
    >
      <nav className="flex-1 py-4 space-y-1 px-2">
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
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          "hover:bg-[var(--sb-hover)]",
          isActive
            ? "bg-[var(--sb-active)] text-[var(--sb-text-a)]"
            : "text-[var(--sb-text)]",
        )
      }
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
    </NavLink>
  );
}
