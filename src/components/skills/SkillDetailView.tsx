import { useEffect, useState } from "react";
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
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { SkillFileViewer } from "@/components/skills/MarkdownPreview";

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
  getSkillFile,
  moveFile,
  readSkillAssetDataUrl,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";
import { useSkillsStore } from "@/stores/skillsStore";
import type { Skill, SkillDetail } from "@/types/skill";

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
  const setActive = useSkillsStore((s) => s.setActive);
  const clearActive = useSkillsStore((s) => s.clearActive);
  const activeSkill = useSkillsStore((s) => s.activeSkill);

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
  const [exporting, setExporting] = useState(false);

  // Hidrata `activeSkill` no store via setActive(name) — esse já
  // chama getSkill IPC e mescla com o catálogo cached. Limpa no
  // unmount pra liberar memória + evitar flash de skill antiga
  // quando o user navega entre skills.
  useEffect(() => {
    if (!name) return;
    setLoadError(null);
    setSelected({ kind: "skill" });
    void setActive(name).catch((err) => {
      setLoadError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      clearActive();
    };
  }, [name, setActive, clearActive]);

  // Carrega o conteúdo do item selecionado. SKILL.md já vem direto
  // do `activeSkill.content`. Texto via getSkillFile, imagem via
  // readSkillAssetDataUrl, outros tipos caem em mensagem "abrir no FS".
  useEffect(() => {
    if (!activeSkill) return;
    let cancelled = false;
    setPreviewError(null);
    setTextContent(null);
    setImageDataUrl(null);

    if (selected.kind === "skill") {
      setTextContent(activeSkill.content);
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
  }, [activeSkill, selected, name]);

  async function handleExport() {
    setExporting(true);
    try {
      // Two-step flow: backend cria ZIP em /tmp; UI pergunta destino
      // ao usuário; backend move pro lugar final.
      const tempPath = await exportSkill({ name });
      const dest = await save({
        title: "Exportar skill",
        defaultPath: `${name}.skill`,
        filters: [{ name: "Skill package", extensions: ["skill"] }],
      });
      if (!dest) return;
      await moveFile({ src: tempPath, dest });
      toast({ title: `Skill exportada`, description: dest });
    } catch (err) {
      toast({
        title: "Falha ao exportar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
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
        skill={activeSkill}
        busy={busy}
        exporting={exporting}
        onEdit={() => navigate(`/skills/${encodeURIComponent(name)}/edit`)}
        onExport={handleExport}
        onDelete={() => setConfirmDelete(true)}
      />

      <div className="flex min-h-0 flex-1">
        <FileTree
          skill={activeSkill}
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
            skill={activeSkill}
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
  skill: Skill | null;
  busy: boolean;
  exporting: boolean;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function Header({
  name,
  skill,
  busy,
  exporting,
  onEdit,
  onExport,
  onDelete,
}: HeaderProps) {
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
          {skill?.version ? (
            <span className="rounded-md border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-1.5 py-0 font-mono text-[10px] text-[var(--text-2)]">
              v{skill.version}
            </span>
          ) : null}
          {skill?.author ? (
            <span className="rounded-md border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-1.5 py-0 text-[10px] text-[var(--text-2)]">
              por {skill.author}
            </span>
          ) : null}
        </div>
        {skill?.description ? (
          <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">
            {skill.description}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
          Editar
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={busy || exporting}
        >
          {exporting ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin"
              strokeWidth={1.5}
            />
          ) : (
            <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {exporting ? "Exportando..." : "Exportar"}
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
  skill: SkillDetail | null;
  selected: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  collapsedRefs: boolean;
  collapsedAssets: boolean;
  onToggleRefs: () => void;
  onToggleAssets: () => void;
}

function FileTree({
  skill,
  selected,
  onSelect,
  collapsedRefs,
  collapsedAssets,
  onToggleRefs,
  onToggleAssets,
}: FileTreeProps) {
  const refs = skill?.references ?? [];
  const assets = skill?.assets ?? [];

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
  skill: SkillDetail | null;
}

function PreviewPane({
  selected,
  viewMode,
  textContent,
  imageDataUrl,
  previewError,
  skill,
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
    if (!skill) {
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

  // Texto: visual renderiza markdown só pra .md/.markdown. Demais
  // tipos texto (HTML, JSON, etc) caem no CodeView via `forceCode`
  // mesmo no modo visual.
  return (
    <SkillFileViewer
      content={textContent}
      mode={viewMode}
      forceCode={!isMarkdown}
    />
  );
}

