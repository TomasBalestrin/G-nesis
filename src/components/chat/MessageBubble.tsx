import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Code2,
  Download,
  Eye,
  Loader2,
  Play,
  Save,
  XCircle,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  executeSkill,
  insertExecutionStatusMessage,
  installDependency,
  listCaminhos,
  safeInvoke,
  saveSkillFolder,
} from "@/lib/tauri-bridge";
import { useExecutionStore } from "@/stores/executionStore";
import { useSkillsStore } from "@/stores/skillsStore";
import type { ChatMessage } from "@/types/chat";
import type { Project } from "@/types/project";

import { ThinkingBlock } from "./ThinkingBlock";
import { ExecutionStatusMessage } from "./ExecutionStatusMessage";


interface MessageBubbleProps {
  message: ChatMessage;
  /**
   * Send a follow-up user message back into the chat. Used by inline panels
   * (skill execution, dependency install) to report outcomes to GPT.
   */
  onAutoSend?: (content: string) => void;
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
  /** Frontmatter `version` field. Empty string when absent. Hoje é
   *  exibido só como badge no card — todo save passa por
   *  `save_skill_folder` (v2 only desde F2). */
  version: string;
}
type Segment = TextSegment | SkillSegment;

const FENCE_REGEX = /```([\w-]*)\n([\s\S]*?)\n```/g;
// Frontmatter must lead the block; capture the `name:` value (kebab-case
// allowed plus `_`/`.`).
const FRONTMATTER_NAME_REGEX = /^---\s*\n[\s\S]*?\bname\s*:\s*["']?([A-Za-z0-9._-]+)["']?\s*\n[\s\S]*?\n---/;
// Same anchor — leading frontmatter required — and capture the
// version number/string. Quoted or bare both accepted; the hyphen-
// less char class keeps versions semantic ("2.0", "1.0.0").
const FRONTMATTER_VERSION_REGEX = /^---\s*\n[\s\S]*?\bversion\s*:\s*["']?([0-9.]+)["']?\s*\n[\s\S]*?\n---/;

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

    const versionMatch = body.match(FRONTMATTER_VERSION_REGEX);
    const version = versionMatch?.[1] ?? "";

    if (match.index > cursor) {
      segments.push({ type: "text", value: content.slice(cursor, match.index) });
    }
    segments.push({
      type: "skill",
      code: body,
      name: nameMatch[1],
      version,
    });
    cursor = match.index + full.length;
  }
  if (cursor < content.length) {
    segments.push({ type: "text", value: content.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", value: content }];
}

// Assistant phrasing that triggers the inline install/decline panel. Locked
// to this exact wording in the system prompt so detection stays simple.
const DEPENDENCY_REQUEST_REGEX =
  /Para fazer isso preciso do \*\*([A-Za-z0-9._+-]+)\*\*\.?\s*Posso instalar pra você/i;

function extractDependencyRequest(message: ChatMessage): string | null {
  if (message.role !== "assistant") return null;
  return message.content.match(DEPENDENCY_REQUEST_REGEX)?.[1] ?? null;
}

export function MessageBubble({ message, onAutoSend }: MessageBubbleProps) {
  // Defensive: ChatPanel already filters obvious garbage but a malformed
  // chat:message_inserted payload could still arrive optimistically;
  // bail out instead of letting markdown parsing crash the render tree.
  if (!message?.id || message.content == null) {
    console.warn("[MessageBubble] skipping malformed message:", message);
    return null;
  }

  // Inline ⏳/✅/❌ progress entries get their own component — different
  // visual (smaller, sutil, monospace) and no skill/dependency panel
  // detection. Short-circuit before any of the regular-bubble work.
  // Wrap the dispatch in a try/catch so a malformed execution-status
  // payload (no leading emoji, missing step_id token) renders as a
  // plain text bubble instead of crashing the tree.
  if (message.type === "execution-status") {
    try {
      return <ExecutionStatusMessage message={message} />;
    } catch (err) {
      console.warn("[MessageBubble] execution-status fallback:", err);
      // fall through to plain-text rendering below
    }
  }

  const isUser = message.role === "user";
  const skillToExecute = extractConfirmationSkill(message);
  const dependencyToInstall = extractDependencyRequest(message);
  const segments = useMemo(
    () => (isUser ? null : splitSegments(message.content)),
    [isUser, message.content],
  );
  // Treat presence of `thinking` as the streaming gate: while the assistant
  // text body is still empty, the model is mid-reasoning. Once content
  // lands the block collapses on its own (see ThinkingBlock effect).
  const hasThinking = !isUser && (message.thinking?.length ?? 0) > 0;
  const thinkingStreaming = hasThinking && message.content.trim().length === 0;

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
        {hasThinking ? (
          <ThinkingBlock
            thinking={message.thinking ?? ""}
            summary={message.thinking_summary}
            streaming={thinkingStreaming}
          />
        ) : null}
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
              <SkillPreviewCard
                key={i}
                code={seg.code}
                name={seg.name}
                version={seg.version}
              />
            ),
          )
        )}
        {dependencyToInstall ? (
          <DependencyConfirmPanel
            toolName={dependencyToInstall}
            onAutoSend={onAutoSend}
          />
        ) : null}
        {skillToExecute ? (
          <SkillExecutePanel skillName={skillToExecute} />
        ) : null}
      </article>
    </div>
  );
}

