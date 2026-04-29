import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Pencil,
  ScrollText,
  Terminal,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { getConfig, listSkills } from "@/lib/tauri-bridge";
import type { SkillMeta } from "@/types/skill";

interface FileNode {
  /** Absolute path on disk. */
  path: string;
  /** Display name relative to the skill folder. */
  label: string;
  /** Subdir bucket — used to render the tree grouping. */
  bucket: "skill" | "references" | "scripts" | "assets" | "other";
}

const BUCKET_LABEL: Record<FileNode["bucket"], string> = {
  skill: "SKILL.md",
  references: "references/",
  scripts: "scripts/",
  assets: "assets/",
  other: "outros",
};

const BUCKET_ORDER: FileNode["bucket"][] = [
  "skill",
  "references",
  "scripts",
  "assets",
  "other",
];

/**
 * Read-only viewer for v2 skills (folder layout). Renders the meta
 * header, a tab toggle (Rendered/Raw) for the SKILL.md content, and
 * a file tree of references/scripts/assets with click-to-preview for
 * text files.
 *
 * File reads go through `@tauri-apps/plugin-fs` directly. The
 * plugin's default permission set in `capabilities/default.json` may
 * restrict access to the home directory; when reads fail the viewer
 * shows a graceful error message with the path attempted, so the user
 * (or a future fs scope expansion) can diagnose without crashing the
 * UI.
 *
 * Editing v2 skills is out of scope for E3 — the "Editar" button
 * deeplinks to `/skills/:name/edit` which still routes to the v1
 * SkillEditor; v2 editing is a follow-up task.
 */
