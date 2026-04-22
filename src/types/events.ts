// Event payloads emitted by the Rust orchestrator (docs/PRD.md §4).

import type { ExecutionStatus, StepStatus, Tool } from "./project";

export interface StepStartedEvent {
  execution_id: string;
  step_id: string;
  tool: Tool;
}

export interface StepCompletedEvent {
  execution_id: string;
  step_id: string;
  status: StepStatus;
  output: string;
}

export interface StepFailedEvent {
  execution_id: string;
  step_id: string;
  error: string;
  retry_count: number;
}

export interface ExecutionCompletedEvent {
  execution_id: string;
  status: ExecutionStatus;
}

export interface LogEvent {
  execution_id: string;
  step_id: string;
  line: string;
}

/**
 * Map of Tauri event name → payload type. Consumers pass the literal
 * event name to `useTauriEvent` and the payload is inferred.
 */
export interface TauriEventMap {
  "execution:step_started": StepStartedEvent;
  "execution:step_completed": StepCompletedEvent;
  "execution:step_failed": StepFailedEvent;
  "execution:completed": ExecutionCompletedEvent;
  "execution:log": LogEvent;
}

export type TauriEventName = keyof TauriEventMap;
