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
import type { Caminho } from "@/types/caminho";
import type { Capability, CapabilityType } from "@/types/capability";
import type { ChatMessage, Conversation } from "@/types/chat";
import type { Config } from "@/types/config";
import type { KnowledgeFileMeta, KnowledgeSummary } from "@/types/knowledge";
import type { Execution, ExecutionDetail } from "@/types/project";
import type { ParsedSkill, SkillMeta } from "@/types/skill";
import type { ParsedWorkflow, WorkflowSummary } from "@/types/workflow";

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

/** Removes the `.md` from disk. Backend refuses if any execution is still
 * in flight for the same skill. */
export function deleteSkill(args: { name: string }): Promise<void> {
  return invoke("delete_skill", args);
}

/// Skill package v2 (B1+B2). Mirror do `crate::skills::storage::SkillPackage`.
/// `path` é absoluto — serde serializa o PathBuf do Rust como string.
/// `references_count` e `assets_count` contam arquivos não-hidden 1
/// nível abaixo das subpastas (não recursivo) — pensado pra badges
/// na sidebar sem ter que chamar getSkill.
export interface SkillPackage {
  name: string;
  path: string;
  has_assets: boolean;
  has_references: boolean;
  files_count: number;
  references_count: number;
  assets_count: number;
}

export function listSkillPackages(): Promise<SkillPackage[]> {
  return invoke("list_skill_packages");
}

/// Descompacta um arquivo .skill (ZIP) em ~/.genesis/skills/<name>/
/// e registra no mirror SQLite. Erros incluem: "arquivo .skill muito
/// grande", "ZIP inválido", "ZIP precisa ter exatamente 1 pasta
/// raiz", "ZIP não tem SKILL.md em <root>/", "Skill `<name>` já
/// existe". UI mostra direto no toast.
export function importSkill(args: { filePath: string }): Promise<SkillPackage> {
  return invoke("import_skill", args);
}

/// Cria um package v2 do zero — pasta + SKILL.md template (frontmatter
/// mínimo + body TODO). Backend rejeita se já existe v1 ou v2 com o
/// mesmo nome. Sincroniza mirror SQLite. Caller (wizard de criação)
/// segue com `saveSkillFile` pra sobrescrever o SKILL.md com a
/// frontmatter customizada do usuário.
export function createSkill(args: { name: string }): Promise<SkillPackage> {
  return invoke("create_skill", args);
}

/// Salva (overwrite) um arquivo dentro do package v2. `path` é
/// relativo ao package (ex: "SKILL.md", "references/foo.md"). Quando
/// path == "SKILL.md", o backend valida o frontmatter via parser —
/// rejeita conteúdo inválido antes de tocar disco. Cria parent dirs
/// faltantes (ex: salvar `references/x.md` quando `references/` ainda
/// não existe).
export function saveSkillFile(args: {
  name: string;
  path: string;
  content: string;
}): Promise<void> {
  return invoke("save_skill_file", args);
}

/// Salva um asset binário (imagem, PDF, etc) no package. `bytes` é
/// um array de bytes — caller passa `Array.from(uint8Array)` ou
/// equivalente. Recusa salvar SKILL.md por aqui.
export function saveSkillAsset(args: {
  name: string;
  path: string;
  bytes: number[];
}): Promise<void> {
  return invoke("save_skill_asset", args);
}

/// Remove um arquivo dentro do package (`references/x.md`,
/// `assets/y.png`). Idempotente — arquivo ausente não erra. Recusa
/// remover SKILL.md (use deleteSkill pra apagar a skill toda).
export function deleteSkillFile(args: {
  name: string;
  path: string;
}): Promise<void> {
  return invoke("delete_skill_file", args);
}

/// Bundle retornado por `get_skill` — package + SKILL.md content +
/// listas de filenames (relativos) de references/ e assets/. UI
/// hidrata o detalhe da skill em uma chamada só.
export interface SkillBundle {
  package: SkillPackage;
  skill_md: string;
  references: string[];
  assets: string[];
}

export function getSkill(args: { name: string }): Promise<SkillBundle> {
  return invoke("get_skill", args);
}

/// Lê arquivo de texto dentro do package (.md, .html, .txt, etc).
/// Path relativo (ex: "references/foo.md", "assets/template.html").
export function getSkillFile(args: {
  name: string;
  path: string;
}): Promise<string> {
  return invoke("get_skill_file", args);
}

/// Lê asset binário e retorna como `data:<mime>;base64,...`. Ideal
/// pra <img src=...> direto na UI sem mexer com asset protocol.
export function readSkillAssetDataUrl(args: {
  name: string;
  path: string;
}): Promise<string> {
  return invoke("read_skill_asset_data_url", args);
}

