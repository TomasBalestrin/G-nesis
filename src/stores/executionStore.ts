import { create } from "zustand";

import type { Execution, ExecutionStep } from "@/types/project";

interface ExecutionState {
  active: Execution | null;
  steps: ExecutionStep[];
  setActive: (execution: Execution | null) => void;
  setSteps: (steps: ExecutionStep[]) => void;
  reset: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  active: null,
  steps: [],
  setActive: (active) => set({ active }),
  setSteps: (steps) => set({ steps }),
  reset: () => set({ active: null, steps: [] }),
}));
