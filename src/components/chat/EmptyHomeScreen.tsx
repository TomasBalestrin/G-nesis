import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronDown, FileText, SendHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/appStore";
import { useSkillsStore } from "@/stores/skillsStore";
import type { Skill } from "@/types/skill";

interface EmptyHomeScreenProps {
  onSubmit: (content: string) => void;
  disabled?: boolean;
  userName: string | null;
}

interface ModelOption {
  id: string;
  label: string;
  description: string;
}

// Espelha a lista do ModelSelector — mantemos local pra que o empty
// state não dependa do dropdown completo (quem persiste a escolha
// continua sendo o appStore via setActiveModelId).
const MODELS: ModelOption[] = [
  { id: "gpt-4o", label: "GPT-4o", description: "Padrão · multimodal · 128k" },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    description: "Mais rápido e barato",
  },
  {
    id: "gpt-4-turbo",
    label: "GPT-4 Turbo",
    description: "Janela 128k · raciocínio denso",
  },
];

const MAX_PILLS = 4;
const MAX_HEIGHT = 200;

/**
 * Tela inicial (chat vazio) no padrão Figma v2. Mostra a saudação
 * "Olá {nome}, tudo bem?" em Lora 55px, um card de input centralizado
 * (829px, backdrop-blur), e até 4 quick action pills com as skills
 * cadastradas. Clicar numa pill submete `/skill-name` direto — mesmo
 * comportamento do SlashCommandModal.
 *
 * Submissão usa o `onSubmit` recebido (mesmo handler do ChatPanel).
 * Não temos autocomplete inline aqui — quem precisar do menu / @ # usa
 * o CommandInput depois que o thread engata e a tela switch pra
 * layout cheio.
 */
export function EmptyHomeScreen({
  onSubmit,
  disabled,
  userName,
}: EmptyHomeScreenProps) {
  const greeting = userName
    ? `Olá ${userName}, tudo bem?`
    : "Olá, tudo bem?";
  const skills = useSkillsStore((s) => s.items);
  const ensureSkills = useSkillsStore((s) => s.ensureLoaded);

  useEffect(() => {
    void ensureSkills();
  }, [ensureSkills]);

  const pills = skills.slice(0, MAX_PILLS);

  function submit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
  }

  return (
    <div
      className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-4"
      style={{ background: "var(--gv2-bg)" }}
    >
      <h1
        style={{
          fontFamily: "Lora, Georgia, serif",
          fontWeight: 500,
          fontSize: "55px",
          lineHeight: 1.1,
          color: "var(--gv2-text)",
          textAlign: "center",
          margin: 0,
        }}
      >
        {greeting}
      </h1>

      <div style={{ height: "30px" }} />

      <HomeInputCard onSubmit={submit} disabled={!!disabled} />

      {pills.length > 0 ? (
        <>
          <div style={{ height: "30px" }} />
          <SkillPills
            skills={pills}
            disabled={!!disabled}
            onActivate={(name) => submit(`/${name}`)}
          />
        </>
      ) : null}
    </div>
  );
}

interface HomeInputCardProps {
  onSubmit: (raw: string) => void;
  disabled: boolean;
}

function HomeInputCard({ onSubmit, disabled }: HomeInputCardProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit(value);
      setValue("");
      requestAnimationFrame(() => autoResize());
    }
  }

  function handleSendClick() {
    onSubmit(value);
    setValue("");
    requestAnimationFrame(() => autoResize());
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "829px",
        background: "var(--gv2-input-bg)",
        backdropFilter: "blur(8.8px)",
        WebkitBackdropFilter: "blur(8.8px)",
        border: "1px solid var(--gv2-input-border)",
        borderRadius: "var(--gv2-radius-md)",
        padding: "30px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          autoResize();
        }}
        onKeyDown={handleKeyDown}
        placeholder="Como posso ajudar você hoje?"
        disabled={disabled}
        rows={1}
        spellCheck={false}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          resize: "none",
          fontFamily: "Inter, system-ui, sans-serif",
          fontWeight: 400,
          fontSize: "20px",
          lineHeight: 1.4,
          color: "var(--gv2-text)",
          minHeight: "28px",
          maxHeight: `${MAX_HEIGHT}px`,
        }}
      />

      <div className="flex items-center justify-end gap-3">
        <ModelDropdown />
        <SendButton onClick={handleSendClick} disabled={disabled || !value.trim()} />
      </div>
    </div>
  );
}

function ModelDropdown() {
  const activeModelId = useAppStore((s) => s.activeModelId);
  const setActiveModelId = useAppStore((s) => s.setActiveModelId);
  const active = MODELS.find((m) => m.id === activeModelId) ?? MODELS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Selecionar modelo de IA"
          className="flex items-center gap-1 rounded transition-colors hover:bg-[var(--gv2-active-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv2-brand)]"
          style={{
            padding: "6px 10px",
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 400,
            fontSize: "15px",
            color: "var(--gv2-text-secondary)",
          }}
        >
          <span>{active.label}</span>
          <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        sideOffset={6}
        className="min-w-[240px]"
      >
        <DropdownMenuLabel className="text-xs uppercase tracking-wider text-[var(--text-tertiary)]">
          Modelos
        </DropdownMenuLabel>
        {MODELS.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onSelect={() => void setActiveModelId(m.id)}
            className="flex flex-col items-start gap-0.5 text-xs"
          >
            <span className="font-medium text-[var(--text-primary)]">
              {m.label}
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)]">
              {m.description}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SendButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Enviar mensagem"
      style={{
        width: "31px",
        height: "32px",
        background: "var(--gv2-brand-button)",
        borderRadius: "8px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "opacity 120ms",
      }}
    >
      <SendHorizontal className="h-4 w-4" color="#000" strokeWidth={1.5} />
    </button>
  );
}

interface SkillPillsProps {
  skills: Skill[];
  disabled: boolean;
  onActivate: (name: string) => void;
}

function SkillPills({ skills, disabled, onActivate }: SkillPillsProps) {
  return (
    <div
      className="flex flex-wrap items-center justify-center"
      style={{ gap: "10px" }}
    >
      {skills.map((skill) => (
        <button
          key={skill.name}
          type="button"
          onClick={() => onActivate(skill.name)}
          disabled={disabled}
          className="flex items-center transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv2-brand)]"
          style={{
            background: "#FCFBF9",
            border: "1px solid var(--gv2-input-border)",
            borderRadius: "10px",
            padding: "15px 20px",
            backdropFilter: "blur(8.8px)",
            WebkitBackdropFilter: "blur(8.8px)",
            gap: "8px",
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          <FileText
            style={{ width: "10px", height: "12px" }}
            strokeWidth={1.5}
            color="var(--gv2-text-secondary)"
          />
          <span
            className="truncate font-mono"
            style={{
              fontFamily: "Inter, system-ui, sans-serif",
              fontWeight: 400,
              fontSize: "12px",
              color: "var(--gv2-text-secondary)",
              maxWidth: "180px",
            }}
          >
            {skill.name}
          </span>
        </button>
      ))}
    </div>
  );
}
