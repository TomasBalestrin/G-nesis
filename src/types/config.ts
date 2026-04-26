// Mirrors the Config struct in src-tauri/src/config.rs.

export interface Config {
  openai_api_key: string | null;
  skills_dir: string;
  workflows_dir: string;
  db_path: string;
  /** Optional explicit path to the `claude` CLI. Read-only from the UI for
   *  now — the backend `save_config` doesn't accept it as a param yet, so
   *  persistence happens via manual edit of ~/.genesis/config.toml. */
  claude_cli_path: string | null;
  needs_setup: boolean;
}
