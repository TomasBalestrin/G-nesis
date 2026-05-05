import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Code,
  Download,
  Eye,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate, useParams } from "react-router-dom";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/useToast";
import {
  deleteSkill,
  exportSkill,
  getSkillFile,
  moveFile,
  readSkillAssetDataUrl,
} from "@/lib/tauri-bridge";
import { useSkillsStore, type SelectedSkillFile } from "@/stores/skillsStore";
import type { SkillDetail } from "@/types/skill";

type ViewMode = "visual" | "code";

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
 * Visualização da skill no padrão Figma v2 (white-04). Roda dentro do
 * SettingsLayout — file tree fica no SkillTreePanel (3º painel) e
 * compartilha selectedFile via skillsStore. Aqui renderiza só:
 *
 *   - Header: nome (Lora 40px) + descrição + ações (Editar/Exportar/
 *     Deletar) + separador
 *   - Card preview: pill toggle Visual/Código + conteúdo do arquivo
 *     selecionado (markdown render ou raw code)
 *
 * Editar continua indo pra /skills/:name/edit (rota top-level com o
 * CreateSkillFlow em modo edição). Deletar volta pra /settings/skills.
 */
export function SkillDetailView() {
  const { name = "" } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const refreshSkills = useSkillsStore((s) => s.refresh);
  const setActive = useSkillsStore((s) => s.setActive);
  const clearActive = useSkillsStore((s) => s.clearActive);
  const activeSkill = useSkillsStore((s) => s.activeSkill);
  const selectedFile = useSkillsStore((s) => s.selectedFile);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!name) return;
    setLoadError(null);
    void setActive(name).catch((err) => {
      setLoadError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      clearActive();
    };
  }, [name, setActive, clearActive]);

  useEffect(() => {
    if (!activeSkill) return;
    let cancelled = false;
    setPreviewError(null);
    setTextContent(null);
    setImageDataUrl(null);

    if (selectedFile.kind === "skill") {
      setTextContent(activeSkill.content);
      return;
    }

    const filename = selectedFile.filename;
    const subdir =
      selectedFile.kind === "reference"
        ? "references"
        : selectedFile.kind === "script"
          ? "scripts"
          : "assets";
    const path = `${subdir}/${filename}`;
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
      } catch (err) {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSkill, selectedFile, name]);

  async function handleExport() {
    setExporting(true);
    try {
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
      navigate("/settings/skills");
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
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            color: "var(--gv2-text-secondary)",
          }}
        >
          Falha ao carregar skill
        </p>
        <p
          className="font-mono"
          style={{
            fontSize: "12px",
            color: "var(--gv2-text-secondary)",
          }}
        >
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto"
      style={{ background: "var(--gv2-bg)" }}
    >
      <div
        style={{
          padding: "40px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DetailHeader
          name={name}
          skill={activeSkill}
          busy={busy}
          exporting={exporting}
          onEdit={() => navigate(`/skills/${encodeURIComponent(name)}/edit`)}
          onExport={handleExport}
          onDelete={() => setConfirmDelete(true)}
        />
        <Divider />
        <PreviewCard
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selected={selectedFile}
          textContent={textContent}
          imageDataUrl={imageDataUrl}
          previewError={previewError}
          skill={activeSkill}
        />
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
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
              style={{
                padding: "10px 20px",
                borderRadius: "var(--gv2-radius-sm)",
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "15px",
                color: "var(--gv2-text-secondary)",
                background: "transparent",
                border: "1px solid var(--gv2-input-border)",
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={busy}
              style={{
                padding: "10px 20px",
                borderRadius: "var(--gv2-radius-sm)",
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: "15px",
                color: "#fff",
                background: "var(--destructive, #C4453A)",
                border: "none",
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "Deletando..." : "Deletar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      style={{
        height: "1px",
        marginTop: "30px",
        background: "var(--gv2-border)",
      }}
    />
  );
}

interface DetailHeaderProps {
  name: string;
  skill: SkillDetail | null;
  busy: boolean;
  exporting: boolean;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function DetailHeader({
  name,
  skill,
  busy,
  exporting,
  onEdit,
  onExport,
  onDelete,
}: DetailHeaderProps) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "30px",
      }}
    >
      <div className="min-w-0 flex-1">
        <h1
          className="truncate"
          style={{
            fontFamily: "Lora, Georgia, serif",
            fontWeight: 500,
            fontSize: "40px",
            lineHeight: 1.1,
            color: "var(--gv2-text)",
            margin: 0,
          }}
        >
          {name}
        </h1>
        {skill?.description ? (
          <p
            style={{
              marginTop: "15px",
              fontFamily: "Inter, system-ui, sans-serif",
              fontWeight: 400,
              fontSize: "15px",
              color: "var(--gv2-text-secondary)",
              lineHeight: 1.5,
            }}
          >
            {skill.description}
          </p>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexShrink: 0,
        }}
      >
        <GhostAction
          icon={<Pencil className="h-4 w-4" strokeWidth={1.5} />}
          label="Editar"
          onClick={onEdit}
          disabled={busy}
        />
        <GhostAction
          icon={
            exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            ) : (
              <Download className="h-4 w-4" strokeWidth={1.5} />
            )
          }
          label={exporting ? "Exportando" : "Exportar"}
          onClick={onExport}
          disabled={busy || exporting}
        />
        <GhostAction
          icon={<Trash2 className="h-4 w-4" strokeWidth={1.5} />}
          label="Deletar"
          onClick={onDelete}
          disabled={busy}
          tone="danger"
        />
      </div>
    </header>
  );
}

