// Mirrors chat_messages table (docs/schema.md §2.1) and the
// ChatMessage Rust struct in src-tauri/src/db/models.rs.

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  execution_id: string | null;
  role: ChatRole;
  content: string;
  created_at: string;
}
