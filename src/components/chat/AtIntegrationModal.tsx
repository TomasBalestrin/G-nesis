import { useEffect, useMemo, useRef } from "react";
import { Plug } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Integration } from "@/types/integration";

interface AtIntegrationModalProps {
  open: boolean;
  /** Text after the leading "@" — substring filter on name + display_name. */
  query: string;
  /** Full integration list; modal filters client-side for snappy typing. */
  integrations: Integration[];
  /** Currently highlighted row index (owned by parent to sync with keyboard). */
  highlight: number;
  onHighlightChange: (index: number) => void;
  onSelect: (integrationName: string) => void;
  onClose: () => void;
}

/**
 * Autocomplete popup for `@integration-name` in the chat input. Mirrors
 * `SlashCommandModal` (same positioning, same a11y shape, same close-on-
 * outside-click behavior) — only the icon (Plug instead of Zap) and the
 * row body (display_name + hostname badge) differ.
 *
 * Keyboard (↑/↓/Enter/Tab/Esc) is owned by `CommandInput` so the textarea's
 * onKeyDown can intercept before the key reaches the modal.
 */
export function AtIntegrationModal({
  open,
  query,
  integrations,
  highlight,
  onHighlightChange,
  onSelect,
  onClose,
}: AtIntegrationModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => filterIntegrations(integrations, query),
    [integrations, query],
  );

  // Clamp highlight when the filter shrinks the list.
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
      aria-label="Integrações disponíveis"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 animate-fade-in overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg"
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-[var(--text-2)]">
          Nenhuma integração encontrada
        </div>
      ) : (
        <ul className="py-1">
          {filtered.map((integration, idx) => (
            <li
              key={integration.id}
              role="option"
              aria-selected={idx === highlight}
            >
              <button
                type="button"
                // Use onMouseDown so clicking doesn't blur the textarea first
                // (blur would close the popup before the select handler fires).
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(integration.name);
                }}
                onMouseEnter={() => onHighlightChange(idx)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-[var(--text-primary)]",
                  idx === highlight
                    ? "bg-[var(--bg-hover)]"
                    : "hover:bg-[var(--bg-hover)]",
                )}
              >
                <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs font-semibold">
                      @{integration.name}
                    </span>
                    <span className="truncate text-[11px] text-[var(--text-tertiary)]">
                      {integration.display_name}
                    </span>
                  </span>
                  <HostnameBadge baseUrl={integration.base_url} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HostnameBadge({ baseUrl }: { baseUrl: string }) {
  const host = hostnameOf(baseUrl);
  if (!host) return null;
  return (
    <span className="mt-0.5 inline-flex max-w-full items-center rounded-full bg-[var(--bg-muted)] px-1.5 py-0 font-mono text-[10px] text-[var(--text-tertiary)]">
      <span className="truncate">{host}</span>
    </span>
  );
}

/**
 * Pull the hostname from `https://api.github.com/v3` → `api.github.com`.
 * Falls back to the raw string when the URL is malformed (mau cadastro
 * salvo no banco) — the picker still renders, the badge just shows
 * what was stored.
 */
function hostnameOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function filterIntegrations(
  integrations: Integration[],
  query: string,
): Integration[] {
  const q = query.trim().toLowerCase();
  if (!q) return integrations;
  return integrations.filter(
    (i) =>
      i.name.toLowerCase().includes(q) ||
      i.display_name.toLowerCase().includes(q),
  );
}