interface GhostActionProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}

function GhostAction({
  icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: GhostActionProps) {
  const color =
    tone === "danger"
      ? "var(--destructive, #C4453A)"
      : "var(--gv2-text-secondary)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex items-center transition-colors hover:bg-[var(--gv2-active-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gv2-brand)]"
      style={{
        gap: "8px",
        padding: "10px 15px",
        borderRadius: "var(--gv2-radius-sm)",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "14px",
        background: "transparent",
        color,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface PreviewCardProps {
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  selected: SelectedSkillFile;
  textContent: string | null;
  imageDataUrl: string | null;
  previewError: string | null;
  skill: SkillDetail | null;
}

function PreviewCard({
  viewMode,
  onViewModeChange,
  selected,
  textContent,
  imageDataUrl,
  previewError,
  skill,
}: PreviewCardProps) {
  const isMarkdown =
    selected.kind === "skill" ||
    (selected.kind !== "asset" &&
      (selected.filename.toLowerCase().endsWith(".md") ||
        selected.filename.toLowerCase().endsWith(".markdown")));

  return (
    <section
      style={{
        marginTop: "30px",
        background: "var(--gv2-card-bg)",
        border: "1px solid var(--gv2-card-border)",
        borderRadius: "var(--gv2-radius-lg)",
        padding: "30px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
      <div style={{ height: "31px" }} />
      <PreviewBody
        viewMode={viewMode}
        isMarkdown={isMarkdown}
        textContent={textContent}
        imageDataUrl={imageDataUrl}
        previewError={previewError}
        skill={skill}
        selected={selected}
      />
    </section>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (m: ViewMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Alternar entre visualização e código"
      style={{
        display: "inline-flex",
        alignItems: "center",
        background: "var(--gv2-toggle-bg)",
        borderRadius: "var(--gv2-radius-pill)",
        padding: "2px",
        width: "53px",
        height: "28px",
        gap: "0",
      }}
    >
      <ToggleButton
        active={value === "visual"}
        onClick={() => onChange("visual")}
        ariaLabel="Visualizar markdown"
      >
        <Eye className="h-3 w-3" strokeWidth={1.5} />
      </ToggleButton>
      <ToggleButton
        active={value === "code"}
        onClick={() => onChange("code")}
        ariaLabel="Ver código"
      >
        <Code className="h-3 w-3" strokeWidth={1.5} />
      </ToggleButton>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  ariaLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className="inline-flex flex-1 items-center justify-center transition-colors focus-visible:outline-none"
      style={{
        height: "100%",
        borderRadius: "var(--gv2-radius-pill)",
        background: active ? "var(--gv2-brand-button)" : "transparent",
        color: active ? "#000" : "var(--gv2-text-secondary)",
        border: "none",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

interface PreviewBodyProps {
  viewMode: ViewMode;
  isMarkdown: boolean;
  textContent: string | null;
  imageDataUrl: string | null;
  previewError: string | null;
  skill: SkillDetail | null;
  selected: SelectedSkillFile;
}

function PreviewBody({
  viewMode,
  isMarkdown,
  textContent,
  imageDataUrl,
  previewError,
  skill,
  selected,
}: PreviewBodyProps) {
  if (previewError) {
    return (
      <p
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "15px",
          color: "var(--destructive, #C4453A)",
        }}
      >
        {previewError}
      </p>
    );
  }

  if (imageDataUrl && selected.kind !== "skill") {
    return (
      <img
        src={imageDataUrl}
        alt={selected.filename}
        style={{
          maxWidth: "100%",
          maxHeight: "70vh",
          borderRadius: "var(--gv2-radius-md)",
          border: "1px solid var(--gv2-card-border)",
        }}
      />
    );
  }

  if (textContent === null) {
    if (!skill) {
      return (
        <p
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "15px",
            color: "var(--gv2-text-secondary)",
          }}
        >
          Carregando...
        </p>
      );
    }
    return (
      <p
        style={{
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "15px",
          color: "var(--gv2-text-secondary)",
        }}
      >
        Tipo de arquivo não suportado pelo viewer.
      </p>
    );
  }

  if (viewMode === "visual" && isMarkdown) {
    return <MarkdownRender content={textContent} />;
  }

  return <CodeRender content={textContent} />;
}

function MarkdownRender({ content }: { content: string }) {
  return (
    <article style={{ color: "var(--gv2-text)" }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </article>
  );
}

function CodeRender({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <pre
      style={{
        background: "#FAFAFA",
        borderRadius: "8px",
        padding: "20px",
        margin: 0,
        display: "flex",
        gap: "16px",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "14px",
        lineHeight: 1.6,
        color: "var(--gv2-text)",
        overflow: "auto",
      }}
    >
      <code
        aria-hidden
        style={{
          textAlign: "right",
          color: "var(--gv2-text-secondary)",
          userSelect: "none",
        }}
      >
        {lines.map((_, idx) => (
          <div key={idx}>{idx + 1}</div>
        ))}
      </code>
      <code style={{ flex: 1 }}>
        {lines.map((line, idx) => (
          <div key={idx} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {line || " "}
          </div>
        ))}
      </code>
    </pre>
  );
}

const mdComponents: Components = {
  h1: ({ children }) => (
    <h1
      style={{
        fontFamily: "Lora, Georgia, serif",
        fontWeight: 500,
        fontSize: "40px",
        lineHeight: 1.1,
        color: "var(--gv2-text)",
        margin: "0 0 16px",
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      style={{
        fontFamily: "Lora, Georgia, serif",
        fontWeight: 500,
        fontSize: "20px",
        lineHeight: 1.2,
        color: "var(--gv2-text)",
        margin: "24px 0 12px",
      }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      style={{
        fontFamily: "Lora, Georgia, serif",
        fontWeight: 500,
        fontSize: "18px",
        color: "var(--gv2-text)",
        margin: "20px 0 10px",
      }}
    >
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 400,
        fontSize: "15px",
        lineHeight: 1.6,
        color: "var(--gv2-text)",
        margin: "12px 0",
      }}
    >
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul
      style={{
        listStyle: "disc",
        marginLeft: "22.5px",
        margin: "12px 0 12px 22.5px",
        padding: 0,
      }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol
      style={{
        listStyle: "decimal",
        marginLeft: "22.5px",
        margin: "12px 0 12px 22.5px",
        padding: 0,
      }}
    >
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 400,
        fontSize: "15px",
        lineHeight: 1.6,
        color: "var(--gv2-text)",
        margin: "4px 0",
      }}
    >
      {children}
    </li>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        background: "rgba(0,0,0,0.04)",
        borderRadius: "8px",
        padding: "12px",
        margin: "16px 0",
        overflow: "auto",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: "13px",
        lineHeight: 1.6,
        color: "var(--gv2-text)",
      }}
    >
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) return <code className={className}>{children}</code>;
    return (
      <code
        style={{
          background: "rgba(0,0,0,0.04)",
          borderRadius: "4px",
          padding: "2px 6px",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: "13px",
          color: "var(--gv2-text)",
        }}
      >
        {children}
      </code>
    );
  },
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        color: "var(--gv2-brand)",
        textDecoration: "underline",
        textUnderlineOffset: "2px",
      }}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "2px solid var(--gv2-brand)",
        paddingLeft: "16px",
        margin: "16px 0",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: "15px",
        color: "var(--gv2-text-secondary)",
        fontStyle: "italic",
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr
      style={{
        border: "none",
        borderTop: "1px solid var(--gv2-border)",
        margin: "24px 0",
      }}
    />
  ),
  strong: ({ children }) => (
    <strong style={{ fontWeight: 600 }}>{children}</strong>
  ),
  em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "16px 0" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: "14px",
        }}
      >
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        textAlign: "left",
        padding: "8px 12px",
        borderBottom: "1px solid var(--gv2-border)",
        fontWeight: 600,
        color: "var(--gv2-text)",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--gv2-border)",
        color: "var(--gv2-text)",
      }}
    >
      {children}
    </td>
  ),
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      style={{
        maxWidth: "100%",
        borderRadius: "8px",
        margin: "12px 0",
      }}
    />
  ),
};
