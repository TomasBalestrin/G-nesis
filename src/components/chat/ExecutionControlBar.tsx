import { useState } from "react";
import { Ban, Loader2, Pause, Play } from "lucide-react";

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
import type { Execution } from "@/types/project";

/**
 * Thin floating bar above the chat input — only renders while a skill
 * is `running` or `paused`. Replaces the abort/pause controls that
 * used to live inside the ExecutionMessage card (deleted in F4) so the
 * chat stream stays clean while execution control stays one click away.
 *
 * Reads `activeExecution` from the store. Hides itself for terminal
 * statuses (completed/failed/aborted) and when no execution is in
 * flight, so the layout collapses without leaving an empty bar.
 */
export function ExecutionControlBar() {
  const activeExecution = useExecutionStore((s) => s.activeExecution);

  if (!activeExecution) return null;
  if (
    activeExecution.status !== "running" &&
    activeExecution.status !== "paused"
  ) {
    return null;
  }

  return (
    <div
      className="border-t border-[var(--border-sub)] bg-[var(--bg-secondary)]/60 px-4 py-2"
      role="region"
      aria-label={`Controle de execução de ${activeExecution.skill_name}`}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <Loader2
            className={`h-3.5 w-3.5 shrink-0 text-[var(--accent)] ${
              activeExecution.status === "running" ? "animate-spin" : ""
            }`}
            aria-hidden="true"
          />
          <span className="truncate font-mono text-[var(--text-secondary)]">
            {activeExecution.status === "paused" ? "Pausada — " : "Executando "}
            <span className="text-[var(--text-primary)]">
              {activeExecution.skill_name}
            </span>
          </span>
        </div>
        <Controls
          executionId={activeExecution.id}
          status={activeExecution.status}
        />
      </div>
    </div>
  );
}

interface ControlsProps {
  executionId: string;
  status: Execution["status"];
}

function Controls({ executionId, status }: ControlsProps) {
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
          <Pause className="h-3.5 w-3.5" />
          Pausar
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => call(resumeExecution, "Retomar")}
        >
          <Play className="h-3.5 w-3.5" />
          Retomar
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="destructive"
        disabled={busy}
        onClick={() => setConfirmAbort(true)}
      >
        <Ban className="h-3.5 w-3.5" />
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
