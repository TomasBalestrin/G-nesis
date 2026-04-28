import {
  useTauriEvent,
} from "./useTauriEvent";
import {
  analyzeStepFailure,
  insertExecutionStatusMessage,
} from "@/lib/tauri-bridge";
import { useExecutionStore } from "@/stores/executionStore";
import type { ExecutionStep, StepStatus } from "@/types/project";
import type {
  ExecutionCompletedEvent,
  LogEvent,
  StepCompletedEvent,
  StepFailedEvent,
  StepStartedEvent,
} from "@/types/events";

/**
 * Subscribe to executor events and keep the execution store in sync,
 * plus persist each event as an inline `execution-status` chat message
 * (see commands/chat.rs::insert_execution_status_message). On
 * `step_failed` also chains a GPT analysis call so the user sees the
 * placeholder ❌ immediately followed by a diagnosis bubble.
 *
 * The backend emits events keyed by the skill's logical `step_id`
 * ("step_1"), not the DB row UUID — so we upsert by that. On the first
 * `step_started` of a new execution_id we also seed `activeExecution`
 * with minimal fields, so the ExecutionControlBar (pause/abort) and
 * the live spinner in ExecutionStatusMessage have something to read
 * even though the executor doesn't emit a dedicated "started" event.
 *
 * No return value — this is a subscription side-effect hook.
 */
