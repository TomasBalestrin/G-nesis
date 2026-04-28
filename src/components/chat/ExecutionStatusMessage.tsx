import { useMemo } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { useExecutionStore } from "@/stores/executionStore";
import type { ChatMessage } from "@/types/chat";

interface ExecutionStatusMessageProps {
  message: ChatMessage;
}

type StatusKind = "running" | "success" | "failed";

interface ParsedStatus {
  kind: StatusKind;
  /** Content with the leading emoji + space stripped — that emoji is
   *  re-rendered as a styled icon. */
  body: string;
}

/**
 * Inline ⏳/✅/❌ progress entry. Smaller, sutil, monospace — sits
 * between regular bubbles in the chat stream and is the replacement
 * for the old `<ExecutionMessage>` modal-style card.
 *
 * The kind ("running" / "success" / "failed") is derived from the
 * leading emoji in the persisted content (⏳ / ✅ / ❌). The backend
 * inserts these strings verbatim via `insert_execution_status_message`
 * — keeping the discriminator in the content (instead of a separate
 * column) means the message also reads naturally if rendered as plain
 * text (e.g. exported transcript).
 *
 * Logs are pulled from `useExecutionStore.logs` keyed by the step_id
 * extracted from the body. Live executions populate the store; on
 * conversation reload the store is empty, so historical status
 * messages render without the `<details>` block — by design (logs
 * weren't persisted in F1).
 */
export function ExecutionStatusMessage({
  message,
}: ExecutionStatusMessageProps) {
  const status = useMemo(() => parseStatus(message.content), [message.content]);

  const activeExecution = useExecutionStore((s) => s.activeExecution);
  const stepKey = useMemo(() => extractStepKey(status.body), [status.body]);
  const logs = useExecutionStore((s) =>
    stepKey ? (s.logs.get(stepKey) ?? []) : [],
  );

  // The ⏳ should animate while the execution that produced it is still
  // running. After it ends (terminal status or page reload), the icon
  // freezes — historical context only.
  const isLive =
    status.kind === "running" &&
    activeExecution !== null &&
    activeExecution.id === message.execution_id &&
    activeExecution.status === "running";

  const { Icon, color, spin } = iconFor(status.kind, isLive);

  return (
    <div className="flex w-full justify-start">
      <article
        className={cn(
          "max-w-[80%] rounded-md border border-[var(--border-sub)]/60",
          "bg-[var(--bg-secondary)]/40 px-3 py-1.5",
          "text-xs leading-relaxed",
        )}
        role="status"
        aria-live={isLive ? "polite" : "off"}
      >
        <div className="flex items-start gap-2">
          <Icon
            className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", color, spin && "animate-spin")}
            aria-hidden="true"
          />
          <div className={cn("min-w-0 flex-1 font-mono", color)}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={INLINE_MARKDOWN}
            >
              {status.body}
            </ReactMarkdown>
          </div>
        </div>

        {logs.length > 0 ? (
          <details className="mt-1.5 ml-5">
            <summary className="cursor-pointer text-[var(--text-3)] hover:text-[var(--text-2)]">
              Ver logs ({logs.length})
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-tertiary)]/50 p-2 font-mono text-[11px] text-[var(--text-secondary)]">
              {logs.join("\n")}
            </pre>
          </details>
        ) : null}
      </article>
    </div>
  );
}

/** Markdown component overrides that flatten paragraphs into spans —
 *  status messages are single-line, the default `<p>` margin would
 *  push them around. Strong/em stay native so **bold** still renders. */
const INLINE_MARKDOWN = {
  p: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
} as const;

function parseStatus(content: string): ParsedStatus {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("⏳")) {
    return { kind: "running", body: trimmed.slice("⏳".length).trimStart() };
  }
  if (trimmed.startsWith("✅")) {
    return { kind: "success", body: trimmed.slice("✅".length).trimStart() };
  }
  if (trimmed.startsWith("❌")) {
    return { kind: "failed", body: trimmed.slice("❌".length).trimStart() };
  }
  // Defensive fallback — shouldn't happen since the backend always
  // prefixes the emoji, but render as "running" rather than crash.
  return { kind: "running", body: trimmed };
}

function iconFor(kind: StatusKind, isLive: boolean) {
  if (kind === "running") {
    return {
      Icon: Loader2,
      color: "text-[var(--text-secondary)]",
      spin: isLive,
    };
  }
  if (kind === "success") {
    return {
      Icon: CheckCircle2,
      color: "text-[var(--success)]",
      spin: false,
    };
  }
  return {
    Icon: XCircle,
    color: "text-[var(--error)]",
    spin: false,
  };
}

/** Recover the orchestrator's `step_id` (e.g. `"step_1"`,
 *  `"extract_audio"`) from a body like `"Step step_1 — Executando..."`.
 *  useExecution writes the step_id verbatim after the "Step " word, so
 *  the logs store key matches the capture directly — no prefix
 *  manipulation needed (which broke for non-numeric ids in earlier
 *  drafts). Returns null when no step token is present (e.g. the
 *  skill-level "Skill X concluída" rolled-up messages). */
function extractStepKey(body: string): string | null {
  const match = body.match(/Step\s+([\w-]+)/i);
  return match ? match[1] : null;
}
