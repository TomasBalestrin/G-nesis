import { useEffect, useState } from "react";
import { Ban, Link as LinkIcon, Pause, Play } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useExecution } from "@/hooks/useExecution";
import { useToast } from "@/hooks/useToast";
import {
  abortExecution,
  pauseExecution,
  resumeExecution,
} from "@/lib/tauri-bridge";
import { useExecutionStore } from "@/stores/executionStore";
import type { BadgeProps } from "@/components/ui/badge";
import type { ExecutionStatus } from "@/types/project";

import { ProgressBar } from "./ProgressBar";
import { StepCard } from "./StepCard";

export function ProgressDashboard() {
  useExecution();
  const activeExecution = useExecutionStore((s) => s.activeExecution);
  const steps = useExecutionStore((s) => s.steps);
  const logs = useExecutionStore((s) => s.logs);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { toast } = useToast();

  // Auto-expand the currently running step so logs are visible without clicks.
  useEffect(() => {
    const running = steps.find((s) => s.status === "running");
    if (running && expanded === null) {
      setExpanded(running.step_id);
    }
  }, [steps, expanded]);

  if (!activeExecution) {
    return <EmptyState />;
  }

  const completed = steps.filter((s) => s.status === "success").length;
  const total =
    activeExecution.total_steps > 0 ? activeExecution.total_steps : steps.length;

  async function onControl(
    fn: (args: { executionId: string }) => Promise<void>,
    label: string,
  ) {
    if (!activeExecution) return;
    try {
      await fn({ executionId: activeExecution.id });
      toast({ title: `${label} enviado` });
    } catch (err) {
      toast({
        title: `Falha ao ${label.toLowerCase()}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  const isRunning = activeExecution.status === "running";
  const isPaused = activeExecution.status === "paused";
  const isTerminal = ["completed", "failed", "aborted"].includes(
    activeExecution.status,
  );

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="border-b border-border px-6 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-mono text-lg font-semibold">
              {activeExecution.skill_name}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-2)]">
              execução {activeExecution.id.slice(0, 8)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={activeExecution.status} />
            {isRunning ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onControl(pauseExecution, "Pausar")}
              >
                <Pause className="h-4 w-4" />
                Pausar
              </Button>
            ) : null}
            {isPaused ? (
              <Button
                size="sm"
                onClick={() => onControl(resumeExecution, "Retomar")}
              >
                <Play className="h-4 w-4" />
                Retomar
              </Button>
            ) : null}
            {!isTerminal ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => onControl(abortExecution, "Abortar")}
              >
                <Ban className="h-4 w-4" />
                Abortar
              </Button>
            ) : null}
          </div>
        </div>
        <ProgressBar completed={completed} total={total} />
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-2 p-6">
          {steps.length === 0 ? (
            <WaitingState />
          ) : (
            steps.map((step) => (
              <StepCard
                key={step.step_id}
                step={step}
                expanded={expanded === step.step_id}
                onToggle={() =>
                  setExpanded(
                    expanded === step.step_id ? null : step.step_id,
                  )
                }
                logs={logs.get(step.step_id) ?? []}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StatusBadge({ status }: { status: ExecutionStatus }) {
  const variant: BadgeProps["variant"] = (() => {
    switch (status) {
      case "completed":
        return "success";
      case "failed":
      case "aborted":
        return "destructive";
      case "paused":
        return "warning";
      case "running":
      case "pending":
      default:
        return "info";
    }
  })();
  return <Badge variant={variant}>{status}</Badge>;
}

function WaitingState() {
  return (
    <div className="py-12 text-center text-sm text-[var(--text-2)]">
      Aguardando primeiro step...
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-2)]">
        <LinkIcon className="h-5 w-5" />
      </div>
      <p className="text-sm text-[var(--text-2)]">
        Nenhuma execução ativa.
      </p>
      <Button asChild>
        <Link to="/">Ir para Chat</Link>
      </Button>
    </div>
  );
}
