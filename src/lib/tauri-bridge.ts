// Typed frontend → Rust bridge. Every IPC call goes through this module —
// components must NOT call @tauri-apps/api invoke() directly (CLAUDE.md §4).
//
// Convention: Rust `#[tauri::command]` args use snake_case; Tauri 2 auto-
// converts camelCase keys from JS, so this module exposes camelCase params.
// Return types match the currently registered Rust signatures — when a
// placeholder command is fleshed out (e.g. list_skills → Vec<SkillMeta>),
// the wrapper type here is updated in lockstep.

import { invoke } from "@tauri-apps/api/core";

import { reportFatalError } from "@/hooks/useFatalError";
import { toast } from "@/hooks/useToast";
import type { ChatMessage, Conversation } from "@/types/chat";
import type { Config } from "@/types/config";
import type { KnowledgeFileMeta, KnowledgeSummary } from "@/types/knowledge";
import type { Execution, ExecutionDetail, Project } from "@/types/project";
import type { ParsedSkill, SkillMeta } from "@/types/skill";
import type { ParsedWorkflow, WorkflowSummary } from "@/types/workflow";

export interface SafeInvokeOptions {
  /** Toast title shown after a successful call. Omit to stay silent on success. */
  successTitle?: string;
  /** Toast title prefix shown on failure. Defaults to "Erro inesperado". */
  errorTitle?: string;
  /** Promote failures to a blocking fatal-error dialog instead of a toast. */
  fatal?: boolean;
  /** Override the success toast duration (ms). */
  successDuration?: number;
  /** Override the error toast duration (ms). Default for destructive: persist. */
  errorDuration?: number;
}

/**
 * Wrap a bridge call (or any Promise) with consistent UX:
 *   - success → optional 3s toast
 *   - failure → destructive toast (persists) OR fatal dialog if `fatal: true`
 *   - returns `null` on failure so callers can branch without try/catch
 *
 * Use this for one-off invocations from event handlers. For react-state
 * lifecycle (loading/error fields), `useTauriCommand` is still the right call.
 */
export async function safeInvoke<T>(
  call: () => Promise<T>,
  options: SafeInvokeOptions = {},
): Promise<T | null> {
  try {
    const result = await call();
    if (options.successTitle) {
      toast({
        title: options.successTitle,
        duration: options.successDuration,
      });
    }
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const title = options.errorTitle ?? "Erro inesperado";
    if (options.fatal) {
      reportFatalError(title, message);
    } else {
      toast({
        title,
        description: message,
        variant: "destructive",
        duration: options.errorDuration,
      });
    }
    return null;
  }
}

// ── config ──────────────────────────────────────────────────────────────────

export function getConfig(): Promise<Config> {
  return invoke("get_config");
}

export function saveConfig(args: {
  openaiApiKey: string | null;
  skillsDir: string;
}): Promise<Config> {
  return invoke("save_config", args);
}

// ── skills ──────────────────────────────────────────────────────────────────

/** Returns parsed meta (name, description, ...) for every skill that parses. */
export function listSkills(): Promise<SkillMeta[]> {
  return invoke("list_skills");
}

export function readSkill(args: { name: string }): Promise<string> {
  return invoke("read_skill", args);
}

export function saveSkill(args: {
  name: string;
  content: string;
}): Promise<void> {
  return invoke("save_skill", args);
}

export function parseSkill(args: { name: string }): Promise<ParsedSkill> {
  return invoke("parse_skill", args);
}

/** Removes the `.md` from disk. Backend refuses if any execution is still
 * in flight for the same skill. */
export function deleteSkill(args: { name: string }): Promise<void> {
  return invoke("delete_skill", args);
}

// ── projects ────────────────────────────────────────────────────────────────

export function listProjects(): Promise<Project[]> {
  return invoke("list_projects");
}

export function createProject(args: {
  name: string;
  repoPath: string;
}): Promise<Project> {
  return invoke("create_project", args);
}

export function deleteProject(args: { id: string }): Promise<void> {
  return invoke("delete_project", args);
}

export function getExecutionHistory(args: {
  projectId: string;
}): Promise<Execution[]> {
  return invoke("get_execution_history", args);
}

export function getExecutionDetail(args: {
  executionId: string;
}): Promise<ExecutionDetail> {
  return invoke("get_execution_detail", args);
}

// ── execution ───────────────────────────────────────────────────────────────

/** Starts an execution. Resolves to the new `execution_id`. The
 *  `conversationId` is forwarded to `executions.conversation_id` so
 *  the inline status-message flow can route ⏳/✅/❌ entries back to
 *  the chat thread that triggered the run. Pass `null` for runs
 *  started outside the chat (manual, future cron). */
