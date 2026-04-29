import { useEffect, useState } from "react";
import { GitBranch, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

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
import { deleteWorkflow } from "@/lib/tauri-bridge";
import { useWorkflowsStore } from "@/stores/workflowsStore";
import type { WorkflowSummary } from "@/types/workflow";

/**
 * Settings → /settings/workflows. Catálogo de workflows com botão
 * Novo + delete inline. Click no card abre o viewer.
 */
export function SettingsWorkflowsSection() {
  const items = useWorkflowsStore((s) => s.items);
  const loaded = useWorkflowsStore((s) => s.loaded);
  const loading = useWorkflowsStore((s) => s.loading);
  const ensureLoaded = useWorkflowsStore((s) => s.ensureLoaded);
  const refresh = useWorkflowsStore((s) => s.refresh);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Workflows</h2>
          <p className="text-sm text-[var(--text-2)]">
            Procedimentos compostos que encadeiam skills.
          </p>
        </div>
        <Button asChild>
          <Link to="/workflows/new">
            <Plus className="h-4 w-4" />
            Novo workflow
          </Link>
        </Button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-3 p-6">
          {!loaded && loading ? (
            <p className="text-sm text-[var(--text-2)]">Carregando...</p>
          ) : items.length === 0 ? (
            <p className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-4 py-8 text-center text-sm text-[var(--text-2)]">
              Nenhum workflow ainda.
            </p>
          ) : (
            items.map((wf) => (
              <WorkflowCard key={wf.name} workflow={wf} onDeleted={refresh} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface WorkflowCardProps {
  workflow: WorkflowSummary;
  onDeleted: () => Promise<void>;
}

function WorkflowCard({ workflow, onDeleted }: WorkflowCardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const description = workflow.description.trim();

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await deleteWorkflow({ name: workflow.name });
      toast({ title: `Workflow ${workflow.name} deletado` });
      await onDeleted();
    } catch (err) {
      toast({
        title: "Falha ao deletar workflow",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/workflows/${encodeURIComponent(workflow.name)}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/workflows/${encodeURIComponent(workflow.name)}`);
        }
      }}
      className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
    >
      <GitBranch className="mt-1 h-4 w-4 shrink-0 text-[var(--text-3)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm font-medium">
          {workflow.name}
        </div>
        {description ? (
          <div className="mt-0.5 truncate text-xs text-[var(--text-2)]">
            {description}
          </div>
        ) : null}
        {workflow.triggers.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {workflow.triggers.map((t) => (
              <span
                key={t}
                className="rounded-full bg-[var(--bg-muted)] px-2 py-0.5 font-mono text-[10px] text-[var(--text-3)]"
              >
                {t}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Deletar ${workflow.name}`}
        onClick={(e) => {
          e.stopPropagation();
          setConfirmOpen(true);
        }}
        className="shrink-0 rounded p-1.5 text-[var(--text-3)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Deletar workflow?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{workflow.name}</span> será removido
              do <span className="font-mono">workflows_dir</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deletando..." : "Deletar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
