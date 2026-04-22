import { create } from "zustand";

import type { Execution, ExecutionStep } from "@/types/project";

interface ExecutionState {
  activeExecution: Execution | null;
  steps: ExecutionStep[];
  /** Streaming logs per step id. */
  logs: Map<string, string[]>;

  /** Seed the store when an execution starts (called from invoke result). */
  setActiveExecution: (
    execution: Execution | null,
    steps?: ExecutionStep[],
  ) => void;
  /** Patch a step by id — used when a Tauri step event arrives. */
  updateStep: (stepId: string, patch: Partial<ExecutionStep>) => void;
  /** Append a log line to a step's buffer. */
  addLog: (stepId: string, line: string) => void;
  /** Reset everything (execution finished, user cleared, etc.). */
  clearExecution: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  activeExecution: null,
  steps: [],
  logs: new Map(),

  setActiveExecution: (activeExecution, steps = []) =>
    set({ activeExecution, steps, logs: new Map() }),

  updateStep: (stepId, patch) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === stepId ? { ...s, ...patch } : s,
      ),
    })),

  addLog: (stepId, line) =>
    set((state) => {
      const logs = new Map(state.logs);
      const existing = logs.get(stepId) ?? [];
      logs.set(stepId, [...existing, line]);
      return { logs };
    }),

  clearExecution: () =>
    set({ activeExecution: null, steps: [], logs: new Map() }),
}));