export function executeSkill(args: {
  skillName: string;
  projectId: string;
  conversationId?: string | null;
}): Promise<string> {
  return invoke("execute_skill", {
    skillName: args.skillName,
    projectId: args.projectId,
    conversationId: args.conversationId ?? null,
  });
}

export function abortExecution(args: {
  executionId: string;
}): Promise<void> {
  return invoke("abort", args);
}

export function pauseExecution(args: {
  executionId: string;
}): Promise<void> {
  return invoke("pause", args);
}

export function resumeExecution(args: {
  executionId: string;
}): Promise<void> {
  return invoke("resume", args);
}

// ── chat ────────────────────────────────────────────────────────────────────

/**
 * Send a message to the GPT-4o orchestrator. Persists both the user message
 * and the assistant reply into chat_messages, returning the assistant reply.
 *
 * When `conversationId` is provided the history window is scoped to that
 * thread, keeping multi-conversation flows isolated. `executionId` is the
 * legacy scope; pass at most one of the two.
 */
export function sendChatMessage(args: {
  content: string;
  executionId?: string | null;
  conversationId?: string | null;
}): Promise<ChatMessage> {
  return invoke("send_chat_message", {
    content: args.content,
    executionId: args.executionId ?? null,
    conversationId: args.conversationId ?? null,
  });
}

/** Low-level OpenAI call that does not persist to history. */
export function callOpenAI(args: { prompt: string }): Promise<string> {
  return invoke("call_openai", args);
}

/** Load the full message history for a conversation. */
export function listMessagesByConversation(args: {
  conversationId: string;
}): Promise<ChatMessage[]> {
  return invoke("list_messages_by_conversation", args);
}

/**
 * Persist an inline execution-status chat message and emit
 * `chat:message_inserted` for the live ChatPanel to append. `kind` is
 * forwarded verbatim to the `chat_messages.kind` column — pass
 * `"execution-status"` for ⏳/✅/❌ entries (smaller, sutil styling) or
 * `"text"` for regular bubbles. Routing to the originating conversation
 * is resolved server-side via `executions.conversation_id`.
 */
export function insertExecutionStatusMessage(args: {
  executionId: string;
  content: string;
  kind: ChatMessage["type"];
}): Promise<ChatMessage> {
  return invoke("insert_execution_status_message", {
    executionId: args.executionId,
    content: args.content,
    kind: args.kind,
  });
}

/**
 * Send a step-failure payload (stdout/stderr/exit_code) to GPT for
 * diagnosis and persist the analysis as a regular assistant message.
 * Returns the inserted message and emits `chat:message_inserted`.
 * Slow path — typical 2-5s GPT roundtrip; callers should display a
 * placeholder ❌ status message first.
 */
export function analyzeStepFailure(args: {
  executionId: string;
  stepId: string;
  stdout?: string | null;
  stderr?: string | null;
  exitCode?: number | null;
}): Promise<ChatMessage> {
  return invoke("analyze_step_failure", {
    executionId: args.executionId,
    stepId: args.stepId,
    stdout: args.stdout ?? null,
    stderr: args.stderr ?? null,
    exitCode: args.exitCode ?? null,
  });
}

// ── conversations ───────────────────────────────────────────────────────────

export function listConversations(): Promise<Conversation[]> {
  return invoke("list_conversations");
}

export function createConversation(args: {
  title?: string | null;
} = {}): Promise<Conversation> {
  return invoke("create_conversation", { title: args.title ?? null });
}

export function deleteConversation(args: { id: string }): Promise<void> {
  return invoke("delete_conversation", args);
}

export function renameConversation(args: {
  id: string;
  title: string;
}): Promise<Conversation> {
  return invoke("rename_conversation", args);
}

// ── dependencies ────────────────────────────────────────────────────────────

/** `which <name>` — true when the binary is on the PATH. */
export function checkDependency(args: { name: string }): Promise<boolean> {
  return invoke("check_dependency", args);
}

/** `brew install <name>` — returns brew stdout, errors with brew stderr. */
export function installDependency(args: { name: string }): Promise<string> {
  return invoke("install_dependency", args);
}

// ── app_state (key/value store for cross-session UI state) ──────────────────

/** Mirrors the Rust struct in src-tauri/src/db/models.rs::AppState. */
export interface AppState {
  key: string;
  value: string;
  updated_at: string;
}

/** Read a single key; resolves `null` when the key was never written. */
export function getAppState(args: { key: string }): Promise<AppState | null> {
  return invoke("get_app_state", args);
}

/** UPSERT a key. Returns the freshly-written row including new updated_at. */
export function setAppState(args: {
  key: string;
  value: string;
}): Promise<AppState> {
  return invoke("set_app_state", args);
}

