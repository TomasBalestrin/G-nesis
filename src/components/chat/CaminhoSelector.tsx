import { useEffect, useState } from "react";
import { ChevronDown, Route as RouteIcon, FolderPlus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listCaminhos } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { Caminho } from "@/types/caminho";

/**
 * Compact dropdown for picking the active caminho (renamed from
 * project surface). Sits to the left of the chat input next to
 * ModelSelector. Selection persists via `app_state.activeProjectId`
 * — store key is unchanged from when caminhos were called projects;
 * only the user-facing copy migrated.
 *
 * Empty catalog → trigger shows "Sem caminho" and the only menu
 * item is a deeplink to `/caminhos/new`.
 */
export function CaminhoSelector() {
  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const setActiveProjectId = useAppStore((s) => s.setActiveProjectId);
  const navigate = useNavigate();

  const [caminhos, setCaminhos] = useState<Caminho[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listCaminhos()
      .then((items) => {
        if (!cancelled) setCaminhos(items);
      })
      .catch(() => {
        if (!cancelled) setCaminhos([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Drop a stale selection if the caminho was removed elsewhere —
  // avoids dispatching skill executions against a missing repo_path.
  useEffect(() => {
    if (loading || !activeProjectId) return;
    if (!caminhos.some((c) => c.id === activeProjectId)) {
      void setActiveProjectId("");
    }
  }, [loading, activeProjectId, caminhos, setActiveProjectId]);

  const active = caminhos.find((c) => c.id === activeProjectId) ?? null;
  const label = loading
    ? "Carregando..."
    : active
      ? active.name
      : caminhos.length === 0
        ? "Sem caminho"
        : "Selecionar caminho";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Selecionar caminho ativo"
          className={cn(
            "flex max-w-[180px] items-center gap-1.5 rounded-md px-2 py-1",
            "text-xs text-[var(--text-tertiary)] transition-colors",
            "hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
            "disabled:opacity-60",
          )}
          disabled={loading}
        >
          <RouteIcon className="h-3.5 w-3.5 shrink-0" />
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
          Caminhos
        </DropdownMenuLabel>
        {caminhos.length === 0 ? (
          <DropdownMenuItem disabled className="text-xs">
            Nenhum caminho cadastrado
          </DropdownMenuItem>
        ) : (
          caminhos.map((c) => (
            <DropdownMenuItem
              key={c.id}
              onSelect={() => void setActiveProjectId(c.id)}
              className={cn(
                "flex flex-col items-start gap-0.5 text-xs",
                c.id === activeProjectId && "bg-[var(--accent-soft)]",
              )}
            >
              <span className="font-medium text-[var(--text-primary)]">
                {c.name}
              </span>
              <span className="truncate text-[10px] text-[var(--text-tertiary)]">
                {c.repo_path}
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => navigate("/caminhos/new")}
          className="text-xs"
          asChild
        >
          <Link to="/caminhos/new" className="flex items-center gap-2">
            <FolderPlus className="h-3.5 w-3.5" />
            Novo caminho
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
