import {
  useTauriEvent,
} from "./useTauriEvent";
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
 * Subscribe to executor events and keep the execution store in sync.
 *
 * The backend emits events keyed by the skill's logical `step_id`
 * ("step_1"), not the DB row UUID — so we upsert by that. On the first
 * `step_started` of a new execution_id we also seed `activeExecution` with
 * minimal fields, so the inline ExecutionBlock has something to render
 * even though the executor doesn't emit a dedicated "started" event.
 *
 * No return value — this is a subscription side-effect hook.
 */
export function useExecution(): void {
  useTauriEvent("execution:step_started", (event: StepStartedEvent) => {
    useExecutionStore.setState((state) => {
      // Seed activeExecution if absent or for a different id.
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
    useExecutionStore.setState((state) => ({
      steps: state.steps.map((s) =>
        s.step_id === event.step_id
          ? {
              ...s,
              status: event.status,
              output: event.output,
              finished_at: new Date().toISOString(),
              duration_ms: computeDuration(s.started_at),
            }
          : s,
      ),
    }));
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
  });

  useTauriEvent("execution:completed", (event: ExecutionCompletedEvent) => {
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
