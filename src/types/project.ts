// Mirrors the Rust structs in src-tauri/src/db/models.rs.
// Rust i64 → TS number, Option<String> → string | null.

export type ExecutionStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "aborted";

export type StepStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export type Tool = "claude-code" | "bash" | "api";

export interface Project {
  id: string;
  name: string;
  repo_path: string;
  created_at: string;
  updated_at: string;
}

export interface Execution {
  id: string;
  project_id: string;
  skill_name: string;
  status: ExecutionStatus;
  started_at: string | null;
  finished_at: string | null;
  total_steps: number;
  completed_steps: number;
  created_at: string;
}

export interface ExecutionStep {
  id: string;
  execution_id: string;
  step_id: string;
  step_order: number;
  tool: Tool;
  status: StepStatus;
  input: string;
  output: string | null;
  error: string | null;
  retries: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
}
