import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Route, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTauriCommand } from "@/hooks/useTauriCommand";
import { useToast } from "@/hooks/useToast";
import {
  deleteCaminho,
  getExecutionHistory,
  listCaminhos,
} from "@/lib/tauri-bridge";
import type { BadgeProps } from "@/components/ui/badge";
import type { Caminho } from "@/types/caminho";
import type { Execution, ExecutionStatus } from "@/types/project";

/**
 * Detail page for `/caminhos/:id`. Renamed clone of ProjectDetail —
 * lists a single caminho's metadata + execution history. The history
 * query stays on `getExecutionHistory({ projectId })` because the
 * underlying schema column is still `executions.project_id` (alias
 * lives at the API surface, not the DB).
 */
export function CaminhoDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const caminhosQuery = useTauriCommand(listCaminhos);
  const historyQuery = useTauriCommand(getExecutionHistory);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    caminhosQuery.execute();
  }, [caminhosQuery.execute]);

  useEffect(() => {
    if (id) historyQuery.execute({ projectId: id });
  }, [historyQuery.execute, id]);

  const caminho: Caminho | undefined = useMemo(
    () => caminhosQuery.data?.find((p) => p.id === id),
    [caminhosQuery.data, id],
  );

  useEffect(() => {
    if (caminhosQuery.error) {
      toast({
        title: "Falha ao carregar caminho",
        description: caminhosQuery.error,
        variant: "destructive",
      });
    }
  }, [caminhosQuery.error, toast]);

  useEffect(() => {
    if (historyQuery.error) {
      toast({
        title: "Falha ao carregar histórico",
        description: historyQuery.error,
        variant: "destructive",
      });
    }
  }, [historyQuery.error, toast]);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteCaminho({ id });
      toast({ title: "Caminho removido" });
      navigate("/caminhos");
    } catch (err) {
      toast({
        title: "Falha ao remover caminho",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (caminhosQuery.loading && !caminhosQuery.data) {
    return <SingleLine message="Carregando caminho..." />;
  }

  if (!caminho) {
    return <MissingCaminho id={id} />;
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/caminhos">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-lg font-semibold">
            <Route className="h-4 w-4 text-[var(--text-3)]" />
            {caminho.name}
          </h2>
          <p className="truncate font-mono text-xs text-[var(--text-2)]">
            {caminho.repo_path}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmDelete(true)}
          disabled={deleting}
        >
          <Trash2 className="h-4 w-4" />
          Remover
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          <section aria-label="Informações">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-3)]">
              Informações
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <InfoRow label="ID" value={caminho.id} mono />
              <InfoRow label="Criado" value={formatDate(caminho.created_at)} />
              <InfoRow
                label="Atualizado"
                value={formatDate(caminho.updated_at)}
              />
            </dl>
          </section>

          <section aria-label="Histórico de execuções">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-3)]">
              Histórico de execuções
            </h3>
            {historyQuery.loading && !historyQuery.data ? (
              <p className="text-sm text-[var(--text-2)]">
                Carregando histórico...
              </p>
            ) : historyQuery.data && historyQuery.data.length > 0 ? (
              <ul className="space-y-2">
                {historyQuery.data.map((exec) => (
                  <ExecutionRow key={exec.id} execution={exec} />
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-border bg-[var(--bg-subtle)] px-4 py-6 text-center text-sm text-[var(--text-2)]">
                Nenhuma execução registrada para este caminho.
              </p>
            )}
          </section>
        </div>
      </ScrollArea>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover caminho?</DialogTitle>
            <DialogDescription>
              O caminho <span className="font-mono">{caminho.name}</span> e
              todo o histórico de execuções serão apagados. Os arquivos no
              disco não são tocados. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Removendo..." : "Confirmar remoção"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface InfoRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function InfoRow({ label, value, mono }: InfoRowProps) {
  return (
    <>
      <dt className="text-[var(--text-2)]">{label}</dt>
      <dd className={mono ? "truncate font-mono text-xs" : "truncate"}>
        {value}
      </dd>
    </>
  );
}

function ExecutionRow({ execution }: { execution: Execution }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm">{execution.skill_name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--text-2)]">
          <span>{formatDate(execution.created_at)}</span>
          <span>·</span>
          <span>
            {execution.completed_steps}/{execution.total_steps} steps
          </span>
        </div>
      </div>
      <StatusBadge status={execution.status} />
    </li>
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

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function SingleLine({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[var(--text-2)]">
      {message}
    </div>
  );
}

function MissingCaminho({ id }: { id: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-[var(--text-2)]">
        Caminho <span className="font-mono">{id}</span> não encontrado.
      </p>
      <Button asChild>
        <Link to="/caminhos">Voltar para a lista</Link>
      </Button>
    </div>
  );
}