// ── dependency confirm panel ────────────────────────────────────────────────

type DependencyState =
  | { kind: "idle" }
  | { kind: "installing" }
  | { kind: "installed"; output: string }
  | { kind: "failed"; error: string }
  | { kind: "declined" };

interface DependencyConfirmPanelProps {
  toolName: string;
  onAutoSend?: (content: string) => void;
}

/**
 * Inline accept/decline UI for the assistant's "Posso instalar pra você?".
 * Yes runs `installDependency` directly (parallel install), then auto-sends
 * the outcome to chat so GPT can resume the task. No just declines via
 * auto-send and locks the panel.
 */
function DependencyConfirmPanel({
  toolName,
  onAutoSend,
}: DependencyConfirmPanelProps) {
  const [state, setState] = useState<DependencyState>({ kind: "idle" });

  async function handleYes() {
    setState({ kind: "installing" });
    try {
      const output = await installDependency({ name: toolName });
      setState({ kind: "installed", output });
      onAutoSend?.(`${toolName} instalado com sucesso. Pode continuar.`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setState({ kind: "failed", error });
      onAutoSend?.(`Falha ao instalar ${toolName}: ${error}`);
    }
  }

  function handleNo() {
    setState({ kind: "declined" });
    onAutoSend?.(
      `Não, prefiro não instalar ${toolName} agora. Sugira outra abordagem.`,
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-xs">
      {state.kind === "idle" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[var(--text-secondary)]">
            Genesis pode rodar <span className="font-mono">brew install {toolName}</span> agora.
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={handleYes}>
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sim, instalar
            </Button>
            <Button size="sm" variant="outline" onClick={handleNo}>
              <XCircle className="h-3.5 w-3.5" />
              Não
            </Button>
          </div>
        </div>
      ) : null}
      {state.kind === "installing" ? (
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
          Instalando <span className="font-mono">{toolName}</span>... pode levar alguns minutos.
        </div>
      ) : null}
      {state.kind === "installed" ? (
        <div className="flex items-center gap-2 text-[var(--success)]">
          <Download className="h-3.5 w-3.5" />
          <span className="font-mono">{toolName}</span> instalado.
        </div>
      ) : null}
      {state.kind === "failed" ? (
        <div className="flex items-start gap-2 text-[var(--error)]">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <div>Falha ao instalar <span className="font-mono">{toolName}</span>.</div>
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--text-secondary)]">
              {state.error}
            </pre>
          </div>
        </div>
      ) : null}
      {state.kind === "declined" ? (
        <div className="text-[var(--text-secondary)]">
          Instalação recusada.
        </div>
      ) : null}
    </div>
  );
}

interface SkillPreviewCardProps {
  code: string;
  name: string;
  /** Frontmatter `version` parseada do bloco. Apenas exibida como
   *  badge — todo save vai por `save_skill_folder` (v2 only desde F2). */
  version: string;
}

/**
 * Renderiza o bloco de skill `.md` gerado pelo assistente com duas
 * ações:
 *   - **Ver**: alterna entre rendered (markdown) e raw views.
 *   - **Salvar**: persiste via `save_skill_folder` que cria o layout
 *     v2 (`<name>/SKILL.md` + assets/ + references/ vazios). Refresh
 *     no skillsStore garante que sidebar e `/`-autocomplete pegam a
 *     entrada nova sem reload.
 */
