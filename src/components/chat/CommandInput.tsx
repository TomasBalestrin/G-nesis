import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { SendHorizontal, Slash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSkillsStore } from "@/stores/skillsStore";

import { ModelSelector } from "./ModelSelector";
import { ProjectSelector } from "./ProjectSelector";
import { SlashCommandModal, filterSkills } from "./SlashCommandModal";

const MAX_HEIGHT = 200;

interface CommandInputProps {
  onSubmit: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Chat input with an autocomplete popup triggered by a leading `/`. Typing
 * `/leg` opens a popup filtered to skills whose name or description matches;
 * ↑/↓ navigate, Enter/Tab selects + submits, Esc cancels. Clicks outside the
 * popup close it; mouse click on a row fires before textarea blur via
 * onMouseDown preventDefault.
 */
export function CommandInput({
  onSubmit,
  disabled,
  placeholder = "Digite um comando (/skill-name) ou converse com o assistente...",
}: CommandInputProps) {
  const [value, setValue] = useState("");
  const skills = useSkillsStore((s) => s.items);
  const skillsLoaded = useSkillsStore((s) => s.loaded);
  const ensureSkills = useSkillsStore((s) => s.ensureLoaded);
  const [highlight, setHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmedStart = value.trimStart();
  const isCommand = trimmedStart.startsWith("/");
  const slashQuery = isCommand ? trimmedStart.slice(1).split(/\s/)[0] ?? "" : "";
  const slashOpen = isCommand && !disabled;

  const filtered = useMemo(
    () => (skillsLoaded ? filterSkills(skills, slashQuery) : []),
    [skills, skillsLoaded, slashQuery],
  );

  // Hydrate the catalog the first time the user types `/`. Subsequent
  // refreshes (e.g. after saving a new skill from chat) flow through the
  // shared store and re-render this list automatically.
  useEffect(() => {
    if (isCommand) ensureSkills();
  }, [isCommand, ensureSkills]);

  // Reset highlight every time the filter changes.
  useEffect(() => {
    setHighlight(0);
  }, [slashQuery]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    autoResize();
  }

  function submitRaw(content: string) {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
    requestAnimationFrame(() => autoResize());
  }

  function selectSkill(name: string) {
    submitRaw(`/${name}`);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (slashOpen && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        selectSkill(filtered[highlight].name);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectSkill(filtered[highlight].name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setValue("");
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitRaw(value);
    }
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submitRaw(value);
  }

  return (
    <div className="relative">
      <SlashCommandModal
        open={slashOpen}
        query={slashQuery}
        skills={skills ?? []}
        highlight={highlight}
        onHighlightChange={setHighlight}
        onSelect={selectSkill}
        onClose={() => setValue("")}
      />

      <form
        onSubmit={handleFormSubmit}
        className={cn(
          "rounded-2xl bg-[var(--bg-tertiary)] transition-colors",
          "focus-within:ring-2 focus-within:ring-[var(--accent-ring)]",
          isCommand && "ring-2 ring-[var(--accent)]",
        )}
      >
        {/* Top row: leading slash hint + textarea + send. The textarea
            grows up to MAX_HEIGHT and the send button stays pinned to
            the bottom-right via items-end. */}
        <div className="flex items-end gap-2 px-3 pb-1 pt-2">
          {isCommand && (
            <Slash
              aria-hidden
              className="mb-2 h-4 w-4 shrink-0 text-[var(--accent)]"
            />
          )}
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Mensagem"
            aria-autocomplete={slashOpen ? "list" : undefined}
            aria-expanded={slashOpen}
            className={cn(
              "min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed",
              "text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none",
              isCommand && "font-mono text-[var(--accent)]",
            )}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!value.trim() || disabled}
            aria-label="Enviar"
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        </div>

        {/* Bottom row: compact project + model selectors. Both open
            UPWARDS (side="top" set on each DropdownMenuContent) so they
            don't push the chat scroll area on click. */}
        <div className="flex items-center gap-1 px-2 pb-2">
          <ProjectSelector />
          <ModelSelector />
        </div>
      </form>
    </div>
  );
}
