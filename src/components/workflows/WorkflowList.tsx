import { useEffect } from "react";
import { GitBranch, Plus, Workflow } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useWorkflowsStore } from "@/stores/workflowsStore";

/**
 * Standalone catalog page for `/workflows`. Sidebar shows a compact list,
 * but the workflow ecosystem is richer than skills (each one chains
 * multiple skills with conditions), so a dedicated full-width page lists
 * triggers + descriptions side-by-side.
 */
export function WorkflowList() {
  const items = useWorkflowsStore((s) => s.items);
  const loading = useWorkflowsStore((s) => s.loading);
  const loaded = useWorkflowsStore((s) => s.loaded);
  const error = useWorkflowsStore((s) => s.error);
  const refresh = useWorkflowsStore((s) => s.refresh);
  const ensureLoaded = useWorkflowsStore((s) => s.ensureLoaded);

  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
          <Workflow className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Workflows</h1>
          <p className="text-xs text-[var(--text-secondary)]">
            Encadeamentos de skills com condições entre etapas.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Atualizando..." : "Atualizar"}
        </Button>
        <Button asChild>
          <Link to="/workflows/new">
            <Plus className="h-4 w-4" />
            Novo workflow
          </Link>
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-4xl p-6">
          {error ? (
            <div className="rounded-xl border border-[var(--error)] bg-[var(--error-soft)] p-4 text-sm text-[var(--error)]">
              Falha ao carregar workflows: {error}
            </div>
          ) : !loaded || (loading && items.length === 0) ? (
            <p className="text-sm text-[var(--text-secondary)]">
              Carregando...
            </p>
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="space-y-3">
              {items.map((wf) => (
                <li
                  key={wf.name}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <Link
                    to={`/workflows/${encodeURIComponent(wf.name)}`}
                    className="block"
                  >
                    <div className="flex items-start gap-3">
                      <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="truncate font-mono text-sm font-semibold">
                            {wf.name}
                          </span>
                          {wf.version ? (
                            <span className="text-[10px] text-[var(--text-tertiary)]">
                              v{wf.version}
                            </span>
                          ) : null}
                        </div>
                        {wf.description ? (
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            {wf.description}
                          </p>
                        ) : null}
                        {wf.triggers.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {wf.triggers.map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-2 py-0 font-mono text-[10px] text-[var(--accent)]"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
        <Workflow className="h-5 w-5" />
      </div>
      <p className="text-sm text-[var(--text-secondary)]">
        Nenhum workflow ainda.
      </p>
      <Button asChild>
        <Link to="/workflows/new">
          <Plus className="h-4 w-4" />
          Criar primeiro workflow
        </Link>
      </Button>
    </div>
  );
}
