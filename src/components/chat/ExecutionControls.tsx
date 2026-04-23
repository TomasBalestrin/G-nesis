import { useState } from "react";
import { Ban, Pause, Play } from "lucide-react";

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
import {
  abortExecution,
  pauseExecution,
  resumeExecution,
} from "@/lib/tauri-bridge";
import { useExecutionStore } from "@/stores/executionStore";
import type { ExecutionStatus } from "@/types/project";

const TERMINAL_STATUSES: ExecutionStatus[] = ["completed", "failed", "aborted"];

/**
 * Inline execution controls for the chat surface. Only renders when there's
 * a live execution (non-terminal status). Abort goes through a confirm
 * dialog because it's destructive — pause/resume take effect immediately.
 */
export function ExecutionControls() {
  const activeExecution = useExecutionStore((s) => s.activeExecution);
  const [confirmAbort, setConfirmAbort] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  if (!activeExecution) return null;

  const status = activeExecution.status;
  if (TERMINAL_STATUSES.includes(status)) return null;

  const executionId = activeExecution.id;
  const isRunning = status === "running";
  const isPaused = status === "paused";

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

  async function confirmAndAbort() {
    setConfirmAbort(false);
    await call(abortExecution, "Abortar");
  }

  return (
    <div
      className="flex items-center gap-2 rounded-xl border border-[var(--primary-bd)] bg-[var(--primary-bg)] px-3 py-2"
      role="region"
      aria-label="Controles de execução"
    >
      <div className="min-w-0 flex-1 text-xs">
        <div className="truncate font-mono font-semibold text-[var(--primary-tx)]">
          {activeExecution.skill_name}
        </div>
        <div className="text-[var(--text-2)]">Status: {status}</div>
      </div>

      {isRunning ? (
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

      {isPaused ? (
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
              A skill <span className="font-mono">{activeExecution.skill_name}</span>{" "}
              será interrompida no próximo checkpoint. Steps em andamento
              serão cancelados. Esta ação não pode ser desfeita.
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
              onClick={confirmAndAbort}
              disabled={busy}
            >
              Confirmar abort
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
