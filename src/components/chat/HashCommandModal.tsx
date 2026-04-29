import { useEffect, useMemo, useRef } from "react";
import { Route } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Caminho } from "@/types/caminho";

interface HashCommandModalProps {
  open: boolean;
  /** Text after the leading "#" — substring filter on name + repo_path. */
  query: string;
  /** Full caminhos list; modal filters client-side for snappy typing. */
  caminhos: Caminho[];
  /** Currently highlighted row index (owned by parent to sync with keyboard). */
  highlight: number;
  onHighlightChange: (index: number) => void;
  onSelect: (caminhoName: string) => void;
  onClose: () => void;
}

/**
 * Autocomplete popup for `#caminho-name` in the chat input. Same shape
 * as SlashCommandModal / AtCommandModal — keyboard nav owned by the
 * parent CommandInput, outside-click closes, click via onMouseDown so
 * the textarea blur doesn't race the select handler. Uses the success
 * color (`var(--status-success)`) on the leading icon so the three
 * trigger characters stay visually distinct: `/` accent, `@` info,
 * `#` success.
 */
export function HashCommandModal({
  open,
  query,
  caminhos,
  highlight,
  onHighlightChange,
  onSelect,
  onClose,
}: HashCommandModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => filterCaminhos(caminhos, query),
    [caminhos, query],
  );

  useEffect(() => {
    if (!open) return;
    if (highlight >= filtered.length && filtered.length > 0) {
      onHighlightChange(0);
    }
  }, [filtered.length, highlight, onHighlightChange, open]);

  useEffect(() => {
    if (!open) return;
    const handle = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Caminhos disponíveis"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 animate-fade-in overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg"
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-[var(--text-2)]">
          Nenhum caminho encontrado
        </div>
      ) : (
        <ul className="py-1">
          {filtered.map((caminho, idx) => (
            <li
              key={caminho.id}
              role="option"
              aria-selected={idx === highlight}
            >
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(caminho.name);
                }}
                onMouseEnter={() => onHighlightChange(idx)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-[var(--text-primary)]",
                  idx === highlight
                    ? "bg-[var(--bg-hover)]"
                    : "hover:bg-[var(--bg-hover)]",
                )}
              >
                <Route className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-success)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-semibold">
                    #{caminho.name}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--text-tertiary)]">
                    {caminho.repo_path}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function filterCaminhos(caminhos: Caminho[], query: string): Caminho[] {
  const q = query.trim().toLowerCase();
  if (!q) return caminhos;
  return caminhos.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.repo_path.toLowerCase().includes(q),
  );
}
