import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  SkipForward,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ExecutionStep, StepStatus, Tool } from "@/types/project";

import { LogViewer } from "./LogViewer";

interface StepCardProps {
  step: ExecutionStep;
  expanded: boolean;
  onToggle: () => void;
  logs: string[];
}

export function StepCard({ step, expanded, onToggle, logs }: StepCardProps) {
  const { icon: Icon, spin, color } = iconFor(step.status);
  const stderr = step.status === "failed" ? step.error : null;
  // Left border reflects status — visible even when the row is collapsed.
  const statusBorder = borderColorFor(step.status);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-sm border-l-4",
        statusBorder,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-100 hover:bg-[var(--bg-hover)] focus-visible:outline-none"
      >
        <Icon className={cn("h-4 w-4 shrink-0", color, spin && "animate-spin")} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-semibold">
            {step.step_id}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <ToolBadge tool={step.tool} />
            <span>{labelFor(step.status)}</span>
            {step.duration_ms !== null ? (
              <span className="font-mono">
                {formatDuration(step.duration_ms)}
              </span>
            ) : null}
            {step.retries > 0 ? (
              <span className="text-[var(--warning)]">
                retries: {step.retries}
              </span>
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
        <div className="border-t border-[var(--border-sub)]">
          <LogViewer lines={logs} stderr={stderr} />
        </div>
      ) : null}
    </div>
  );
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
      return { icon: SkipForward, color: "text-[var(--text-tertiary)]" };
  }
}

function borderColorFor(status: StepStatus): string {
  switch (status) {
    case "pending":
      return "border-l-[var(--border)]";
    case "running":
      return "border-l-[var(--accent)]";
    case "success":
      return "border-l-[var(--success)]";
    case "failed":
      return "border-l-[var(--error)]";
    case "skipped":
      return "border-l-[var(--text-tertiary)]";
  }
}

interface ToolBadgeProps {
  tool: Tool;
}

/**
 * Small pill next to the step id. Color-coded per tool family so a glance
 * at the progress list shows what kind of work each step is.
 */
export function ToolBadge({ tool }: ToolBadgeProps) {
  const styles = toolStyles(tool);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold",
        styles,
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

function labelFor(status: StepStatus): string {
  switch (status) {
    case "pending":
      return "Aguardando";
    case "running":
      return "Rodando";
    case "success":
      return "Concluído";
    case "failed":
      return "Falhou";
    case "skipped":
      return "Ignorado";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  return `${minutes}m${remainder}s`;
}
