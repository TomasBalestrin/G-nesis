// Mirrors src-tauri/src/db/models.rs::Capability and the schema in
// src-tauri/migrations/007_capabilities.sql.
//
// `type` is the JSON wire field (Rust uses `type_` to dodge the
// reserved keyword). `channel` is null for connector-flavored rows
// — auth + endpoints live inside the `config` JSON string.
// `enabled` ships as 0/1 from SQLite (not a JS boolean).

export type CapabilityType = "native" | "connector";

export type CapabilityChannel = "bash" | "claude-code" | "api";

export interface Capability {
  id: string;
  name: string;
  display_name: string;
  description: string;
  type: CapabilityType;
  /** Null for connectors — they route through the `config` JSON
   *  instead of a built-in subprocess channel. */
  channel: CapabilityChannel | null;
  /** JSON string. Parse on demand at the call site that needs it
   *  (auth, endpoints, etc. for connectors). */
  config: string;
  /** Snippet injected into the system prompt when the capability is
   *  mentioned via @ — describes what it does + usage rules. */
  doc_ai: string;
  /** Picker copy for humans. */
  doc_user: string;
  /** SQLite int: 0 = disabled (hidden from picker), 1 = active. */
  enabled: number;
  created_at: string;
  updated_at: string;
}
