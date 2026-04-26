// Mirrors chat_messages table (docs/schema.md §2.1) and the
// ChatMessage Rust struct in src-tauri/src/db/models.rs.

export type ChatRole = "user" | "assistant" | "system";

/**
 * Discriminator used by the chat renderer to switch between regular text
 * bubbles and inline execution cards. Only set on virtual messages built
 * by ChatPanel from the execution store — DB rows are always implicitly
 * `"text"` (omitted on the wire, defaulted at the render boundary).
 */
export type ChatMessageType = "text" | "execution";

export interface ChatMessage {
  id: string;
  execution_id: string | null;
  conversation_id: string | null;
  role: ChatRole;
  content: string;
  created_at: string;
  /** Defaults to `"text"` when absent — used to route render logic. */
  type?: ChatMessageType;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
