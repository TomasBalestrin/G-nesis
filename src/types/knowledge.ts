// Mirrors the structs in src-tauri/src/db/models.rs (KnowledgeFileMeta,
// KnowledgeSummary). Full row (with `content`) is returned by reads but
// has no dedicated type yet — the upload flow only reads the meta back,
// and a future "edit knowledge file" surface can introduce KnowledgeFile
// when needed.

export interface KnowledgeFileMeta {
  id: string;
  filename: string;
  uploaded_at: string;
}

export interface KnowledgeSummary {
  /** Always `"singleton"` — the table only ever holds one row. */
  id: string;
  summary: string;
  generated_at: string;
  /** Number of knowledge files that fed into the current summary. */
  source_count: number;
}
