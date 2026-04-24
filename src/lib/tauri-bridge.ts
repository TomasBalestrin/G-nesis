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
import type { Execution, ExecutionDetail, Project } from "@/types/project";
import type { ParsedSkill, SkillMeta } from "@/types/skill";

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

/** Starts an execution. Resolves to the new `execution_id`. */
export function executeSkill(args: {
  skillName: string;
  projectId: string;
}): Promise<string> {
  return invoke("execute_skill", args);
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
export type { ParsedSkill, SkillMeta } from "@/types/skill";
