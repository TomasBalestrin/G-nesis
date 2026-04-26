// Mirrors the Config struct in src-tauri/src/config.rs.

export interface Config {
  openai_api_key: string | null;
  skills_dir: string;
  workflows_dir: string;
  db_path: string;
  needs_setup: boolean;
}
