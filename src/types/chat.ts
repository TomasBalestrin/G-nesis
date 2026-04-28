// Mirrors chat_messages table (docs/schema.md §2.1) and the
// ChatMessage Rust struct in src-tauri/src/db/models.rs.

export type ChatRole = "user" | "assistant" | "system";

/**
 * Discriminator used by the chat renderer to switch between regular text
 * bubbles and inline execution status entries. Persisted on the
 * `chat_messages.kind` column (Rust struct field renamed to `type` at
 * the JSON wire boundary) so status messages survive a conversation
 * reload.
 *
 * - `"text"`              — regular bubble (default for legacy rows).
 * - `"execution-status"`  — inline ⏳/✅/❌ progress entry inserted by
 *                           the `useExecution` hook on each
 *                           `execution:step_*` event. Renders smaller
 *                           and sutil to keep the chat readable.
 * - `"execution"`         — legacy virtual entry kept around so
 *                           ChatPanel's union compiles during the
 *                           cutover; deleted with ExecutionMessage in F4.
 */
export type ChatMessageType = "text" | "execution-status" | "execution";

export interface ChatMessage {
  id: string;
  execution_id: string | null;
  conversation_id: string | null;
  role: ChatRole;
  content: string;
  created_at: string;
  /** Defaults to `"text"` when absent — used to route render logic. */
  type?: ChatMessageType;
  /**
   * Extended-thinking text from models that expose reasoning (Anthropic
   * Claude with thinking blocks, OpenAI o1/o3). Streams in as the model
   * thinks; rendered above the assistant content. `undefined` means the
   * message has no thinking attached (regular text turn).
   */
  thinking?: string;
  /**
   * Short one-line summary of the thinking block — shown in the collapsed
   * accordion header so the user can scan multiple turns without expanding
   * each. Falls back to a generic label when omitted.
   */
  thinking_summary?: string;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
