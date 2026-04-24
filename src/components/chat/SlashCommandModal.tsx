import { useEffect, useMemo, useRef } from "react";
import { Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SkillMeta } from "@/types/skill";

interface SlashCommandModalProps {
  open: boolean;
  /** Text after the leading "/" — substring filter on skill name. */
  query: string;
  /** Full skill list; modal filters client-side for snappy typing. */
  skills: SkillMeta[];
  /** Currently highlighted row index (owned by parent to sync with keyboard). */
  highlight: number;
  onHighlightChange: (index: number) => void;
  onSelect: (skillName: string) => void;
  onClose: () => void;
}

/**
 * Autocomplete popup for `/skill-name` in the chat input. Positioned above
 * the input by the parent (absolute within the input's relative wrapper).
 * Keyboard (↑/↓/Enter/Tab/Esc) is owned by `CommandInput` so the textarea's
 * onKeyDown can intercept before the key reaches the modal.
 */
export function SlashCommandModal({
  open,
  query,
  skills,
  highlight,
  onHighlightChange,
  onSelect,
  onClose,
}: SlashCommandModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterSkills(skills, query), [skills, query]);

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
      aria-label="Skills disponíveis"
      className="absolute bottom-full left-0 right-0 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-[var(--surface)] shadow-lg"
    >
      {filtered.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-[var(--text-2)]">
          Nenhuma skill encontrada
        </div>
      ) : (
        <ul className="py-1">
          {filtered.map((skill, idx) => (
            <li key={skill.name} role="option" aria-selected={idx === highlight}>
              <button
                type="button"
                // Use onMouseDown so clicking doesn't blur the textarea first
                // (blur would close the popup before the select handler fires).
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(skill.name);
                }}
                onMouseEnter={() => onHighlightChange(idx)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-2 text-left text-sm",
                  idx === highlight
                    ? "bg-[var(--bg-subtle)]"
                    : "hover:bg-[var(--bg-subtle)]",
                )}
              >
                <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--primary)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-semibold">
                    /{skill.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--text-3)]">
                    {skill.description || "(sem descrição)"}
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

export function filterSkills(skills: SkillMeta[], query: string): SkillMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q),
  );
}
