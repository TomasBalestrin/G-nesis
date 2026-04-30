// User-facing shape of an integration row. Mirrors `db::models::IntegrationRow`
// on the Rust side, with two ergonomic tweaks for TS land:
//   - `spec_file` becomes optional (`?`) so callers don't need to special-case
//     the backend's empty-string-when-missing convention.
//   - `last_used_at` becomes optional (`?`) instead of `string | null` —
//     missing keys read more naturally in JSX (`row.last_used_at ?? '...'`
//     handles both `undefined` and `null`, but `?` makes the type cleaner).
//
// `auth_type` is the discriminator string only (`'bearer' | 'header' | 'query'`).
// The full payload (header_name / param_name) lives in `~/.genesis/config.toml`,
// not on this struct — keep secrets and runtime-only details off the wire.
//
// `enabled` stays as `number` (0/1) to match SQLite's INTEGER storage.
// Convert at render time when a boolean reads better.

export interface Integration {
  id: string;
  name: string;
  display_name: string;
  base_url: string;
  auth_type: string;
  spec_file?: string;
  enabled: number;
  last_used_at?: string;
  created_at: string;
}
