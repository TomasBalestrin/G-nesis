import { useState } from "react";
import {
  ArrowLeft,
  Check,
  FileText,
  FileUp,
  Image as ImageIcon,
  Info,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  deleteSkillFile,
  saveSkillAsset,
  saveSkillFile,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

export interface SkillSubFile {
  filename: string;
  /** size em bytes — só calculado pra assets vindos de upload. References
   *  inline mostram length do markdown. */
  size: number;
}

interface CreateSkillStep3Props {
  skillName: string;
  references: SkillSubFile[];
  assets: SkillSubFile[];
  onReferencesChange: (next: SkillSubFile[]) => void;
  onAssetsChange: (next: SkillSubFile[]) => void;
  onBack: () => void;
  onFinish: () => void;
}

/**
 * Etapa 3 (opcional) — adiciona arquivos complementares ao package.
 *
 * - **References** (módulos `.md`): mini-editor inline (filename +
 *   markdown) ou upload de `.md` existente. Salvos em
 *   `references/<filename>` via `saveSkillFile` (texto).
 * - **Assets** (templates, HTMLs, imagens, etc): dropzone que aceita
 *   qualquer arquivo. Texto vai por `saveSkillFile`, binário por
 *   `saveSkillAsset` (bytes via Vec<u8>). Salvos em `assets/<filename>`.
 *
 * Eager save: cada upload/edição grava direto em disco — "Concluir"
 * só navega. Remoção é deletada também na hora (deleteSkillFile).
 */
export function CreateSkillStep3({
  skillName,
  references,
  assets,
  onReferencesChange,
  onAssetsChange,
  onBack,
  onFinish,
}: CreateSkillStep3Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function addReferenceInline(filename: string, content: string) {
    const safe = ensureMdExtension(filename.trim());
    if (!safe) return;
    if (references.some((r) => r.filename === safe)) {
      toast({
        title: `Reference ${safe} já existe`,
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      await saveSkillFile({
        name: skillName,
        path: `references/${safe}`,
        content,
      });
      onReferencesChange([
        ...references,
        { filename: safe, size: content.length },
      ]);
      toast({ title: `Reference ${safe} adicionada` });
    } catch (err) {
      toast({
        title: "Falha ao salvar reference",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addReferenceUpload(file: File) {
    if (!file.name.toLowerCase().endsWith(".md")) {
      toast({
        title: "Apenas arquivos .md em references",
        description: "Outros formatos vão pra assets.",
        variant: "destructive",
      });
      return;
    }
    const text = await file.text();
    await addReferenceInline(file.name, text);
  }

  async function removeReference(filename: string) {
    setBusy(true);
    try {
      await deleteSkillFile({
        name: skillName,
        path: `references/${filename}`,
      });
      onReferencesChange(references.filter((r) => r.filename !== filename));
    } catch (err) {
      toast({
        title: "Falha ao remover reference",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addAsset(file: File) {
    if (assets.some((a) => a.filename === file.name)) {
      toast({
        title: `Asset ${file.name} já existe`,
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      await saveSkillAsset({
        name: skillName,
        path: `assets/${file.name}`,
        bytes,
      });
      onAssetsChange([...assets, { filename: file.name, size: file.size }]);
      toast({ title: `Asset ${file.name} adicionado` });
    } catch (err) {
      toast({
        title: "Falha ao salvar asset",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeAsset(filename: string) {
    setBusy(true);
    try {
      await deleteSkillFile({
        name: skillName,
        path: `assets/${filename}`,
      });
      onAssetsChange(assets.filter((a) => a.filename !== filename));
    } catch (err) {
      toast({
        title: "Falha ao remover asset",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-6 p-6">
          <OptionalNotice />
          <ReferencesSection
            items={references}
            disabled={busy}
            onAddInline={addReferenceInline}
            onAddUpload={addReferenceUpload}
            onRemove={removeReference}
          />
          <AssetsSection
            items={assets}
            disabled={busy}
            onAdd={addAsset}
            onRemove={removeAsset}
          />
          <StructurePreview
            skillName={skillName}
            references={references}
            assets={assets}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-[var(--bg-subtle)] px-4 py-3">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Voltar
        </Button>
        <Button onClick={onFinish} disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Check className="h-4 w-4" strokeWidth={1.5} />
          )}
          Concluir
        </Button>
      </div>
    </div>
  );
}

function OptionalNotice() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-4 py-3 text-sm">
      <Info
        className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-3)]"
        strokeWidth={1.5}
      />
      <div className="text-[var(--text-2)]">
        Esta etapa é opcional — você pode adicionar references e assets
        depois pela página da skill.
      </div>
    </div>
  );
}

interface ReferencesSectionProps {
  items: SkillSubFile[];
  disabled: boolean;
  onAddInline: (filename: string, content: string) => void;
  onAddUpload: (file: File) => void;
  onRemove: (filename: string) => void;
}

function ReferencesSection({
  items,
  disabled,
  onAddInline,
  onAddUpload,
  onRemove,
}: ReferencesSectionProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftContent, setDraftContent] = useState("");

  function handleSubmit() {
    if (!draftName.trim() || !draftContent.trim()) return;
    onAddInline(draftName, draftContent);
    setEditorOpen(false);
    setDraftName("");
    setDraftContent("");
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onAddUpload(file);
    e.target.value = "";
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">References</h3>
          <p className="text-[11px] text-[var(--text-3)]">
            Módulos `.md` complementares — orquestrador injeta sob demanda.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm transition-colors",
              "hover:bg-[var(--bg-muted)]",
              disabled && "pointer-events-none opacity-60",
            )}
          >
            <FileUp className="h-4 w-4" strokeWidth={1.5} />
            Upload .md
            <input
              type="file"
              accept=".md"
              className="hidden"
              onChange={handleFileInput}
              disabled={disabled}
            />
          </label>
          <Button
            type="button"
            size="sm"
            onClick={() => setEditorOpen((v) => !v)}
            disabled={disabled}
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Adicionar
          </Button>
        </div>
      </header>

      {editorOpen ? (
        <div className="space-y-2 rounded-lg border border-[var(--border-sub)] bg-card p-3">
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="modulo-1.md"
            className="font-mono"
            disabled={disabled}
          />
          <textarea
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
            placeholder="# Módulo 1&#10;&#10;Conteúdo do módulo em markdown..."
            spellCheck={false}
            disabled={disabled}
            className="min-h-[160px] w-full resize-y rounded-md bg-[var(--code-bg)] p-3 font-mono text-xs leading-relaxed text-[var(--code-text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)]"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditorOpen(false)}
              disabled={disabled}
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={
                disabled || !draftName.trim() || !draftContent.trim()
              }
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              Adicionar reference
            </Button>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-4 py-6 text-center text-xs text-[var(--text-3)]">
          Nenhuma reference adicionada.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <FileRow
              key={r.filename}
              filename={r.filename}
              size={r.size}
              icon={
                <FileText
                  className="h-4 w-4 text-[var(--text-3)]"
                  strokeWidth={1.5}
                />
              }
              disabled={disabled}
              onRemove={() => onRemove(r.filename)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface AssetsSectionProps {
  items: SkillSubFile[];
  disabled: boolean;
  onAdd: (file: File) => void;
  onRemove: (filename: string) => void;
}

function AssetsSection({
  items,
  disabled,
  onAdd,
  onRemove,
}: AssetsSectionProps) {
  const [dragActive, setDragActive] = useState(false);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const file of files) {
      onAdd(file);
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      onAdd(file);
    }
    e.target.value = "";
  }

  return (
    <section className="space-y-3">
      <header>
        <h3 className="text-sm font-semibold">Assets</h3>
        <p className="text-[11px] text-[var(--text-3)]">
          Templates, HTMLs, imagens — qualquer recurso usado pela skill.
        </p>
      </header>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-sm transition-colors",
          dragActive
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--border-sub)] hover:border-[var(--text-3)]",
          disabled && "pointer-events-none opacity-60",
        )}
      >
        <Upload
          className="h-5 w-5 text-[var(--text-3)]"
          strokeWidth={1.5}
        />
        <span className="text-center text-[var(--text-2)]">
          Arraste arquivos ou clique para selecionar
        </span>
        <input
          type="file"
          multiple
          className="hidden"
          onChange={handleInput}
          disabled={disabled}
        />
      </label>

      {items.length === 0 ? null : (
        <ul className="space-y-2">
          {items.map((a) => (
            <FileRow
              key={a.filename}
              filename={a.filename}
              size={a.size}
              icon={iconForAsset(a.filename)}
              disabled={disabled}
              onRemove={() => onRemove(a.filename)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function iconForAsset(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return (
      <ImageIcon
        className="h-4 w-4 text-[var(--text-3)]"
        strokeWidth={1.5}
      />
    );
  }
  return (
    <FileText className="h-4 w-4 text-[var(--text-3)]" strokeWidth={1.5} />
  );
}

interface FileRowProps {
  filename: string;
  size: number;
  icon: React.ReactNode;
  disabled: boolean;
  onRemove: () => void;
}

function FileRow({
  filename,
  size,
  icon,
  disabled,
  onRemove,
}: FileRowProps) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs">{filename}</div>
        <div className="text-[10px] text-[var(--text-3)]">
          {formatBytes(size)}
        </div>
      </div>
      <button
        type="button"
        aria-label={`Remover ${filename}`}
        onClick={onRemove}
        disabled={disabled}
        className="shrink-0 rounded p-1.5 text-[var(--text-3)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </li>
  );
}

interface StructurePreviewProps {
  skillName: string;
  references: SkillSubFile[];
  assets: SkillSubFile[];
}

function StructurePreview({
  skillName,
  references,
  assets,
}: StructurePreviewProps) {
  const lines: string[] = [];
  lines.push(`${skillName || "(sem nome)"}/`);
  lines.push("├── SKILL.md");
  if (references.length > 0) {
    const refConn = assets.length > 0 ? "├──" : "└──";
    lines.push(`${refConn} references/ (${references.length} arquivo${references.length === 1 ? "" : "s"})`);
    references.forEach((r, idx) => {
      const isLast = idx === references.length - 1;
      const branchPrefix = assets.length > 0 ? "│   " : "    ";
      lines.push(`${branchPrefix}${isLast ? "└──" : "├──"} ${r.filename}`);
    });
  }
  if (assets.length > 0) {
    lines.push(`└── assets/ (${assets.length} arquivo${assets.length === 1 ? "" : "s"})`);
    assets.forEach((a, idx) => {
      const isLast = idx === assets.length - 1;
      lines.push(`    ${isLast ? "└──" : "├──"} ${a.filename}`);
    });
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Estrutura final</h3>
      <pre className="overflow-x-auto rounded-lg border border-[var(--border-sub)] bg-[var(--code-bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--code-text)]">
        {lines.join("\n")}
      </pre>
    </section>
  );
}

function ensureMdExtension(name: string): string | null {
  if (!name) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return null;
  }
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
