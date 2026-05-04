import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Code,
  Download,
  Eye,
  FileCode,
  FileText,
  Folder,
  Image as ImageIcon,
  Pencil,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/useToast";
import {
  deleteSkill,
  exportSkill,
  getSkill,
  getSkillFile,
  listSkills,
  readSkillAssetDataUrl,
  type SkillBundle,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useSkillsStore } from "@/stores/skillsStore";
import type { SkillMeta } from "@/types/skill";

type ViewMode = "visual" | "code";

interface SelectedItem {
  kind: "skill" | "reference" | "asset";
  /** undefined for kind === 'skill' (canonical SKILL.md). */
  filename?: string;
}

const TEXT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "json",
  "yaml",
  "yml",
  "toml",
  "html",
  "htm",
  "css",
  "js",
  "ts",
  "tsx",
  "jsx",
  "xml",
  "csv",
  "sh",
  "bash",
  "py",
  "log",
  "sql",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
]);

/**
 * Visualização detalhada de uma skill v2 — substitui o SkillViewerV2.
 *
 * Layout split:
 *  - Tree esquerda: SKILL.md (destacado) + references/ (colapsável)
 *    + assets/ (colapsável)
 *  - Pane direita: toggle Visual/Código no topo, render markdown
 *    formatado (ReactMarkdown) ou raw (com numeração de linha) pra
 *    arquivos texto. Imagens via data URL inline; binários sem
 *    suporte caem em metadata + abrir-no-FS.
 *
 * Header: nome + badge versão + badge autor + Editar/Exportar/Deletar.
 * Editar navega pra /skills/:name/edit (CreateSkillWizard em modo
 * edição, abre direto na etapa 2 com conteúdo hidratado).
 */
