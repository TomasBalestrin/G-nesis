import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight, Clock } from "lucide-react";

import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  /** Live or final reasoning text. Empty string treated as "no thinking yet". */
  thinking: string;
  /** Optional 1-line summary for the collapsed header. */
  summary?: string;
  /**
   * `true` while the model is actively producing the thinking block — header
   * pulses with the Clock icon and the body stays open by default. Once the
   * model finishes, parent should flip this to `false` and the block
   * collapses.
   */
  streaming: boolean;
}

const DEFAULT_SUMMARY = "Pensando...";
const COLLAPSED_SUMMARY = "Raciocínio do modelo";

/**
 * Renders a model's extended-thinking output. Two visual states:
 *
 *   - `streaming`: Clock icon animates, body always open with a soft fade-in
 *     for newly-arrived tokens. Auto-scrolls to the bottom as text grows so
 *     the latest reasoning stays visible.
 *   - collapsed: Brain icon, summary text, click expands the body in place.
 *     Default-collapsed when streaming flips to false; user toggles after.
 *
 * Built without @radix-ui/react-accordion (not in deps) — the disclosure
 * pattern here is identical to the inline expand/collapse used in
 * sidebar sections, keeps the bundle slim.
 */
export function ThinkingBlock({
  thinking,
  summary,
  streaming,
}: ThinkingBlockProps) {
  // Open while streaming so the user sees tokens land; close when streaming
  // finishes so the bubble stays compact. User toggles afterwards.
  const [open, setOpen] = useState(streaming);
  useEffect(() => {
    setOpen(streaming);
  }, [streaming]);

  const bodyRef = useRef<HTMLDivElement>(null);
  // While streaming, keep the latest line in view.
  useEffect(() => {
    if (!streaming || !open) return;
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [thinking, streaming, open]);

  if (!thinking && !streaming) return null;

  const headerLabel = streaming
    ? summary?.trim() || DEFAULT_SUMMARY
    : summary?.trim() || COLLAPSED_SUMMARY;

  return (
    <section
      className={cn(
        "my-2 overflow-hidden rounded-xl border border-[var(--border-sub)]",
        "bg-[var(--bg-subtle)]",
      )}
      aria-label="Raciocínio do modelo"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left text-xs",
          "text-[var(--text-secondary)] transition-colors duration-100",
          "hover:bg-[var(--bg-muted)] focus-visible:outline-none",
        )}
      >
        {streaming ? (
          <Clock
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 animate-pulse text-[var(--accent)]"
          />
        ) : (
          <Brain
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]"
          />
        )}
        <span className="min-w-0 flex-1 truncate">{headerLabel}</span>
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform duration-200",
            open && "rotate-90",
          )}
        />
      </button>

      {open ? (
        <div
          ref={bodyRef}
          className={cn(
            "max-h-72 overflow-y-auto border-t border-[var(--border-sub)]",
            "bg-[var(--code-bg)] px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--code-tx)]",
          )}
        >
          {thinking ? (
            <pre className="whitespace-pre-wrap break-words font-mono">
              {thinking}
            </pre>
          ) : (
            <span className="italic text-[var(--text-tertiary)]">
              Aguardando primeiro token...
            </span>
          )}
        </div>
      ) : null}
    </section>
  );
}
