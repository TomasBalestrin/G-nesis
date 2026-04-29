import { useEffect, useMemo, useRef } from "react";
import { Plug } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Capability } from "@/types/capability";

interface AtCommandModalProps {
  open: boolean;
  /** Text after the leading "@" — substring filter on name + display_name. */
  query: string;
  /** Full capabilities list; modal filters client-side for snappy typing. */
  capabilities: Capability[];
  /** Currently highlighted row index (owned by parent to sync with keyboard). */
  highlight: number;
  onHighlightChange: (index: number) => void;
  onSelect: (capabilityName: string) => void;
  onClose: () => void;
}

/**
 * Autocomplete popup for `@capability-name` in the chat input. Mirrors
 * SlashCommandModal — same positioning (absolute within the input's
 * relative wrapper), same parent-owned keyboard nav, same outside-click
 * to close. Difference: filters capabilities (native + connector) and
 * uses the info color so visually distinct from `/` (accent) and `#`
 * (success).
 */
export function AtCommandModal({
  open,
  query,
  capabilities,
  highlight,
  onHighlightChange,
  onSelect,
  onClose,
}: AtCommandModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => filterCapabilities(capabilities, query),
    [capabilities, query],
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
      aria-label="Capabilities disponíveis"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 animate-fade-in overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg"
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-[var(--text-2)]">
          Nenhuma capability encontrada
        </div>
      ) : (
        <ul className="py-1">
          {filtered.map((cap, idx) => (
            <li key={cap.id} role="option" aria-selected={idx === highlight}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(cap.name);
                }}
                onMouseEnter={() => onHighlightChange(idx)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-[var(--text-primary)]",
                  idx === highlight
                    ? "bg-[var(--bg-hover)]"
                    : "hover:bg-[var(--bg-hover)]",
                )}
              >
                <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--status-info)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-semibold">
                    @{cap.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--text-tertiary)]">
                    {cap.description || cap.display_name || "(sem descrição)"}
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

export function filterCapabilities(
  capabilities: Capability[],
  query: string,
): Capability[] {
  const q = query.trim().toLowerCase();
  if (!q) return capabilities;
  return capabilities.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.display_name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q),
  );
}
