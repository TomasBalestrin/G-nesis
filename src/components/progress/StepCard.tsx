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

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ExecutionStep, StepStatus } from "@/types/project";

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
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none"
      >
        <Icon className={cn("h-4 w-4 shrink-0", color, spin && "animate-spin")} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-semibold">
            {step.step_id}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-2)]">
            <Badge variant="secondary" className="font-mono">
              {step.tool}
            </Badge>
            <span>{labelFor(step.status)}</span>
            {step.duration_ms !== null ? (
              <span className="font-mono">
                {formatDuration(step.duration_ms)}
              </span>
            ) : null}
            {step.retries > 0 ? (
              <span className="text-[var(--status-warning-tx)]">
                retries: {step.retries}
              </span>
            ) : null}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-3)]" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-3)]" />
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
      return { icon: Circle, color: "text-[var(--text-3)]" };
    case "running":
      return { icon: Loader2, color: "text-primary", spin: true };
    case "success":
      return { icon: CheckCircle2, color: "text-[var(--status-success)]" };
    case "failed":
      return { icon: XCircle, color: "text-[var(--status-error)]" };
    case "skipped":
      return { icon: SkipForward, color: "text-[var(--text-3)]" };
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