export function useExecution(): void {
  useTauriEvent("execution:step_started", (event: StepStartedEvent) => {
    // Fire-and-forget: persist a "⏳ Step X — Executando..." entry into
    // the chat. Backend resolves the conversation_id from the
    // executions row and emits chat:message_inserted on success, which
    // the live ChatPanel listens to. Errors are non-fatal — the live
    // store still drives any UI that reads activeExecution directly.
    insertExecutionStatusMessage({
      executionId: event.execution_id,
      content: `⏳ Step ${event.step_id} — Executando...`,
      kind: "execution-status",
    }).catch((err) =>
      console.warn("[useExecution] step_started persist failed:", err),
    );

    useExecutionStore.setState((state) => {
      // Seed activeExecution if absent or for a different id. The
      // SkillExecutePanel already seeds with the real skill_name +
      // project before the first step_started event lands; this is
      // only reached for executions started outside the chat (legacy
      // call sites, future programmatic triggers).
      const nextActive =
        state.activeExecution && state.activeExecution.id === event.execution_id
          ? state.activeExecution
          : {
              id: event.execution_id,
              project_id: "",
              skill_name: "(execução em andamento)",
              status: "running" as const,
              started_at: new Date().toISOString(),
              finished_at: null,
              total_steps: 0,
              completed_steps: 0,
              created_at: new Date().toISOString(),
              conversation_id: null,
            };

      // If we seeded a new execution, reset steps + logs.
      const resetting = nextActive !== state.activeExecution;
      const baseSteps = resetting ? [] : state.steps;
      const baseLogs = resetting ? new Map<string, string[]>() : state.logs;

      const idx = baseSteps.findIndex((s) => s.step_id === event.step_id);
      const now = new Date().toISOString();
      const steps =
        idx === -1
          ? [
              ...baseSteps,
              {
                id: event.step_id,
                execution_id: event.execution_id,
                step_id: event.step_id,
                step_order: baseSteps.length,
                tool: event.tool,
                status: "running" as StepStatus,
                input: "",
                output: null,
                error: null,
                retries: 0,
                started_at: now,
                finished_at: null,
                duration_ms: null,
                created_at: now,
              } satisfies ExecutionStep,
            ]
          : baseSteps.map((s, i) =>
              i === idx
                ? { ...s, status: "running" as StepStatus, started_at: s.started_at ?? now }
                : s,
            );

      return {
        activeExecution: nextActive,
        steps,
        logs: baseLogs,
      };
    });
  });

  useTauriEvent("execution:step_completed", (event: StepCompletedEvent) => {
    // Snapshot the step's started_at BEFORE the store update so the
    // duration label in the persisted "✅ Step X — Concluído (...)"
    // message reflects the actual run, not 0ms.
    const priorStep = useExecutionStore
      .getState()
      .steps.find((s) => s.step_id === event.step_id);
    const durationMs = computeDuration(priorStep?.started_at ?? null);

    useExecutionStore.setState((state) => ({
      steps: state.steps.map((s) =>
        s.step_id === event.step_id
          ? {
              ...s,
              status: event.status,
              output: event.output,
              finished_at: new Date().toISOString(),
              duration_ms: durationMs,
            }
          : s,
      ),
    }));

    if (event.status === "success") {
      insertExecutionStatusMessage({
        executionId: event.execution_id,
        content: `✅ Step ${event.step_id} — Concluído (${formatDuration(durationMs)})`,
        kind: "execution-status",
      }).catch((err) =>
        console.warn("[useExecution] step_completed persist failed:", err),
      );
    }
  });

  useTauriEvent("execution:step_failed", (event: StepFailedEvent) => {
    useExecutionStore.setState((state) => ({
      steps: state.steps.map((s) =>
        s.step_id === event.step_id
          ? {
              ...s,
              status: "failed" as StepStatus,
              error: event.error,
              retries: event.retry_count,
              finished_at: new Date().toISOString(),
              duration_ms: computeDuration(s.started_at),
            }
          : s,
      ),
    }));

    // Two-message failure flow: the placeholder ❌ lands first so the
    // user sees the failure immediately, then the GPT analysis (slow,
    // 2-5s) drops in as a follow-up bubble. The orchestrator's
    // step_failed event only carries the aggregated `error` string
    // (no separate stdout/stderr/exit_code yet), so we route it as
    // stderr — analyze_step_failure tolerates the others being null.
    insertExecutionStatusMessage({
      executionId: event.execution_id,
      content: `❌ Step ${event.step_id} falhou — analisando...`,
      kind: "execution-status",
    })
      .catch((err) =>
        console.warn("[useExecution] step_failed placeholder failed:", err),
      )
      .then(() =>
        analyzeStepFailure({
          executionId: event.execution_id,
          stepId: event.step_id,
          stderr: event.error,
        }),
      )
      .catch((err) =>
        console.warn("[useExecution] step_failed analysis failed:", err),
      );
  });

  useTauriEvent("execution:completed", (event: ExecutionCompletedEvent) => {
    // Snapshot active state BEFORE the store update so the persisted
    // skill-completion message reflects what actually ran (skill_name,
    // total_steps, success count). After the setState below, status
    // changes to terminal and breaks the count-by-running heuristic.
    const snapshot = useExecutionStore.getState();
    const skillName =
      snapshot.activeExecution?.skill_name ?? "(execução)";
    const total =
      snapshot.activeExecution?.total_steps ?? snapshot.steps.length;
    const successCount = snapshot.steps.filter(
      (s) => s.status === "success",
    ).length;
    const failedStep = snapshot.steps.find((s) => s.status === "failed");

    useExecutionStore.setState((state) =>
      state.activeExecution
        ? {
            activeExecution: {
              ...state.activeExecution,
              status: event.status,
              finished_at: new Date().toISOString(),
            },
          }
        : {},
    );

    const content =
      event.status === "completed"
        ? `✅ Skill **${skillName}** concluída — ${successCount}/${total} steps executados com sucesso`
        : event.status === "failed"
          ? `❌ Skill **${skillName}** falhou no step ${failedStep?.step_id ?? "?"}.`
          : `⏹ Skill **${skillName}** ${event.status}.`;

    insertExecutionStatusMessage({
      executionId: event.execution_id,
      content,
      kind: "execution-status",
    }).catch((err) =>
      console.warn("[useExecution] completed persist failed:", err),
    );
  });

  useTauriEvent("execution:log", (event: LogEvent) => {
    useExecutionStore.getState().addLog(event.step_id, event.line);
  });
}

function computeDuration(startedAt: string | null): number | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return null;
  return Math.max(0, Date.now() - started);
}

/** Compact duration label for status messages: "120ms", "2.3s",
 *  "1m12s". Used in the persisted "✅ Step X — Concluído (Xs)"
 *  entries so the chat history reads consistently regardless of how
 *  long each step took. */
function formatDuration(ms: number | null): string {
  if (ms === null) return "?";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds - minutes * 60);
  return `${minutes}m${remainder}s`;
}
