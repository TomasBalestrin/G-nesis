import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { SendHorizontal, Slash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCaminhosStore } from "@/stores/caminhosStore";
import { useCapabilitiesStore } from "@/stores/capabilitiesStore";
import { useIntegrationsStore } from "@/stores/integrationsStore";
import { useSkillsStore } from "@/stores/skillsStore";

import { AtCommandModal, filterCapabilities } from "./AtCommandModal";
import { AtIntegrationModal, filterIntegrations } from "./AtIntegrationModal";
import { CaminhoSelector } from "./CaminhoSelector";
import { HashCommandModal, filterCaminhos } from "./HashCommandModal";
import { ModelSelector } from "./ModelSelector";
import { SlashCommandModal, filterSkills } from "./SlashCommandModal";

const MAX_HEIGHT = 200;

interface CommandInputProps {
  onSubmit: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

type Trigger = "/" | "@" | "#";

interface MentionState {
  trigger: Trigger | null;
  /** "start" → trigger char is the first non-whitespace of the input
   *  (turn-level command — slash for skills, `@` for integrations).
   *  "inline" → trigger char is mid-text (mention markers — `@` for
   *  capabilities, `#` for caminhos). */
  position: "start" | "inline";
  /** Text after the trigger char up to the cursor. */
  query: string;
  /** Index of the trigger char in `value` (start of the partial mention). */
  startIndex: number;
}

const NO_MENTION: MentionState = {
  trigger: null,
  position: "inline",
  query: "",
  startIndex: -1,
};

/**
 * Chat input with four autocomplete popups, gated by trigger char +
 * position (start-of-input vs mid-text):
 *   - `/skill-name`     start  → submits on select.
 *   - `@<integration>`  start  → inserts `@name ` (turn-level command,
 *                                detected by `extract_at_integration`).
 *   - `@capability`     inline → inserts `@name ` (mention; system
 *                                prompt injection via extract_at_mentions).
 *   - `#caminho`        inline → inserts `#name `.
 *
 * Detection runs against the current word (last whitespace before the
 * cursor → cursor position). The `position` flag in MentionState
 * disambiguates the two `@` paths: same trigger char, different
 * popup + filter list + downstream backend semantics.
 *
 * One highlight state, shared across modals — resets when the trigger
 * or query changes. Keyboard handling is owned here so the textarea's
 * own onKeyDown can intercept ↑/↓/Enter/Tab/Esc before the popup.
 */
export function CommandInput({
  onSubmit,
  disabled,
  placeholder = "Digite um comando (/skill-name) ou converse com o assistente...",
}: CommandInputProps) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const skills = useSkillsStore((s) => s.items);
  const skillsLoaded = useSkillsStore((s) => s.loaded);
  const ensureSkills = useSkillsStore((s) => s.ensureLoaded);

  const capabilities = useCapabilitiesStore((s) => s.items);
  const capsLoaded = useCapabilitiesStore((s) => s.loaded);
  const ensureCaps = useCapabilitiesStore((s) => s.ensureLoaded);

  const caminhos = useCaminhosStore((s) => s.items);
  const caminhosLoaded = useCaminhosStore((s) => s.loaded);
  const ensureCaminhos = useCaminhosStore((s) => s.ensureLoaded);

  const integrations = useIntegrationsStore((s) => s.items);
  const integrationsLoaded = useIntegrationsStore((s) => s.loaded);
  const ensureIntegrations = useIntegrationsStore((s) => s.ensureLoaded);

  const mention = useMemo(
    () => (disabled ? NO_MENTION : detectMention(value, cursor)),
    [value, cursor, disabled],
  );

  // Filtered candidates per (trigger, position). Only the active modal
  // renders, so the inactive arrays are essentially free (empty).
  const filteredSkills = useMemo(
    () =>
      mention.trigger === "/" && skillsLoaded
        ? filterSkills(skills, mention.query)
        : [],
    [mention, skills, skillsLoaded],
  );
  const filteredCaps = useMemo(
    () =>
      mention.trigger === "@" && mention.position === "inline" && capsLoaded
        ? filterCapabilities(capabilities, mention.query)
        : [],
    [mention, capabilities, capsLoaded],
  );
  const filteredCaminhos = useMemo(
    () =>
      mention.trigger === "#" && caminhosLoaded
        ? filterCaminhos(caminhos, mention.query)
        : [],
    [mention, caminhos, caminhosLoaded],
  );
  const filteredIntegrations = useMemo(
    () =>
      mention.trigger === "@" &&
      mention.position === "start" &&
      integrationsLoaded
        ? filterIntegrations(integrations, mention.query)
        : [],
    [mention, integrations, integrationsLoaded],
  );

