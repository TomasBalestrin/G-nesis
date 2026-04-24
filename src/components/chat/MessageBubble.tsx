import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { executeSkill, listProjects, safeInvoke } from "@/lib/tauri-bridge";
import type { ChatMessage } from "@/types/chat";
import type { Project } from "@/types/project";

interface MessageBubbleProps {
  message: ChatMessage;
}

// Assistant confirmation messages end with this sentence (see
// commands/chat.rs render_confirmation). Matching on it is how we detect
// "this bubble is a skill preview" without any extra metadata on ChatMessage.
const CONFIRMATION_MARKER = "Selecione um projeto e use o botão **Executar**";
// Skill name in the confirmation is the first **`...`** span (bold + inline code).
// Step ids are **bare bold**, tool names are `bare code` — neither matches.
const SKILL_NAME_REGEX = /\*\*`([^`]+)`\*\*/;

function extractConfirmationSkill(message: ChatMessage): string | null {
  if (message.role !== "assistant") return null;
  if (!message.content.includes(CONFIRMATION_MARKER)) return null;
  return message.content.match(SKILL_NAME_REGEX)?.[1] ?? null;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const skillToExecute = extractConfirmationSkill(message);
  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <article
        className={cn(
          "max-w-[80%] text-sm leading-relaxed",
          isUser
            ? "rounded-2xl bg-[var(--chat-user-bg)] px-4 py-3 text-[var(--chat-user-text)]"
            // Assistant: no background, no border — pure content on the page.
            : "px-1 py-1 text-[var(--text-primary)]",
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {message.content}
        </ReactMarkdown>
        {skillToExecute ? (
          <SkillExecutePanel skillName={skillToExecute} />
        ) : null}
      </article>
    </div>
  );
}

interface SkillExecutePanelProps {
  skillName: string;
}

/**
 * Inline "▶ Executar" action for skill-preview bubbles. Fetches projects on
 * mount, lets the user pick one, and fires the execute_skill command. Once
 * triggered, the button locks to prevent double-starts — the user can still
 * monitor progress via /progress or the side panel at ≥1200px.
 */
function SkillExecutePanel({ skillName }: SkillExecutePanelProps) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length > 0) {
          setSelectedId(ps[0].id);
        }
      })
      .catch(() => setProjects([]));
  }, []);

  async function handleExecute() {
    if (!selectedId || started) return;
    setStarting(true);
    const executionId = await safeInvoke(
      () => executeSkill({ skillName, projectId: selectedId }),
      {
        successTitle: "Execução iniciada",
        errorTitle: "Falha ao executar skill",
      },
    );
    if (executionId) {
      setStarted(true);
    } else {
      setStarting(false);
    }
  }

  if (projects === null) {
    return (
      <div className="mt-3 text-xs text-[var(--text-2)]">
        Carregando projetos...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
        Nenhum projeto cadastrado.{" "}
        <Link
          to="/projects/new"
          className="text-primary underline underline-offset-2"
        >
          Cadastrar projeto
        </Link>{" "}
        para poder executar skills.
      </div>
    );
  }

  const selectId = `proj-select-${skillName}`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-sub)] pt-3">
      <label htmlFor={selectId} className="text-xs text-[var(--text-2)]">
        Projeto
      </label>
      <select
        id={selectId}
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={starting || started}
        className="h-8 rounded-md border border-[var(--input-bd)] bg-[var(--input-bg)] px-2 text-xs focus:border-primary focus:outline-none disabled:opacity-60"
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        onClick={handleExecute}
        disabled={!selectedId || starting || started}
        aria-label={`Executar ${skillName}`}
      >
        <Play className="h-4 w-4" />
        {started ? "Iniciada" : starting ? "Iniciando..." : "Executar"}
      </Button>
    </div>
  );
}

const mdComponents: Components = {
  p: ({ children }) => (
    <p className="mt-2 first:mt-0 whitespace-pre-wrap">{children}</p>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => (
    <h1 className="mb-2 mt-3 text-xl font-bold">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-3 text-lg font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-base font-semibold">{children}</h3>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-[var(--code-bg)] p-3 text-xs text-[var(--code-tx)] font-mono">
      {children}
    </pre>
  ),
  code: ({ className, children }) => (
    <code
      className={cn(
        "rounded bg-[var(--code-bg)] px-1 py-0.5 font-mono text-xs text-[var(--code-tx)]",
        className,
      )}
    >
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[var(--border-str)] pl-3 text-[var(--text-2)]">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-[var(--border-sub)] px-2 py-1">
      {children}
    </td>
  ),
};
