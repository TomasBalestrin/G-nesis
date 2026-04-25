import { useEffect, useMemo, useState } from "react";
import { Play, Save } from "lucide-react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  executeSkill,
  listProjects,
  safeInvoke,
  saveSkill,
} from "@/lib/tauri-bridge";
import { useSkillsStore } from "@/stores/skillsStore";
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

// ── skill-block detection ───────────────────────────────────────────────────

interface TextSegment {
  type: "text";
  value: string;
}
interface SkillSegment {
  type: "skill";
  code: string;
  name: string;
}
type Segment = TextSegment | SkillSegment;

const FENCE_REGEX = /```([\w-]*)\n([\s\S]*?)\n```/g;
// Frontmatter must lead the block; capture the `name:` value (kebab-case
// allowed plus `_`/`.`).
const FRONTMATTER_NAME_REGEX = /^---\s*\n[\s\S]*?\bname\s*:\s*["']?([A-Za-z0-9._-]+)["']?\s*\n[\s\S]*?\n---/;

function splitSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  // RegExp.exec with /g maintains lastIndex; fresh instance each call so
  // re-renders don't see stale state.
  const re = new RegExp(FENCE_REGEX);
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const [full, , body] = match;
    const nameMatch = body.match(FRONTMATTER_NAME_REGEX);
    if (!nameMatch) continue;

    if (match.index > cursor) {
      segments.push({ type: "text", value: content.slice(cursor, match.index) });
    }
    segments.push({ type: "skill", code: body, name: nameMatch[1] });
    cursor = match.index + full.length;
  }
  if (cursor < content.length) {
    segments.push({ type: "text", value: content.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: content }];
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const skillToExecute = extractConfirmationSkill(message);
  const segments = useMemo(
    () => (isUser ? null : splitSegments(message.content)),
    [isUser, message.content],
  );

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
        {isUser || !segments ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {message.content}
          </ReactMarkdown>
        ) : (
          segments.map((seg, i) =>
            seg.type === "text" ? (
              <ReactMarkdown
                key={i}
                remarkPlugins={[remarkGfm]}
                components={mdComponents}
              >
                {seg.value}
              </ReactMarkdown>
            ) : (
              <SkillSavePanel key={i} code={seg.code} name={seg.name} />
            ),
          )
        )}
        {skillToExecute ? (
          <SkillExecutePanel skillName={skillToExecute} />
        ) : null}
      </article>
    </div>
  );
}

interface SkillSavePanelProps {
  code: string;
  name: string;
}

/**
 * Renders an assistant-generated skill `.md` block with a Save button. Saving
 * goes through the same backend path as the editor (validates frontmatter +
 * steps), then triggers a global skills-store refresh so the sidebar and
 * slash autocomplete pick up the new entry without a page reload.
 */
function SkillSavePanel({ code, name }: SkillSavePanelProps) {
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (saved) return;
    setSaving(true);
    try {
      await saveSkill({ name, content: code });
      setSaved(true);
      toast({ title: `Skill ${name} salva` });
      refreshSkills();
    } catch (err) {
      toast({
        title: "Falha ao salvar skill",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[var(--border-sub)] bg-[var(--bg-secondary)]">
      <div className="flex items-center justify-between border-b border-[var(--border-sub)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs">
        <span className="font-mono text-[var(--text-secondary)]">
          skills/{name}.md
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={saving || saved}
          onClick={handleSave}
          aria-label={`Salvar skill ${name}`}
        >
          <Save className="h-3.5 w-3.5" />
          {saved ? "Salva" : saving ? "Salvando..." : "Salvar Skill"}
        </Button>
      </div>
      <pre className="max-h-96 overflow-auto bg-[var(--code-bg)] p-3 font-mono text-xs text-[var(--code-tx)]">
        {code}
      </pre>
    </div>
  );
}

interface SkillExecutePanelProps {
  skillName: string;
}

/**
 * Inline "▶ Executar" action for skill-preview bubbles. Fetches projects on
 * mount, lets the user pick one, and fires the execute_skill command. Once
 * triggered, the button locks to prevent double-starts — progress streams
 * into the inline ExecutionBlock rendered below the chat messages.
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
