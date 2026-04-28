import { useEffect, useState } from "react";
import { ChevronDown, Folder, FolderPlus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listProjects } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { Project } from "@/types/project";

/**
 * Compact dropdown for picking the active project. Sits to the left of the
 * chat input. Selection is persisted via app_state so it survives reloads.
 *
 * Empty catalog → trigger shows "Sem projeto" and the only menu item is a
 * deeplink to /projects/new (the same form used from Settings).
 */
export function ProjectSelector() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);
  const navigate = useNavigate();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listProjects()
      .then((items) => {
        if (!cancelled) setProjects(items);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop a stale selection if the project was deleted elsewhere — avoids
  // dispatching skill executions against a missing repo_path.
  useEffect(() => {
    if (loading || !activeProjectId) return;
    if (!projects.some((p) => p.id === activeProjectId)) {
      void setActiveProjectId("");
    }
  }, [loading, activeProjectId, projects, setActiveProjectId]);

  const active = projects.find((p) => p.id === activeProjectId) ?? null;
  const label = loading
    ? "Carregando..."
    : active
      ? active.name
      : projects.length === 0
        ? "Sem projeto"
        : "Selecionar projeto";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Selecionar projeto ativo"
          className={cn(
            "flex max-w-[180px] items-center gap-1.5 rounded-md px-2 py-1",
            "text-xs text-[var(--text-tertiary)] transition-colors",
            "hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
            "disabled:opacity-60",
          )}
          disabled={loading}
        >
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="min-w-[220px]"
      >
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
          Projetos
        </DropdownMenuLabel>
        {projects.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs">
            Nenhum projeto cadastrado
          </DropdownMenuItem>
        ) : (
          projects.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => void setActiveProjectId(p.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 text-xs",
                p.id === activeProjectId && "bg-[var(--accent-soft)]",
              )}
            >
              <span className="font-medium text-[var(--text-primary)]">
                {p.name}
              </span>
              <span className="truncate text-[10px] text-[var(--text-tertiary)]">
                {p.repo_path}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => navigate("/projects/new")}
          className="text-xs"
          asChild
        >
          <Link to="/projects/new" className="flex items-center gap-2">
            <FolderPlus className="h-3.5 w-3.5" />
            Novo projeto
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