function SkillPreviewCard({ code, name, version }: SkillPreviewCardProps) {
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState<"raw" | "rendered">("raw");
  const { toast } = useToast();

  const filenameLabel = `skills/${name}/SKILL.md`;

  async function handleSave() {
    if (saved) return;
    setSaving(true);
    try {
      await saveSkillFolder({ skillName: name, skillMd: code });
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-sub)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[var(--text-secondary)]">
            {filenameLabel}
          </span>
          {version ? (
            <span className="rounded-md bg-[var(--bg-secondary)] px-1.5 py-0 font-mono text-[10px] text-[var(--text-tertiary)]">
              v{version}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView((v) => (v === "raw" ? "rendered" : "raw"))}
            aria-label={
              view === "raw" ? "Ver markdown renderizado" : "Ver código raw"
            }
          >
            {view === "raw" ? (
              <>
                <Eye className="h-3.5 w-3.5" />
                Ver
              </>
            ) : (
              <>
                <Code2 className="h-3.5 w-3.5" />
                Raw
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={saving || saved}
            onClick={handleSave}
            aria-label={`Salvar skill ${name}`}
          >
            <Save className="h-3.5 w-3.5" />
            {saved ? "Salva" : saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </div>
      {view === "raw" ? (
        <pre className="max-h-96 overflow-auto bg-[var(--code-bg)] p-3 font-mono text-xs text-[var(--code-tx)]">
          {code}
        </pre>
      ) : (
        <div className="max-h-96 overflow-auto bg-[var(--bg-primary)] px-4 py-3 text-sm leading-relaxed text-[var(--text-primary)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {code}
          </ReactMarkdown>
        </div>
      )}
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
 * as inline `execution-status` messages in the chat (see useExecution hook
 * + ExecutionStatusMessage component); pause/abort controls live in
 * `<ExecutionControlBar>` above the input.
 *
 * Wires the route's conversationId into `executeSkill` so the backend
 * routes ⏳/✅/❌ messages back to this thread, and seeds
 * `useExecutionStore.activeExecution` with the real skill_name + project
 * before the first `execution:step_*` event lands — otherwise the
 * skill-completion message would render the placeholder
 * "(execução em andamento)" label.
 */
function SkillExecutePanel({ skillName }: SkillExecutePanelProps) {
  const { conversationId = "" } = useParams<{ conversationId: string }>();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [starting, setStarting] = useState(false);
  const [started, setStarted] = useState(false);
  const setActiveExecution = useExecutionStore((s) => s.setActiveExecution);

  useEffect(() => {
    // listCaminhos returns the same shape (Caminho = Project alias)
    // — local state still typed as Project for now; rename happens
    // when the wider `Project` type alias is retired.
    listCaminhos()
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
      () =>
        executeSkill({
          skillName,
          projectId: selectedId,
          conversationId: conversationId || null,
        }),
      {
        successTitle: "Execução iniciada",
        errorTitle: "Falha ao executar skill",
      },
    );
    if (executionId) {
      setStarted(true);

      // Seed the live store with real metadata so subsequent step
      // events don't fall back to "(execução em andamento)" — the
      // skill-completion message reads skill_name from here.
      const project = projects?.find((p) => p.id === selectedId);
      const nowIso = new Date().toISOString();
      setActiveExecution({
        id: executionId,
        project_id: selectedId,
        skill_name: skillName,
        status: "running",
        started_at: nowIso,
        finished_at: null,
        total_steps: 0,
        completed_steps: 0,
        created_at: nowIso,
        conversation_id: conversationId || null,
      });

      // Initial "⏳ Executando skill..." status message — covers the
      // window between executeSkill returning and the first
      // execution:step_started event landing (typically <500ms but
      // visible). Project name falls back to id if missing from list.
      const projectLabel = project?.name ?? selectedId;
      insertExecutionStatusMessage({
        executionId,
        content: `⏳ Executando skill **${skillName}** no caminho **${projectLabel}**...`,
        kind: "execution-status",
      }).catch((err) =>
        console.warn("[SkillExecutePanel] initial status msg failed:", err),
      );
    } else {
      setStarting(false);
    }
  }

  if (projects === null) {
    return (
      <div className="mt-3 text-xs text-[var(--text-2)]">
        Carregando caminhos...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-3 py-2 text-xs">
        Nenhum caminho cadastrado.{" "}
        <Link
          to="/caminhos/new"
          className="text-primary underline underline-offset-2"
        >
          Cadastrar caminho
        </Link>{" "}
        para poder executar skills.
      </div>
    );
  }

  const selectId = `proj-select-${skillName}`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-sub)] pt-3">
      <label htmlFor={selectId} className="text-xs text-[var(--text-2)]">
        Caminho
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
