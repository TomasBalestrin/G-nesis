// Event payloads emitted by the Rust orchestrator (docs/PRD.md §4).

import type { ChatMessage } from "./chat";
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

// ── chat events (extended thinking streaming, ai/client.rs::ThinkingSink) ──

/**
 * Fired by the backend after `insert_execution_status_message` or
 * `analyze_step_failure` writes a row to `chat_messages`. Lets the live
 * ChatPanel append the new message without re-fetching the whole
 * thread. Not scoped by conversation_id at the event channel level —
 * the payload itself carries it (via `message.conversation_id`) so
 * multi-conversation panels can filter.
 */
export interface ChatMessageInsertedEvent {
  message: ChatMessage;
}

export interface ThinkingDeltaEvent {
  /** Conversation that owns the in-flight assistant turn. May be null when
   *  the message wasn't scoped to a conversation (legacy execution-only). */
  conversation_id: string | null;
  delta: string;
}

export interface ThinkingCompleteEvent {
  conversation_id: string | null;
  summary: string;
}

// ── terminal events (channels::terminal::TerminalRegistry) ─────────────────

export interface TerminalDataEvent {
  session_id: string;
  /** Raw bytes from the PTY master. JS side wraps in Uint8Array before
   *  feeding into xterm's `term.write()` so escape sequences land intact. */
  data: number[];
}

export interface TerminalExitEvent {
  session_id: string;
}

/**
 * Map of Tauri event name → payload type. Consumers pass the literal
 * event name to `useTauriEvent` and the payload is inferred.
 */
/** Web search invocada pelo orquestrador GPT principal (commands/chat.rs).
 *  Disparada uma vez por round antes da chamada à Brave Search. */
export interface ChatSearchingEvent {
  conversation_id: string | null;
  query: string;
  round: number;
}

/** Disparada após a resposta da Brave (sucesso, vazio ou falha). FE
 *  usa pra remover o indicador "Pesquisando..." e opcionalmente
 *  mostrar um sub-status (sucesso vs falha) no spinner. */
export interface ChatSearchDoneEvent {
  conversation_id: string | null;
  query: string;
  round: number;
  success: boolean;
}

export interface TauriEventMap {
  "execution:step_started": StepStartedEvent;
  "execution:step_completed": StepCompletedEvent;
  "execution:step_failed": StepFailedEvent;
  "execution:completed": ExecutionCompletedEvent;
  "execution:log": LogEvent;
  "chat:thinking_delta": ThinkingDeltaEvent;
  "chat:thinking_complete": ThinkingCompleteEvent;
  "chat:message_inserted": ChatMessageInsertedEvent;
  "chat:searching": ChatSearchingEvent;
  "chat:search-done": ChatSearchDoneEvent;
  "terminal:data": TerminalDataEvent;
  "terminal:exit": TerminalExitEvent;
}

export type TauriEventName = keyof TauriEventMap;