export function SkillDetailView() {
  const { name = "" } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const refreshSkills = useSkillsStore((s) => s.refresh);

  const [bundle, setBundle] = useState<SkillBundle | null>(null);
  const [meta, setMeta] = useState<SkillMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedItem>({ kind: "skill" });
  const [textContent, setTextContent] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [collapsedRefs, setCollapsedRefs] = useState(false);
  const [collapsedAssets, setCollapsedAssets] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Hydrate bundle + meta. Bundle é IPC (getSkill), meta vem do
  // listSkills (parseado, traz version/author do frontmatter).
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const [b, skills] = await Promise.all([
          getSkill({ name }),
          listSkills(),
        ]);
        if (cancelled) return;
        setBundle(b);
        setMeta(skills.find((s) => s.name === name) ?? null);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name]);

  // Carrega o conteúdo do item selecionado. Texto via getSkillFile,
  // imagem via readSkillAssetDataUrl, outros tipos caem em null +
  // mensagem "abrir no FS".
  useEffect(() => {
    if (!bundle) return;
    let cancelled = false;
    setPreviewError(null);
    setTextContent(null);
    setImageDataUrl(null);

    if (selected.kind === "skill") {
      setTextContent(bundle.skill_md);
      return;
    }
    const filename = selected.filename ?? "";
    const path =
      selected.kind === "reference"
        ? `references/${filename}`
        : `assets/${filename}`;
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";

    (async () => {
      try {
        if (IMAGE_EXTENSIONS.has(ext)) {
          const url = await readSkillAssetDataUrl({ name, path });
          if (!cancelled) setImageDataUrl(url);
        } else if (TEXT_EXTENSIONS.has(ext) || ext === "") {
          const text = await getSkillFile({ name, path });
          if (!cancelled) setTextContent(text);
        }
        // outros tipos: cai no else-block do PreviewPane (sem texto, sem imagem)
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bundle, selected, name]);

  async function handleExport() {
    setBusy(true);
    try {
      const dest = await save({
        title: "Exportar skill",
        defaultPath: `${name}.skill`,
        filters: [{ name: "Skill package", extensions: ["skill"] }],
      });
      if (!dest) return;
      await exportSkill({ name, destPath: dest });
      toast({ title: `Skill exportada`, description: dest });
    } catch (err) {
      toast({
        title: "Falha ao exportar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmDelete() {
    setBusy(true);
    try {
      await deleteSkill({ name });
      toast({ title: `Skill ${name} deletada` });
      await refreshSkills();
      navigate("/");
    } catch (err) {
      toast({
        title: "Falha ao deletar skill",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-[var(--text-2)]">
        <p className="font-medium">Falha ao carregar skill</p>
        <p className="font-mono text-xs">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        name={name}
        meta={meta}
        busy={busy}
        onEdit={() => navigate(`/skills/${encodeURIComponent(name)}/edit`)}
        onExport={handleExport}
        onDelete={() => setConfirmDelete(true)}
      />

      <div className="flex min-h-0 flex-1">
        <FileTree
          bundle={bundle}
          selected={selected}
          onSelect={setSelected}
          collapsedRefs={collapsedRefs}
          collapsedAssets={collapsedAssets}
          onToggleRefs={() => setCollapsedRefs((v) => !v)}
          onToggleAssets={() => setCollapsedAssets((v) => !v)}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <PreviewToolbar
            selected={selected}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
          <PreviewPane
            selected={selected}
            viewMode={viewMode}
            textContent={textContent}
            imageDataUrl={imageDataUrl}
            previewError={previewError}
            bundle={bundle}
          />
        </main>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deletar skill {name}?</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{name}</span> será removida do
              skills_dir. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={busy}
            >
              {busy ? "Deletando..." : "Deletar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface HeaderProps {
  name: string;
  meta: SkillMeta | null;
  busy: boolean;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function Header({ name, meta, busy, onEdit, onExport, onDelete }: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
      <Button asChild variant="ghost" size="icon" aria-label="Voltar">
        <Link to="/">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{name}</h1>
          {meta?.version ? (
            <span className="rounded-md border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-1.5 py-0 font-mono text-[10px] text-[var(--text-2)]">
              v{meta.version}
            </span>
          ) : null}
          {meta?.author ? (
            <span className="rounded-md border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-1.5 py-0 text-[10px] text-[var(--text-2)]">
              por {meta.author}
            </span>
          ) : null}
        </div>
        {meta?.description ? (
          <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">
            {meta.description}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
          Editar
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} disabled={busy}>
          <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
          Exportar
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Deletar ${name}`}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          Deletar
        </Button>
      </div>
    </header>
  );
}

interface FileTreeProps {
  bundle: SkillBundle | null;
  selected: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  collapsedRefs: boolean;
  collapsedAssets: boolean;
  onToggleRefs: () => void;
  onToggleAssets: () => void;
}

function FileTree({
  bundle,
  selected,
  onSelect,
  collapsedRefs,
  collapsedAssets,
  onToggleRefs,
  onToggleAssets,
}: FileTreeProps) {
  const refs = bundle?.references ?? [];
  const assets = bundle?.assets ?? [];

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-[var(--bg-subtle)]/40">
      <header className="border-b border-[var(--border-sub)] px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          Arquivos
        </span>
      </header>
      <ScrollArea className="flex-1">
        <ul className="space-y-1 p-2">
          <li>
            <button
              type="button"
              onClick={() => onSelect({ kind: "skill" })}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                selected.kind === "skill"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text-2)] hover:bg-[var(--bg-muted)]",
              )}
            >
              <FileCode
                className="h-3.5 w-3.5 shrink-0"
                strokeWidth={1.5}
              />
              <span className="truncate font-mono font-medium">SKILL.md</span>
            </button>
          </li>

          <FolderGroup
            label="references/"
            count={refs.length}
            collapsed={collapsedRefs}
            onToggle={onToggleRefs}
          >
            {refs.map((filename) => (
              <FileButton
                key={filename}
                filename={filename}
                icon={
                  <FileText
                    className="h-3.5 w-3.5 shrink-0"
                    strokeWidth={1.5}
                  />
                }
                active={
                  selected.kind === "reference" &&
                  selected.filename === filename
                }
                onClick={() =>
                  onSelect({ kind: "reference", filename })
                }
              />
            ))}
          </FolderGroup>

          <FolderGroup
            label="assets/"
            count={assets.length}
            collapsed={collapsedAssets}
            onToggle={onToggleAssets}
          >
            {assets.map((filename) => (
              <FileButton
                key={filename}
                filename={filename}
                icon={iconForAsset(filename)}
                active={
                  selected.kind === "asset" && selected.filename === filename
                }
                onClick={() => onSelect({ kind: "asset", filename })}
              />
            ))}
          </FolderGroup>
        </ul>
      </ScrollArea>
    </aside>
  );
}

interface FolderGroupProps {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function FolderGroup({
  label,
  count,
  collapsed,
  onToggle,
  children,
}: FolderGroupProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-2)] hover:bg-[var(--bg-muted)]"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={1.5} />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.5} />
        )}
        <Folder className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="font-mono">{label}</span>
        <span className="ml-auto text-[10px] text-[var(--text-3)]">
          {count}
        </span>
      </button>
      {!collapsed && count > 0 ? (
        <ul className="mt-0.5 space-y-0.5 pl-5">{children}</ul>
      ) : null}
    </li>
  );
}

interface FileButtonProps {
  filename: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}

function FileButton({ filename, icon, active, onClick }: FileButtonProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors",
          active
            ? "bg-[var(--accent-soft)] text-[var(--accent)]"
            : "text-[var(--text-2)] hover:bg-[var(--bg-muted)]",
        )}
      >
        {icon}
        <span className="truncate font-mono">{filename}</span>
      </button>
    </li>
  );
}

function iconForAsset(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTENSIONS.has(ext)) {
    return (
      <ImageIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
    );
  }
  return <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />;
}

interface PreviewToolbarProps {
  selected: SelectedItem;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
}

function PreviewToolbar({
  selected,
  viewMode,
  onViewModeChange,
}: PreviewToolbarProps) {
  const label =
    selected.kind === "skill"
      ? "SKILL.md"
      : selected.kind === "reference"
        ? `references/${selected.filename ?? ""}`
        : `assets/${selected.filename ?? ""}`;
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-[var(--bg-subtle)] px-4 py-2">
      <span className="truncate font-mono text-xs text-[var(--text-2)]">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <ToolbarBtn
          label="Visual"
          active={viewMode === "visual"}
          onClick={() => onViewModeChange("visual")}
        >
          <Eye className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
        <ToolbarBtn
          label="Código"
          active={viewMode === "code"}
          onClick={() => onViewModeChange("code")}
        >
          <Code className="h-4 w-4" strokeWidth={1.5} />
        </ToolbarBtn>
      </div>
    </div>
  );
}

function ToolbarBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded text-[var(--text-2)] transition-colors",
        "hover:bg-[var(--bg-muted)] hover:text-foreground",
        active && "bg-[var(--accent-soft)] text-[var(--accent)]",
      )}
    >
      {children}
    </button>
  );
}

interface PreviewPaneProps {
  selected: SelectedItem;
  viewMode: ViewMode;
  textContent: string | null;
  imageDataUrl: string | null;
  previewError: string | null;
  bundle: SkillBundle | null;
}

function PreviewPane({
  selected,
  viewMode,
  textContent,
  imageDataUrl,
  previewError,
  bundle,
}: PreviewPaneProps) {
  const isMarkdown =
    selected.kind === "skill" ||
    (selected.filename ?? "").toLowerCase().endsWith(".md") ||
    (selected.filename ?? "").toLowerCase().endsWith(".markdown");

  if (previewError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-lg border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 px-4 py-3 text-xs text-[var(--text-2)]">
          {previewError}
        </div>
      </div>
    );
  }

  if (imageDataUrl) {
    return (
      <ScrollArea className="flex-1">
        <div className="flex items-center justify-center p-6">
          <img
            src={imageDataUrl}
            alt={selected.filename ?? ""}
            className="max-h-[80vh] max-w-full rounded border border-[var(--border-sub)]"
          />
        </div>
      </ScrollArea>
    );
  }

  if (textContent === null) {
    if (!bundle) {
      return (
        <div className="flex flex-1 items-center justify-center text-xs text-[var(--text-3)]">
          Carregando...
        </div>
      );
    }
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-[var(--text-2)]">
        <div>
          <p className="font-medium">Preview não disponível</p>
          <p className="mt-1 text-[var(--text-3)]">
            Tipo de arquivo não suportado pelo viewer. Abra direto no FS.
          </p>
        </div>
      </div>
    );
  }

  if (viewMode === "visual" && isMarkdown) {
    return (
      <ScrollArea className="flex-1">
        <article className="mx-auto max-w-3xl px-6 py-6 text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {textContent}
          </ReactMarkdown>
        </article>
      </ScrollArea>
    );
  }

  if (viewMode === "visual" && !isMarkdown) {
    // HTML preview inline (text mode for HTML, sandboxed iframe seria
    // ideal mas overkill aqui — só rendering via <pre> mostra a fonte).
    // Fallback: mostra raw com numeração igual ao modo código.
    return <CodeView content={textContent} />;
  }

  return <CodeView content={textContent} />;
}

function CodeView({ content }: { content: string }) {
  const lines = useMemo(() => content.split("\n"), [content]);
  return (
    <ScrollArea className="flex-1">
      <pre className="flex font-mono text-xs leading-relaxed">
        <code className="select-none border-r border-[var(--border-sub)] bg-[var(--bg-subtle)] px-3 py-4 text-right text-[var(--text-3)]">
          {lines.map((_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </code>
        <code className="flex-1 px-4 py-4 text-[var(--code-text)]">
          {lines.map((line, idx) => (
            <div key={idx} className="whitespace-pre-wrap break-words">
              {line || " "}
            </div>
          ))}
        </code>
      </pre>
    </ScrollArea>
  );
}

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mb-3 mt-4 text-2xl font-bold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-xl font-semibold">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-3 text-lg font-semibold">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mt-2 whitespace-pre-wrap first:mt-0">{children}</p>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg bg-[var(--code-bg)] p-3 font-mono text-xs text-[var(--code-tx)]">
      {children}
    </pre>
  ),
  code: ({ className, children }) => (
    <code
      className={cn(
        "rounded bg-[var(--code-bg)] px-1 py-0.5 font-mono text-xs text-[var(--code-tx)]",
        className,
      )}
    >
      {children}
    </code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[var(--border-str)] pl-3 text-[var(--text-2)]">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-[var(--border-sub)]" />,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--accent)] underline underline-offset-2"
    >
      {children}
    </a>
  ),
};