/// Empacota a skill como `.skill` (ZIP) em `destPath` (escolhido
/// via dialog.save no frontend). Sobrescreve se existir.
export function exportSkill(args: {
  name: string;
  destPath: string;
}): Promise<void> {
  return invoke("export_skill", args);
}

// ── projects (legacy: list/create/delete retired in H1) ────────────────────
//
// `list_projects` / `create_project` / `delete_project` foram aposentadas
// — surface migrou pra `caminhos::*` (C1/C2/C3) e o último consumer
// caiu em H1 (ProjectSelector deletado, MessageBubble e SettingsPage
// migrados pra listCaminhos). `getExecutionHistory` permanece porque
// CaminhoDetail ainda consulta by project_id (schema DB inalterado).

// ── caminhos (renamed projects surface) ─────────────────────────────────────
//
// Wraps the `caminhos::*` Tauri commands. Wire types são idênticas
// (`Caminho = Project`) — alias mora no schema, não no produto.

export function listCaminhos(): Promise<Caminho[]> {
  return invoke("list_caminhos");
}

export function createCaminho(args: {
  name: string;
  repoPath: string;
}): Promise<Caminho> {
  return invoke("create_caminho", args);
}

export function deleteCaminho(args: { id: string }): Promise<void> {
  return invoke("delete_caminho", args);
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

/** Starts an execution. Resolves to the new `execution_id`. The
 *  `conversationId` is forwarded to `executions.conversation_id` so
 *  the inline status-message flow can route ⏳/✅/❌ entries back to
 *  the chat thread that triggered the run. Pass `null` for runs
 *  started outside the chat (manual, future cron). */
export function executeSkill(args: {
  skillName: string;
  projectId: string;
  conversationId?: string | null;
}): Promise<string> {
  return invoke("execute_skill", {
    skillName: args.skillName,
    projectId: args.projectId,
    conversationId: args.conversationId ?? null,
  });
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

/** Load the full message history for a conversation. */
export function listMessagesByConversation(args: {
  conversationId: string;
}): Promise<ChatMessage[]> {
  return invoke("list_messages_by_conversation", args);
}

/**
 * Persist a v2 skill folder under `skills_dir`. Idempotent — re-call
 * overwrites existing files so the skill agent's iterate-edit loop
 * (CONSTRUIR → APRESENTAR → VALIDAR → adjust → re-save) doesn't need
 * a delete step. Scripts get chmod 755 on Unix; references and
 * assets keep default perms. Empty file lists skip subdir creation.
 */
export interface SkillFolderFile {
  name: string;
  content: string;
}
export function saveSkillFolder(args: {
  skillName: string;
  skillMd: string;
  scripts?: SkillFolderFile[];
  references?: SkillFolderFile[];
  assets?: SkillFolderFile[];
}): Promise<void> {
  return invoke("save_skill_folder", {
    skillName: args.skillName,
    skillMd: args.skillMd,
    scripts: args.scripts ?? null,
    references: args.references ?? null,
    assets: args.assets ?? null,
  });
}

/**
 * Persist an inline execution-status chat message and emit
 * `chat:message_inserted` for the live ChatPanel to append. `kind` is
 * forwarded verbatim to the `chat_messages.kind` column — pass
 * `"execution-status"` for ⏳/✅/❌ entries (smaller, sutil styling) or
 * `"text"` for regular bubbles. Routing to the originating conversation
 * is resolved server-side via `executions.conversation_id`.
 */
export function insertExecutionStatusMessage(args: {
  executionId: string;
  content: string;
  kind: ChatMessage["type"];
}): Promise<ChatMessage> {
  return invoke("insert_execution_status_message", {
    executionId: args.executionId,
    content: args.content,
    kind: args.kind,
  });
}

/**
 * Send a step-failure payload (stdout/stderr/exit_code) to GPT for
 * diagnosis and persist the analysis as a regular assistant message.
 * Returns the inserted message and emits `chat:message_inserted`.
 * Slow path — typical 2-5s GPT roundtrip; callers should display a
 * placeholder ❌ status message first.
 */
export function analyzeStepFailure(args: {
  executionId: string;
  stepId: string;
  stdout?: string | null;
  stderr?: string | null;
  exitCode?: number | null;
}): Promise<ChatMessage> {
  return invoke("analyze_step_failure", {
    executionId: args.executionId,
    stepId: args.stepId,
    stdout: args.stdout ?? null,
    stderr: args.stderr ?? null,
    exitCode: args.exitCode ?? null,
  });
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

// ── app_state (key/value store for cross-session UI state) ──────────────────

/** Mirrors the Rust struct in src-tauri/src/db/models.rs::AppState. */
export interface AppState {
  key: string;
  value: string;
  updated_at: string;
}

/** Read a single key; resolves `null` when the key was never written. */
export function getAppState(args: { key: string }): Promise<AppState | null> {
  return invoke("get_app_state", args);
}

/** UPSERT a key. Returns the freshly-written row including new updated_at. */
export function setAppState(args: {
  key: string;
  value: string;
}): Promise<AppState> {
  return invoke("set_app_state", args);
}

// ── workflows ───────────────────────────────────────────────────────────────

/** Lightweight summary list — calls `commands::workflows::list_workflows`. */
export function listWorkflows(): Promise<WorkflowSummary[]> {
  return invoke("list_workflows");
}

export function readWorkflow(args: { name: string }): Promise<string> {
  return invoke("read_workflow", args);
}

export function saveWorkflow(args: {
  name: string;
  content: string;
}): Promise<void> {
  return invoke("save_workflow", args);
}

export function deleteWorkflow(args: { name: string }): Promise<void> {
  return invoke("delete_workflow", args);
}

/** Returns the parsed AST. Distinct command name from the JS `parseWorkflow`
 *  helper would shadow — Tauri side is `parse_workflow`. */
export function parseWorkflowFile(args: {
  name: string;
}): Promise<ParsedWorkflow> {
  return invoke("parse_workflow", args);
}

/** Fire-and-forget — backend spawns the WorkflowExecutor and returns the
 *  workflow_execution_id immediately. Progress flows via `workflow:*` events. */
export function executeWorkflow(args: {
  workflowName: string;
  projectId?: string | null;
}): Promise<string> {
  return invoke("execute_workflow", args);
}

export function abortWorkflow(args: {
  workflowExecutionId: string;
}): Promise<void> {
  return invoke("abort_workflow", args);
}

// ── terminal (PTY) ──────────────────────────────────────────────────────────

/** Start a new PTY session. Returns the session id used by subsequent
 *  write/resize/kill calls. Output streams via `terminal:data` events. */
export function terminalSpawn(args: {
  rows: number;
  cols: number;
  cwd?: string | null;
}): Promise<string> {
  return invoke("terminal_spawn", args);
}

export function terminalWrite(args: {
  sessionId: string;
  data: number[];
}): Promise<void> {
  return invoke("terminal_write", args);
}

export function terminalResize(args: {
  sessionId: string;
  rows: number;
  cols: number;
}): Promise<void> {
  return invoke("terminal_resize", args);
}

export function terminalKill(args: { sessionId: string }): Promise<void> {
  return invoke("terminal_kill", args);
}

// ── knowledge base ──────────────────────────────────────────────────────────

/** Persist a `.md` file describing the user. Backend triggers a
 *  best-effort summary regen; failures there don't fail the upload —
 *  caller can retry via `regenerateKnowledgeSummary`. */
export function uploadKnowledgeFile(args: {
  filename: string;
  content: string;
}): Promise<KnowledgeFileMeta> {
  return invoke("upload_knowledge_file", args);
}

export function listKnowledgeFiles(): Promise<KnowledgeFileMeta[]> {
  return invoke("list_knowledge_files");
}

export function deleteKnowledgeFile(args: { id: string }): Promise<void> {
  return invoke("delete_knowledge_file", args);
}

/** Returns `null` when no summary has been generated yet (no files, or
 *  all uploads failed regen). */
export function getKnowledgeSummary(): Promise<KnowledgeSummary | null> {
  return invoke("get_knowledge_summary");
}

/** User-driven retry. Surfaces backend errors (missing key, OpenAI down,
 *  network) — wrap in `safeInvoke` if the caller wants a toast. */
export function regenerateKnowledgeSummary(): Promise<KnowledgeSummary | null> {
  return invoke("regenerate_knowledge_summary");
}

// ── app_state value-only helpers ────────────────────────────────────────────
//
// These are the lighter façade on top of the row-based `getAppState` /
// `setAppState` (defined above for the existing `appStore`). When you
// only care about the value column, prefer these — fewer fields to
// destructure, fewer bytes over the wire. Both APIs persist to the same
// `app_state` table.

export function getAppStateValue(args: {
  key: string;
}): Promise<string | null> {
  return invoke("get_app_state_value", args);
}

export function setAppStateValue(args: {
  key: string;
  value: string;
}): Promise<void> {
  return invoke("set_app_state_value", args);
}

// ── capabilities ────────────────────────────────────────────────────────────

/**
 * Unified @-mention registry — natives shipped with the app + connector
 * rows added by the user. Read-only paths only; mutators land later
 * with the connector flow.
 *
 * `Capability` shape mirrors src-tauri/src/db/models.rs::Capability.
 * Backend rename: Rust `type_` field serializes as `"type"` on the wire
 * so the TS interface keeps the natural name.
 */
export function listCapabilities(): Promise<Capability[]> {
  return invoke("list_capabilities");
}

export function getCapability(args: {
  name: string;
}): Promise<Capability | null> {
  return invoke("get_capability", args);
}

export function listCapabilitiesByType(args: {
  type: CapabilityType;
}): Promise<Capability[]> {
  // Backend command argument is `type_` (Rust keyword escape) but the
  // Tauri bridge accepts the snake_case form via serde. Pass the
  // user-facing `type` and let the IPC layer do the rename.
  return invoke("list_capabilities_by_type", { type_: args.type });
}

// ── integrations ────────────────────────────────────────────────────────────
//
// Mirrors `db::models::IntegrationRow` + the IPC handlers in
// `commands/integrations.rs`. The api_key NEVER appears in any return
// type — it lives only in `~/.genesis/config.toml [integrations.<name>]`
// and is set/cleared exclusively via add/update args (write-only).
//
// `auth_type` on the row is the discriminator string only ('bearer' |
// 'header' | 'query'); the full payload (header_name / param_name)
// for write paths is `IntegrationAuthType` below.

/// Internally-tagged enum mirroring Rust `integrations::AuthType`. Field
/// names stay snake_case because serde on the Rust side keeps them as-is
/// inside the value (Tauri's auto-camelCase only applies to top-level
/// command args, not nested object payloads).
export type IntegrationAuthType =
  | { type: "bearer" }
  | { type: "header"; header_name: string }
  | { type: "query"; param_name: string };

export interface IntegrationRow {
  id: string;
  name: string;
  display_name: string;
  base_url: string;
  /** Discriminator only ('bearer' | 'header' | 'query'). The full
   *  payload (with header_name / param_name) lives in config.toml. */
  auth_type: string;
  spec_file: string;
  /** SQLite stores INTEGER 0/1; backend models it as i64. */
  enabled: number;
  last_used_at: string | null;
  created_at: string;
}

/**
 * Mirrors `integrations::HealthStatus`. Source of truth for the wizard
 * UX: Connected → advance + green badge; AuthFailed → "API key
 * inválida" toast; ServerReachable → advance + yellow note (server up
 * but path/auth may need attention); Unreachable → "Não foi possível
 * conectar" toast.
 */
export type IntegrationHealth =
  | "connected"
  | "auth_failed"
  | "server_reachable"
  | "unreachable";

export interface TestIntegrationResult {
  /** 4-state outcome — primary signal for the new wizard UX. */
  health: IntegrationHealth;
  elapsed_ms: number;
  /** Convenience boolean: `true` for Connected | ServerReachable. */
  ok: boolean;
  /** PT-BR human label paired with `health`. */
  message: string;
}

export function listIntegrations(): Promise<IntegrationRow[]> {
  return invoke("list_integrations");
}

/**
 * Add a new integration. Wizard-simplified IPC: only the 4 essentials
 * cross the boundary. Backend defaults `auth_type` to Bearer and
 * derives `display_name` by capitalizing the first letter of `name`.
 * Integrations needing header / query auth must be configured by
 * editing `~/.genesis/config.toml` directly.
 */
export function addIntegration(args: {
  name: string;
  baseUrl: string;
  apiKey: string;
  specContent?: string;
}): Promise<IntegrationRow> {
  return invoke("add_integration", args);
}

export function updateIntegration(args: {
  id: string;
  name: string;
  displayName: string;
  baseUrl: string;
  /** Pass to overwrite the stored key; omit to preserve the existing
   *  key on disk (useful when toggling `enabled` without retyping). */
  apiKey?: string;
  authType: IntegrationAuthType;
  enabled: boolean;
  specContent?: string;
}): Promise<IntegrationRow> {
  return invoke("update_integration", args);
}

export function removeIntegration(args: { name: string }): Promise<void> {
  return invoke("remove_integration", args);
}

export function testIntegration(args: {
  name: string;
}): Promise<TestIntegrationResult> {
  return invoke("test_integration", args);
}

// ── placeholders for types not yet returned by backend ──────────────────────
//
// Re-export the row types so consumers can import from a single place when
// working with results coming over the bridge (keeps the import graph flat).

export type { Caminho } from "@/types/caminho";
export type {
  Capability,
  CapabilityChannel,
  CapabilityType,
} from "@/types/capability";
export type { ChatMessage, Conversation } from "@/types/chat";
export type { Config } from "@/types/config";
export type {
  Execution,
  ExecutionDetail,
  ExecutionStep,
  Project,
} from "@/types/project";
export type { KnowledgeFileMeta, KnowledgeSummary } from "@/types/knowledge";
export type { ParsedSkill, SkillMeta } from "@/types/skill";
export type {
  ParsedWorkflow,
  WorkflowMeta,
  WorkflowStep,
  WorkflowSummary,
} from "@/types/workflow";
