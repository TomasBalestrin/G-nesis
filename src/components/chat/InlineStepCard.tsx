import { useEffect, useRef } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ExecutionStep, StepStatus, Tool } from "@/types/project";

interface InlineStepCardProps {
  step: ExecutionStep;
  expanded: boolean;
  onToggle: () => void;
  /** Live stdout/stderr lines for this step from useExecutionStore.logs. */
  logs: string[];
}

/**
 * Single-step row inside an ExecutionMessage. Status icon, step id, tool
 * badge, elapsed time, retry counter; expanded view reveals streaming logs
 * (auto-scroll to bottom) and stderr in the error color when failed.
 *
 * No event subscriptions of its own — the parent ExecutionMessage drives
 * all state via props so ticking the elapsed-time counter doesn't trigger
 * a re-render of every row independently.
 */
export function InlineStepCard({
  step,
  expanded,
  onToggle,
  logs,
}: InlineStepCardProps) {
  const { icon: Icon, color, spin } = iconFor(step.status);
  const elapsed = currentDurationMs(step);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-l-4 border-[var(--border-sub)]",
        borderColorFor(step.status),
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-100 hover:bg-[var(--bg-hover)]"
      >
        <Icon className={cn("h-4 w-4 shrink-0", color, spin && "animate-spin")} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs font-semibold">
            {step.step_id}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
            <ToolBadge tool={step.tool} />
            <span>{labelForStep(step.status)}</span>
            {elapsed !== null ? (
              <span className="font-mono">{formatDuration(elapsed)}</span>
            ) : null}
            {step.retries > 0 ? (
              <span className="text-[var(--warning)]">retries: {step.retries}</span>
            ) : null}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        )}
      </button>
      {expanded ? (
        <StepLogs
          logs={logs}
          stderr={step.status === "failed" ? step.error : null}
        />
      ) : null}
    </div>
  );
}

function StepLogs({ logs, stderr }: { logs: string[]; stderr: string | null }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [logs.length, stderr]);

  if (logs.length === 0 && !stderr) {
    return (
      <div className="bg-[var(--code-bg)] px-3 py-2 font-mono text-[11px] italic text-[var(--text-tertiary)]">
        Sem logs ainda.
      </div>
    );
  }
  return (
    <div className="max-h-64 overflow-y-auto bg-[var(--code-bg)] px-3 py-2 font-mono text-[11px]">
      {logs.map((line, i) => (
        <div
          key={i}
          className="whitespace-pre-wrap break-words text-[var(--code-tx)]"
        >
          {line || " "}
        </div>
      ))}
      {stderr ? (
        <div className="mt-2 whitespace-pre-wrap break-words text-[var(--error)]">
          {stderr}
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

export function ToolBadge({ tool }: { tool: Tool }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0 font-mono text-[10px] font-semibold",
        toolStyles(tool),
      )}
    >
      {tool}
    </span>
  );
}

function toolStyles(tool: Tool): string {
  switch (tool) {
    case "bash":
      return "bg-[var(--tool-bash-soft)] text-[var(--tool-bash)]";
    case "claude-code":
      return "bg-[var(--tool-claude-code-soft)] text-[var(--tool-claude-code)]";
    case "api":
      return "bg-[var(--tool-api-soft)] text-[var(--tool-api)]";
  }
}

interface IconSpec {
  icon: LucideIcon;
  color: string;
  spin?: boolean;
}

function iconFor(status: StepStatus): IconSpec {
  switch (status) {
    case "pending":
      return { icon: Circle, color: "text-[var(--text-tertiary)]" };
    case "running":
      return { icon: Loader2, color: "text-[var(--accent)]", spin: true };
    case "success":
      return { icon: CheckCircle2, color: "text-[var(--success)]" };
    case "failed":
      return { icon: XCircle, color: "text-[var(--error)]" };
    case "skipped":
      return { icon: Circle, color: "text-[var(--text-tertiary)]" };
  }
}

function borderColorFor(status: StepStatus): string {
  switch (status) {
    case "running":
      return "border-l-[var(--accent)]";
    case "success":
      return "border-l-[var(--success)]";
    case "failed":
      return "border-l-[var(--error)]";
    default:
      return "border-l-[var(--border-sub)]";
  }
}

function labelForStep(status: StepStatus): string {
  switch (status) {
    case "pending":
      return "Aguardando";
    case "running":
      return "Executando";
    case "success":
      return "Concluído";
    case "failed":
      return "Falhou";
    case "skipped":
      return "Ignorado";
  }
}

function currentDurationMs(step: ExecutionStep): number | null {
  if (step.duration_ms !== null) return step.duration_ms;
  if (step.status !== "running" || !step.started_at) return null;
  const started = Date.parse(step.started_at);
  if (Number.isNaN(started)) return null;
  return Math.max(0, Date.now() - started);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  return `${minutes}m${remainder}s`;
}
