// Mirrors the structs in src-tauri/src/orchestrator/workflow_parser.rs.

export interface WorkflowSummary {
  name: string;
  description: string;
  version: string;
  author: string;
  triggers: string[];
}

export interface WorkflowMeta {
  name: string;
  description: string;
  version: string;
  author: string;
  triggers: string[];
}

export interface WorkflowStep {
  id: string;
  skill: string;
  input: string | null;
  output: string | null;
  condition: string | null;
  objective: string | null;
  /** Plural-form `Inputs:` block parsed into a labelled map. Empty when the
   *  user used the singular `Input:` form. */
  inputs: Record<string, string>;
}

export interface ParsedWorkflow {
  meta: WorkflowMeta;
  prerequisites: string[];
  steps: WorkflowStep[];
}
