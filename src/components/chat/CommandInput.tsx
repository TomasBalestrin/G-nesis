import { useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ChangeEvent } from "react";
import { SendHorizontal, Slash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 200;

interface CommandInputProps {
  onSubmit: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function CommandInput({
  onSubmit,
  disabled,
  placeholder = "Digite um comando (/skill-name) ou converse com o assistente...",
}: CommandInputProps) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const isCommand = value.trimStart().startsWith("/");

  function autoResize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    autoResize();
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
    requestAnimationFrame(() => autoResize());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    submit();
  }

  return (
    <form
      onSubmit={handleFormSubmit}
      className={cn(
        "flex items-end gap-2 rounded-xl border p-2 transition-colors",
        isCommand
          ? "border-primary bg-[var(--primary-bg)] shadow-acc"
          : "border-border bg-surface",
      )}
    >
      {isCommand && (
        <Slash
          aria-hidden
          className="mb-2 h-4 w-4 shrink-0 text-[var(--primary-tx)]"
        />
      )}
      <textarea
        ref={ref}
        value={value}
        rows={1}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label="Mensagem"
        className={cn(
          "flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed",
          "placeholder:text-[var(--text-dis)] focus:outline-none",
          isCommand && "font-mono text-[var(--primary-tx)]",
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
    </form>
  );
}