export function SkillViewerV2() {
  const { name = "" } = useParams<{ name: string }>();
  const [meta, setMeta] = useState<SkillMeta | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const { toast } = useToast();

  // Hydrate everything on mount: meta from list_skills, folder path
  // from getConfig + name, SKILL.md content + folder tree from
  // plugin-fs. Read failures degrade gracefully — the layout stays,
  // the content area just shows an error.
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setLoadError(null);

    (async () => {
      try {
        const [skills, cfg] = await Promise.all([listSkills(), getConfig()]);
        if (cancelled) return;

        const found = skills.find((s) => s.name === name) ?? null;
        setMeta(found);

        const skillsDir = cfg.skills_dir;
        if (!skillsDir) {
          setLoadError("skills_dir não configurado");
          return;
        }
        const folderPath = joinPath(skillsDir, name);
        setFolder(folderPath);

        await loadSkillMd(folderPath, cancelled, setSkillMd, setLoadError);
        await loadFolderTree(folderPath, cancelled, setTree);
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setLoadError(msg);
          toast({
            title: "Falha ao carregar skill v2",
            description: msg,
            variant: "destructive",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [name, toast]);

  // Read the selected reference/script/asset on click. Same graceful
  // error handling — broken read doesn't kill the viewer.
  useEffect(() => {
    if (!selectedPath) {
      setSelectedContent(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewError(null);
    (async () => {
      try {
        const { readTextFile } = await import("@tauri-apps/plugin-fs");
        const text = await readTextFile(selectedPath);
        if (!cancelled) setSelectedContent(text);
      } catch (err) {
        if (!cancelled) {
          setSelectedContent(null);
          setPreviewError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  const grouped = useMemo(() => groupByBucket(tree), [tree]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <Button asChild variant="ghost" size="icon" aria-label="Voltar">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
          <FolderOpen className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">
            {meta?.name ?? name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
            <span className="rounded-md bg-[var(--bg-tertiary)] px-1.5 py-0 font-mono text-[10px]">
              v{meta?.version ?? "?"}
            </span>
            {meta?.author ? (
              <span className="text-[10px]">por {meta.author}</span>
            ) : null}
            {meta?.description ? (
              <span className="truncate">{meta.description}</span>
            ) : null}
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={`/skills/${encodeURIComponent(name)}/edit`}>
            <Pencil className="h-3.5 w-3.5" />
            Editar
          </Link>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-[var(--border-sub)] bg-[var(--bg-secondary)]/40">
          <header className="border-b border-[var(--border-sub)] px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Arquivos
            </span>
            {folder ? (
              <p
                className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-tertiary)]"
                title={folder}
              >
                {folder}
              </p>
            ) : null}
          </header>
          <ScrollArea className="flex-1">
            <FileTree
              grouped={grouped}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          </ScrollArea>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {selectedPath ? (
            <PreviewPane
              path={selectedPath}
              content={selectedContent}
              error={previewError}
              onClose={() => setSelectedPath(null)}
            />
          ) : (
            <SkillMdPane content={skillMd} error={loadError} />
          )}
        </main>
      </div>
    </div>
  );
}

// ── panes ───────────────────────────────────────────────────────────────────

function SkillMdPane({
  content,
  error,
}: {
  content: string | null;
  error: string | null;
}) {
  return (
    <Tabs defaultValue="rendered" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mx-4 mt-4">
        <TabsTrigger value="rendered">Rendered</TabsTrigger>
        <TabsTrigger value="raw">Raw</TabsTrigger>
      </TabsList>
      <TabsContent value="rendered" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="mx-auto max-w-3xl px-6 py-6">
            {error ? (
              <ReadErrorBlock message={error} />
            ) : content === null ? (
              <p className="text-sm text-[var(--text-secondary)]">
                Carregando SKILL.md...
              </p>
            ) : (
              <article className="prose-invert text-sm leading-relaxed text-[var(--text-primary)]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {content}
                </ReactMarkdown>
              </article>
            )}
          </div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="raw" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words px-6 py-6 font-mono text-xs leading-relaxed text-[var(--text-primary)]">
            {error ? error : (content ?? "(sem conteúdo)")}
          </pre>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}

function PreviewPane({
  path,
  content,
  error,
  onClose,
}: {
  path: string;
  content: string | null;
  error: string | null;
  onClose: () => void;
}) {
  const isText = isTextLikePath(path);
  const filename = basename(path);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-sub)] bg-[var(--bg-secondary)]/40 px-4 py-2">
        <div className="min-w-0">
          <span className="block truncate font-mono text-xs font-semibold">
            {filename}
          </span>
          <span
            className="block truncate font-mono text-[10px] text-[var(--text-tertiary)]"
            title={path}
          >
            {path}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Voltar pro SKILL.md
        </Button>
      </header>
      <ScrollArea className="flex-1">
        <div className="px-6 py-4">
          {!isText ? (
            <div className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-tertiary)]/40 p-6 text-center text-xs text-[var(--text-secondary)]">
              Preview não disponível pra binários ou imagens neste viewer.
              Abra o arquivo direto no sistema de arquivos.
            </div>
          ) : error ? (
            <ReadErrorBlock message={error} />
          ) : content === null ? (
            <p className="text-sm text-[var(--text-secondary)]">Carregando...</p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--text-primary)]">
              {content}
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ReadErrorBlock({ message }: { message: string }) {
  return (
    <div className="space-y-2 rounded-lg border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 p-4 text-xs text-[var(--text-secondary)]">
      <p className="font-semibold text-[var(--status-warning)]">
        Não foi possível ler o arquivo
      </p>
      <p className="font-mono">{message}</p>
      <p className="text-[11px] text-[var(--text-tertiary)]">
        Pode ser scope da plugin-fs (capabilities/default.json não permite o
        path) ou arquivo inexistente. Adicione o scope necessário ou aguarde o
        backend expor um command read_skill_v2.
      </p>
    </div>
  );
}

// ── file tree ──────────────────────────────────────────────────────────────

function FileTree({
  grouped,
  selectedPath,
  onSelect,
}: {
  grouped: Record<FileNode["bucket"], FileNode[]>;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const total = BUCKET_ORDER.reduce((acc, b) => acc + grouped[b].length, 0);
  if (total === 0) {
    return (
      <p className="px-3 py-3 text-xs text-[var(--text-tertiary)]">
        Pasta vazia ou sem leitura permitida.
      </p>
    );
  }
  return (
    <ul className="px-2 py-2">
      {BUCKET_ORDER.map((bucket) => {
        const items = grouped[bucket];
        if (items.length === 0) return null;
        return (
          <li key={bucket} className="mb-2">
            <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {BUCKET_LABEL[bucket]}
            </p>
            <ul className="space-y-0.5">
              {items.map((node) => (
                <li key={node.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(node.path)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs",
                      "transition-colors",
                      node.path === selectedPath
                        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                    )}
                  >
                    <NodeIcon bucket={node.bucket} />
                    <span className="truncate font-mono">{node.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function NodeIcon({ bucket }: { bucket: FileNode["bucket"] }) {
  const Icon =
    bucket === "scripts"
      ? Terminal
      : bucket === "references"
        ? ScrollText
        : bucket === "assets"
          ? ImageIcon
          : FileText;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />;
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function loadSkillMd(
  folder: string,
  cancelled: boolean,
  setContent: (s: string) => void,
  setError: (s: string) => void,
) {
  try {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const text = await readTextFile(joinPath(folder, "SKILL.md"));
    if (!cancelled) setContent(text);
  } catch (err) {
    if (!cancelled) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
}

async function loadFolderTree(
  folder: string,
  cancelled: boolean,
  setTree: (t: FileNode[]) => void,
) {
  try {
    const { readDir } = await import("@tauri-apps/plugin-fs");
    const root = await readDir(folder);
    const out: FileNode[] = [];

    for (const entry of root) {
      if (entry.isFile && entry.name === "SKILL.md") {
        out.push({
          path: joinPath(folder, entry.name),
          label: entry.name,
          bucket: "skill",
        });
      } else if (entry.isDirectory) {
        const bucket = bucketFor(entry.name);
        try {
          const children = await readDir(joinPath(folder, entry.name));
          for (const child of children) {
            if (!child.isFile) continue;
            out.push({
              path: joinPath(folder, entry.name, child.name),
              label: `${entry.name}/${child.name}`,
              bucket,
            });
          }
        } catch {
          // Skip subdir we can't read — listing might be partially
          // blocked by scope; we still want the items we did read.
        }
      } else if (entry.isFile) {
        out.push({
          path: joinPath(folder, entry.name),
          label: entry.name,
          bucket: "other",
        });
      }
    }

    if (!cancelled) {
      out.sort((a, b) => a.label.localeCompare(b.label));
      setTree(out);
    }
  } catch {
    // Folder listing failed (permissions / missing) — leave tree
    // empty so the FileTree shows its empty-state message.
    if (!cancelled) setTree([]);
  }
}

function groupByBucket(items: FileNode[]): Record<FileNode["bucket"], FileNode[]> {
  const out: Record<FileNode["bucket"], FileNode[]> = {
    skill: [],
    references: [],
    scripts: [],
    assets: [],
    other: [],
  };
  for (const item of items) {
    out[item.bucket].push(item);
  }
  return out;
}

function bucketFor(name: string): FileNode["bucket"] {
  if (name === "references") return "references";
  if (name === "scripts") return "scripts";
  if (name === "assets") return "assets";
  return "other";
}

function joinPath(...parts: string[]): string {
  // Simple join — collapse double slashes, preserve leading slash.
  return parts
    .filter((p) => p.length > 0)
    .map((p, i) => (i === 0 ? p.replace(/\/$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .join("/");
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

const TEXT_EXT = new Set([
  "md",
  "txt",
  "sh",
  "bash",
  "zsh",
  "py",
  "js",
  "ts",
  "tsx",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "css",
  "log",
  "csv",
  "tsv",
  "sql",
]);

function isTextLikePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return true; // no extension = treat as text by default
  const ext = path.slice(dot + 1).toLowerCase();
  return TEXT_EXT.has(ext);
}