  // Hydrate the matching catalog the first time the user triggers it.
  // `@` at start-of-input → integrations; mid-text → capabilities.
  useEffect(() => {
    if (mention.trigger === "/") void ensureSkills();
    if (mention.trigger === "@" && mention.position === "start")
      void ensureIntegrations();
    if (mention.trigger === "@" && mention.position === "inline")
      void ensureCaps();
    if (mention.trigger === "#") void ensureCaminhos();
  }, [
    mention.trigger,
    mention.position,
    ensureSkills,
    ensureCaps,
    ensureCaminhos,
    ensureIntegrations,
  ]);

  // Reset highlight when the trigger or query changes.
  useEffect(() => {
    setHighlight(0);
  }, [mention.trigger, mention.query]);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    setCursor(e.target.selectionStart ?? 0);
    autoResize();
  }

  /** Refresh cursor on selection moves (arrow keys, click). Without
   *  this, moving the caret without typing would keep the menu stuck
   *  on the previously detected word. */
  function syncCursor() {
    const el = textareaRef.current;
    if (!el) return;
    setCursor(el.selectionStart ?? 0);
  }

  function submitRaw(content: string) {
    const trimmed = content.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
    setCursor(0);
    requestAnimationFrame(() => autoResize());
  }

  function selectSlash(name: string) {
    // Slash commands at start-of-input still submit immediately —
    // matches the canned-skill-preview path in chat.rs.
    submitRaw(`/${name}`);
  }

  /** Replace the partial mention (from `mention.startIndex` to the
   *  cursor) with the full `${prefix}${name} ` token, then move the
   *  caret past the inserted space so the user can keep typing. */
  function selectInline(prefix: "@" | "#", name: string) {
    if (mention.startIndex < 0) return;
    const before = value.slice(0, mention.startIndex);
    const after = value.slice(cursor);
    const inserted = `${prefix}${name} `;
    const newValue = before + inserted + after;
    const newCursor = before.length + inserted.length;
    setValue(newValue);
    setCursor(newCursor);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
      autoResize();
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Active list for the current (trigger, position). Branches below
    // only run when one is non-empty so navigation keys are safe.
    const active =
      mention.trigger === "/"
        ? filteredSkills.map((s) => s.name)
        : mention.trigger === "@" && mention.position === "start"
          ? filteredIntegrations.map((i) => i.name)
          : mention.trigger === "@"
            ? filteredCaps.map((c) => c.name)
            : mention.trigger === "#"
              ? filteredCaminhos.map((c) => c.name)
              : [];

    if (mention.trigger && active.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((i) => (i + 1) % active.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((i) => (i - 1 + active.length) % active.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        commitMention(active[highlight]);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commitMention(active[highlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // For slash (start-of-input) clear the whole field; for inline
        // mentions just close the menu by inserting a space which
        // breaks the trigger word. Simpler: drop the trigger char and
        // re-position the caret. But shifting state is messy — closing
        // the menu via setValue trick would also lose user text. Punt:
        // for inline, just consume the Esc; the popup hides next render
        // when query mismatches.
        if (mention.trigger === "/") {
          setValue("");
          setCursor(0);
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitRaw(value);
    }
  }

  function commitMention(name: string) {
    if (mention.trigger === "/") return selectSlash(name);
    // Both `@` paths insert "@name " — only the source list differs
    // (start → integrations, inline → capabilities). Backend
    // disambiguates via extract_at_integration vs extract_at_mentions.
    if (mention.trigger === "@") return selectInline("@", name);
    if (mention.trigger === "#") return selectInline("#", name);
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submitRaw(value);
  }

  // Visual cue per trigger — ring color, textarea text color, leading
  // slash indicator. Inline mentions (@, #) only color the form ring
  // since the trigger char lives mid-text and a left-side icon doesn't
  // make sense for them.
  const ringClass =
    mention.trigger === "/"
      ? "ring-2 ring-[var(--accent)]"
      : mention.trigger === "@"
        ? "ring-2 ring-[var(--status-info)]"
        : mention.trigger === "#"
          ? "ring-2 ring-[var(--status-success)]"
          : "";

  return (
    <div className="relative">
      <SlashCommandModal
        open={mention.trigger === "/" && !disabled}
        query={mention.query}
        skills={skills ?? []}
        highlight={highlight}
        onHighlightChange={setHighlight}
        onSelect={selectSlash}
        onClose={() => {
          setValue("");
          setCursor(0);
        }}
      />
      <AtIntegrationModal
        open={
          mention.trigger === "@" && mention.position === "start" && !disabled
        }
        query={mention.query}
        integrations={integrations ?? []}
        highlight={highlight}
        onHighlightChange={setHighlight}
        onSelect={(name) => selectInline("@", name)}
        onClose={() => {
          // Same dismiss-without-clearing pattern as the inline modals.
        }}
      />
      <AtCommandModal
        open={
          mention.trigger === "@" && mention.position === "inline" && !disabled
        }
        query={mention.query}
        capabilities={capabilities ?? []}
        highlight={highlight}
        onHighlightChange={setHighlight}
        onSelect={(name) => selectInline("@", name)}
        onClose={() => {
          // Closing without selection just dismisses the menu — leave
          // the partial `@foo` in the text so the user can keep editing.
          // Re-detection on the next change picks it back up.
        }}
      />
      <HashCommandModal
        open={mention.trigger === "#" && !disabled}
        query={mention.query}
        caminhos={caminhos ?? []}
        highlight={highlight}
        onHighlightChange={setHighlight}
        onSelect={(name) => selectInline("#", name)}
        onClose={() => {
          // Same as AtCommandModal — preserve the partial mention.
        }}
      />

      <form
        onSubmit={handleFormSubmit}
        className={cn(
          "rounded-2xl bg-[var(--bg-tertiary)] transition-colors",
          "focus-within:ring-2 focus-within:ring-[var(--accent-ring)]",
          ringClass,
        )}
      >
        {/* Top row: leading slash hint + textarea + send. The slash icon
            shows only for the slash trigger since it lives at the
            start of the input — inline mentions don't get a left
            indicator. */}
        <div className="flex items-end gap-2 px-3 pb-1 pt-2">
          {mention.trigger === "/" && (
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
            onKeyUp={syncCursor}
            onClick={syncCursor}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Mensagem"
            aria-autocomplete={mention.trigger ? "list" : undefined}
            aria-expanded={mention.trigger !== null}
            className={cn(
              "min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed",
              "text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none",
              // Mono + accent only for slash commands — those replace
              // the whole input. Inline mentions stay as regular prose.
              mention.trigger === "/" && "font-mono text-[var(--accent)]",
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
          <CaminhoSelector />
          <ModelSelector />
        </div>
      </form>
    </div>
  );
}

/** Detect a trigger character at the current word (last whitespace
 *  before the cursor → cursor position). Slash is gated to
 *  start-of-input (everything before the trigger must be whitespace);
 *  `@` and `#` fire anywhere because they're inline mention markers,
 *  not commands. The query is whatever follows the trigger up to the
 *  cursor — empty when the user just typed the trigger char. */
function detectMention(text: string, cursor: number): MentionState {
  if (cursor < 0 || cursor > text.length) return NO_MENTION;
  let i = cursor;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  const word = text.slice(i, cursor);
  if (word.length === 0) return NO_MENTION;
  const head = word[0];
  const atStart = text.slice(0, i).trim() === "";
  if (head === "/") {
    if (atStart) {
      return {
        trigger: "/",
        position: "start",
        query: word.slice(1),
        startIndex: i,
      };
    }
    return NO_MENTION;
  }
  if (head === "@") {
    // Start-of-input → integration (turn-level command).
    // Mid-text → capability mention (system-prompt injection).
    return {
      trigger: "@",
      position: atStart ? "start" : "inline",
      query: word.slice(1),
      startIndex: i,
    };
  }
  if (head === "#") {
    return {
      trigger: "#",
      position: "inline",
      query: word.slice(1),
      startIndex: i,
    };
  }
  return NO_MENTION;
}
