import { useEffect, useRef, useState } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  Pause,
  Play,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  abortExecution,
  pauseExecution,
  resumeExecution,
} from "@/lib/tauri-bridge";
import { useExecutionStore } from "@/stores/executionStore";
import type { Execution, ExecutionStep, StepStatus, Tool } from "@/types/project";

const TERMINAL: ReadonlyArray<Execution["status"]> = [
  "completed",
  "failed",
  "aborted",
];

/**
 * Inline execution surface rendered inside the chat stream after a skill is
 * launched. Reads streaming state from the execution store (kept up to date
 * by useExecution), so it just needs to subscribe — no IPC of its own.
 *
 * One block per active execution. When the execution reaches a terminal
 * status the block locks into a final-summary state but stays visible so
 * the user has a record of what ran.
 */
export function ExecutionBlock() {
  const activeExecution = useExecutionStore((s) => s.activeExecution);
  const steps = useExecutionStore((s) => s.steps);
  const logs = useExecutionStore((s) => s.logs);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Tick once per second so running steps refresh their elapsed time.
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const running = steps.some((s) => s.status === "running");
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [steps]);

  // Auto-expand the running step + any failed step.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const s of steps) {
        if ((s.status === "running" || s.status === "failed") && !next.has(s.step_id)) {
          next.add(s.step_id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [steps]);

  if (!activeExecution) return null;

  const completed = steps.filter((s) => s.status === "success").length;
  const total =
    activeExecution.total_steps > 0 ? activeExecution.total_steps : steps.length;
  const isTerminal = TERMINAL.includes(activeExecution.status);

  function toggle(stepId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }

  return (
    <div
      className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-sm"
      role="region"
      aria-label={`Execução de ${activeExecution.skill_name}`}
    >
      <BlockHeader
        execution={activeExecution}
        completed={completed}
        total={total}
      />
      <div className="space-y-2 px-4 pb-3">
        {steps.length === 0 ? (
          <div className="py-3 text-xs text-[var(--text-secondary)]">
            Aguardando primeiro step...
          </div>
        ) : (
          steps.map((step) => (
            <StepRow
              key={step.step_id}
              step={step}
              expanded={expanded.has(step.step_id)}
              onToggle={() => toggle(step.step_id)}
              logs={logs.get(step.step_id) ?? []}
            />
          ))
        )}
      </div>
      {isTerminal ? (
        <FinalSummary execution={activeExecution} steps={steps} />
      ) : null}
    </div>
  );
}

interface BlockHeaderProps {
  execution: Execution;
  completed: number;
  total: number;
}

function BlockHeader({ execution, completed, total }: BlockHeaderProps) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  const isTerminal = TERMINAL.includes(execution.status);

  return (
    <header className="px-4 pb-3 pt-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-mono text-sm font-semibold">
            {execution.skill_name}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            {completed}/{total || "?"} steps · {labelFor(execution.status)}
          </p>
        </div>
        {!isTerminal ? <InlineControls executionId={execution.id} status={execution.status} /> : null}
      </div>
      <ProgressTrack pct={pct} status={execution.status} />
    </header>
  );
}

interface InlineControlsProps {
  executionId: string;
  status: Execution["status"];
}

function InlineControls({ executionId, status }: InlineControlsProps) {
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function call(
    fn: (args: { executionId: string }) => Promise<void>,
    label: string,
  ) {
    setBusy(true);
    try {
      await fn({ executionId });
      toast({ title: `${label} enviado` });
    } catch (err) {
      toast({
        title: `Falha ao ${label.toLowerCase()}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status === "running" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => call(pauseExecution, "Pausar")}
        >
          <Pause className="h-4 w-4" />
          Pausar
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => call(resumeExecution, "Retomar")}
        >
          <Play className="h-4 w-4" />
          Retomar
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={() => setConfirmAbort(true)}
      >
        <Ban className="h-4 w-4" />
        Abortar
      </Button>

      <Dialog open={confirmAbort} onOpenChange={setConfirmAbort}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Abortar execução?</DialogTitle>
            <DialogDescription>
              A execução será interrompida no próximo checkpoint. Steps em
              andamento serão cancelados. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmAbort(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setConfirmAbort(false);
                await call(abortExecution, "Abortar");
              }}
            >
              Confirmar abort
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProgressTrack({
  pct,
  status,
}: {
  pct: number;
  status: Execution["status"];
}) {
  const fill =
    status === "failed" || status === "aborted"
      ? "bg-[var(--error)]"
      : status === "completed"
        ? "bg-[var(--success)]"
        : "bg-[var(--accent)]";
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn("h-full transition-all duration-300", fill)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

interface StepRowProps {
  step: ExecutionStep;
  expanded: boolean;
  onToggle: () => void;
  logs: string[];
}

function StepRow({ step, expanded, onToggle, logs }: StepRowProps) {
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
        <StepLogs logs={logs} stderr={step.status === "failed" ? step.error : null} />
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

function FinalSummary({
  execution,
  steps,
}: {
  execution: Execution;
  steps: ExecutionStep[];
}) {
  const total = totalElapsedMs(execution);
  if (execution.status === "completed") {
    return (
      <footer className="flex items-center gap-2 border-t border-[var(--border-sub)] px-4 py-3 text-xs text-[var(--success)]">
        <CheckCircle2 className="h-4 w-4" />
        <span>
          Skill concluída
          {total !== null ? ` em ${formatDuration(total)}` : ""}.
        </span>
      </footer>
    );
  }
  if (execution.status === "failed") {
    const failed = steps.find((s) => s.status === "failed");
    return (
      <footer className="flex items-center gap-2 border-t border-[var(--border-sub)] px-4 py-3 text-xs text-[var(--error)]">
        <XCircle className="h-4 w-4" />
        <span>
          {failed
            ? `Falhou no step ${failed.step_id}.`
            : "Execução falhou."}
        </span>
      </footer>
    );
  }
  if (execution.status === "aborted") {
    return (
      <footer className="flex items-center gap-2 border-t border-[var(--border-sub)] px-4 py-3 text-xs text-[var(--warning)]">
        <Ban className="h-4 w-4" />
        <span>Execução abortada.</span>
      </footer>
    );
  }
  return null;
}

function ToolBadge({ tool }: { tool: Tool }) {
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

function labelFor(status: Execution["status"]): string {
  switch (status) {
    case "pending":
      return "Aguardando";
    case "running":
      return "Executando";
    case "paused":
      return "Pausada";
    case "completed":
      return "Concluída";
    case "failed":
      return "Falhou";
    case "aborted":
      return "Abortada";
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

function totalElapsedMs(execution: Execution): number | null {
  if (!execution.started_at) return null;
  const started = Date.parse(execution.started_at);
  if (Number.isNaN(started)) return null;
  const end = execution.finished_at
    ? Date.parse(execution.finished_at)
    : Date.now();
  if (Number.isNaN(end)) return null;
  return Math.max(0, end - started);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  return `${minutes}m${remainder}s`;
}
