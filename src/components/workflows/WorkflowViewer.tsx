import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Pencil,
  Play,
  XCircle,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  executeWorkflow,
  parseWorkflowFile,
  safeInvoke,
} from "@/lib/tauri-bridge";
import { useAppStore } from "@/stores/appStore";
import type { ParsedWorkflow, WorkflowStep } from "@/types/workflow";

/**
 * Read-only structured view of a workflow. Renders the meta header,
 * prerequisites, and a numbered etapas list with skill/condition/IO so the
 * user can audit the chain before running. Hands off to WorkflowEditor
 * via a Pencil button when changes are needed.
 *
 * Run button calls execute_workflow with the active project (from
 * appStore — same precedence as skill execution); the backend spawns
 * the WorkflowExecutor and emits `workflow:*` events that the chat
 * surface (future task) can subscribe to.
 */
export function WorkflowViewer() {
  const { name = "" } = useParams<{ name: string }>();
  const [workflow, setWorkflow] = useState<ParsedWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const activeProjectId = useAppStore((s) => s.activeProjectId);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    parseWorkflowFile({ name })
      .then((wf) => {
        if (!cancelled) setWorkflow(wf);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  async function handleRun() {
    if (running) return;
    setRunning(true);
    const id = await safeInvoke(
      () =>
        executeWorkflow({
          workflowName: name,
          projectId: activeProjectId || null,
        }),
      {
        successTitle: "Workflow iniciado",
        errorTitle: "Falha ao executar workflow",
      },
    );
    if (id) {
      // Backend emits workflow:* events; chat surface will pick them up
      // when E4 wires the inline view. For now toast carries the id.
      toast({
        title: "Execução iniciada",
        description: `id: ${id.slice(0, 8)}`,
      });
    }
    setRunning(false);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
          <GitBranch className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-lg font-semibold">{name}</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {loading
              ? "Carregando..."
              : workflow?.meta.description || "(sem descrição)"}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => navigate(`/workflows/${encodeURIComponent(name)}/edit`)}
          disabled={loading}
          aria-label={`Editar workflow ${name}`}
        >
          <Pencil className="h-4 w-4" />
          Editar
        </Button>
        <Button
          onClick={handleRun}
          disabled={loading || running || !workflow}
          aria-label={`Executar workflow ${name}`}
        >
          <Play className="h-4 w-4" />
          {running ? "Iniciando..." : "Executar"}
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {error ? (
            <div className="rounded-xl border border-[var(--error)] bg-[var(--error-soft)] p-4 text-sm text-[var(--error)]">
              <strong className="font-semibold">Workflow inválido:</strong>{" "}
              {error}
            </div>
          ) : !workflow ? (
            !loading ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Workflow não encontrado.
              </p>
            ) : null
          ) : (
            <>
              <MetaSection workflow={workflow} />
              {workflow.prerequisites.length > 0 ? (
                <PrerequisitesSection items={workflow.prerequisites} />
              ) : null}
              <EtapasSection steps={workflow.steps} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function MetaSection({ workflow }: { workflow: ParsedWorkflow }) {
  const { meta } = workflow;
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
        <dt className="text-[var(--text-tertiary)]">Versão</dt>
        <dd className="font-mono">{meta.version || "—"}</dd>
        <dt className="text-[var(--text-tertiary)]">Autor</dt>
        <dd>{meta.author || "—"}</dd>
        {meta.triggers.length > 0 ? (
          <>
            <dt className="text-[var(--text-tertiary)]">Triggers</dt>
            <dd className="flex flex-wrap gap-1.5">
              {meta.triggers.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-2 py-0 font-mono text-[10px] text-[var(--accent)]"
                >
                  {t}
                </span>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}

function PrerequisitesSection({ items }: { items: string[] }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
        Pré-requisitos
      </h3>
      <ul className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        {items.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EtapasSection({ steps }: { steps: WorkflowStep[] }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
        Etapas
      </h3>
      {steps.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
          Workflow sem etapas — edite para adicionar pelo menos uma.
        </p>
      ) : (
        <ol className="space-y-3">
          {steps.map((step, idx) => (
            <li key={step.id}>
              <EtapaCard step={step} order={idx + 1} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function EtapaCard({ step, order }: { step: WorkflowStep; order: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-soft)] font-mono text-xs font-semibold text-[var(--accent)]">
          {order}
        </span>
        <span className="font-mono text-sm font-semibold">{step.id}</span>
        <ConditionBadge condition={step.condition} />
      </div>
      {step.objective ? (
        <p className="mb-3 text-sm text-[var(--text-secondary)]">
          {step.objective}
        </p>
      ) : null}
      <dl className="grid grid-cols-[80px_1fr] gap-y-2 text-xs">
        <dt className="text-[var(--text-tertiary)]">Skill</dt>
        <dd>
          <Link
            to={`/settings/skill/${encodeURIComponent(step.skill)}`}
            className="font-mono text-[var(--accent)] underline underline-offset-2"
          >
            /{step.skill}
          </Link>
        </dd>
        {step.input ? (
          <>
            <dt className="text-[var(--text-tertiary)]">Input</dt>
            <dd className="font-mono text-[var(--text-primary)]">
              {step.input}
            </dd>
          </>
        ) : null}
        {Object.keys(step.inputs).length > 0 ? (
          <>
            <dt className="text-[var(--text-tertiary)]">Inputs</dt>
            <dd className="space-y-0.5">
              {Object.entries(step.inputs).map(([k, v]) => (
                <div key={k} className="font-mono">
                  <span className="text-[var(--text-secondary)]">{k}:</span>{" "}
                  <span>{v}</span>
                </div>
              ))}
            </dd>
          </>
        ) : null}
        {step.output ? (
          <>
            <dt className="text-[var(--text-tertiary)]">Output</dt>
            <dd className="flex items-center gap-1 font-mono">
              <ArrowRight className="h-3 w-3 text-[var(--text-tertiary)]" />
              {step.output}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}

function ConditionBadge({ condition }: { condition: string | null }) {
  if (!condition) return null;
  const lower = condition.trim().toLowerCase();
  const isFailure = lower.startsWith("falha") || lower.startsWith("fail");
  const isSuccess = lower.startsWith("suces") || lower === "success";
  const Icon = isFailure ? XCircle : isSuccess ? CheckCircle2 : null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0 text-[10px] font-semibold",
        isFailure
          ? "bg-[var(--error-soft)] text-[var(--error)]"
          : isSuccess
            ? "bg-[var(--success-soft)] text-[var(--success)]"
            : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {condition}
    </span>
  );
}