// ── workflows ───────────────────────────────────────────────────────────────

/** Lightweight summary list — calls `commands::workflows::list_workflows`. */
export function listWorkflows(): Promise<WorkflowSummary[]> {
  return invoke("list_workflows");
}

export function readWorkflow(args: { name: string }): Promise<string> {
  return invoke("read_workflow", args);
}

export function saveWorkflow(args: {
  name: string;
  content: string;
}): Promise<void> {
  return invoke("save_workflow", args);
}

export function deleteWorkflow(args: { name: string }): Promise<void> {
  return invoke("delete_workflow", args);
}

/** Returns the parsed AST. Distinct command name from the JS `parseWorkflow`
 *  helper would shadow — Tauri side is `parse_workflow`. */
export function parseWorkflowFile(args: {
  name: string;
}): Promise<ParsedWorkflow> {
  return invoke("parse_workflow", args);
}

/** Fire-and-forget — backend spawns the WorkflowExecutor and returns the
 *  workflow_execution_id immediately. Progress flows via `workflow:*` events. */
export function executeWorkflow(args: {
  workflowName: string;
  projectId?: string | null;
}): Promise<string> {
  return invoke("execute_workflow", args);
}

export function abortWorkflow(args: {
  workflowExecutionId: string;
}): Promise<void> {
  return invoke("abort_workflow", args);
}

// ── terminal (PTY) ──────────────────────────────────────────────────────────

/** Start a new PTY session. Returns the session id used by subsequent
 *  write/resize/kill calls. Output streams via `terminal:data` events. */
export function terminalSpawn(args: {
  rows: number;
  cols: number;
  cwd?: string | null;
}): Promise<string> {
  return invoke("terminal_spawn", args);
}

export function terminalWrite(args: {
  sessionId: string;
  data: number[];
}): Promise<void> {
  return invoke("terminal_write", args);
}

export function terminalResize(args: {
  sessionId: string;
  rows: number;
  cols: number;
}): Promise<void> {
  return invoke("terminal_resize", args);
}

export function terminalKill(args: { sessionId: string }): Promise<void> {
  return invoke("terminal_kill", args);
}

// ── knowledge base ──────────────────────────────────────────────────────────

/** Persist a `.md` file describing the user. Backend triggers a
 *  best-effort summary regen; failures there don't fail the upload —
 *  caller can retry via `regenerateKnowledgeSummary`. */
export function uploadKnowledgeFile(args: {
  filename: string;
  content: string;
}): Promise<KnowledgeFileMeta> {
  return invoke("upload_knowledge_file", args);
}

export function listKnowledgeFiles(): Promise<KnowledgeFileMeta[]> {
  return invoke("list_knowledge_files");
}

export function deleteKnowledgeFile(args: { id: string }): Promise<void> {
  return invoke("delete_knowledge_file", args);
}

/** Returns `null` when no summary has been generated yet (no files, or
 *  all uploads failed regen). */
export function getKnowledgeSummary(): Promise<KnowledgeSummary | null> {
  return invoke("get_knowledge_summary");
}

/** User-driven retry. Surfaces backend errors (missing key, OpenAI down,
 *  network) — wrap in `safeInvoke` if the caller wants a toast. */
export function regenerateKnowledgeSummary(): Promise<KnowledgeSummary | null> {
  return invoke("regenerate_knowledge_summary");
}

// ── app_state value-only helpers ────────────────────────────────────────────
//
// These are the lighter façade on top of the row-based `getAppState` /
// `setAppState` (defined above for the existing `appStore`). When you
// only care about the value column, prefer these — fewer fields to
// destructure, fewer bytes over the wire. Both APIs persist to the same
// `app_state` table.

export function getAppStateValue(args: {
  key: string;
}): Promise<string | null> {
  return invoke("get_app_state_value", args);
}

export function setAppStateValue(args: {
  key: string;
  value: string;
}): Promise<void> {
  return invoke("set_app_state_value", args);
}

// ── placeholders for types not yet returned by backend ──────────────────────
//
// Re-export the row types so consumers can import from a single place when
// working with results coming over the bridge (keeps the import graph flat).

export type { ChatMessage, Conversation } from "@/types/chat";
export type { Config } from "@/types/config";
export type {
  Execution,
  ExecutionDetail,
  ExecutionStep,
  Project,
} from "@/types/project";
export type { KnowledgeFileMeta, KnowledgeSummary } from "@/types/knowledge";
export type { ParsedSkill, SkillMeta } from "@/types/skill";
export type {
  ParsedWorkflow,
  WorkflowMeta,
  WorkflowStep,
  WorkflowSummary,
} from "@/types/workflow";
