import { useEffect, useRef, useState } from "react";
import {
  Building2,
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Upload,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import {
  deleteKnowledgeFile,
  getAppStateValue,
  getKnowledgeSummary,
  listKnowledgeFiles,
  regenerateKnowledgeSummary,
  setAppStateValue,
  uploadKnowledgeFile,
} from "@/lib/tauri-bridge";
import type { KnowledgeFileMeta, KnowledgeSummary } from "@/types/knowledge";

const USER_NAME_KEY = "user_name";
const COMPANY_NAME_KEY = "company_name";

/**
 * Settings panel that mirrors the OnboardingPage flow but as a long-lived
 * surface — three sub-sections, each independently saved:
 *
 *   1. Perfil   — user_name + company_name in app_state
 *   2. Arquivos — drag/drop .md, immediate upload, X to delete
 *   3. Resumo   — read-only summary + Regenerar button
 *
 * Hydrates everything on mount via parallel IPC reads. Each save/upload
 * triggers a focused toast; surface-wide errors fall back to the generic
 * load-failure banner so the user knows the form may be stale.
 *
 * Self-contained Section markup — duplicates the small helper from
 * SettingsPage rather than exporting it (cheap copy keeps SettingsPage
 * untouchable per the task constraints).
 */
export function KnowledgeSection() {
  return (
    <div className="space-y-8">
      <ProfileSubsection />
      <FilesSubsection />
      <SummarySubsection />
    </div>
  );
}

// ── perfil ──────────────────────────────────────────────────────────────────

function ProfileSubsection() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getAppStateValue({ key: USER_NAME_KEY }),
      getAppStateValue({ key: COMPANY_NAME_KEY }),
    ])
      .then(([n, c]) => {
        if (cancelled) return;
        setName(n ?? "");
        setCompany(c ?? "");
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: "Falha ao carregar perfil",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function handleSave() {
    setSaving(true);
    try {
      await Promise.all([
        setAppStateValue({ key: USER_NAME_KEY, value: name.trim() }),
        setAppStateValue({ key: COMPANY_NAME_KEY, value: company.trim() }),
      ]);
      toast({ title: "Perfil salvo" });
    } catch (err) {
      toast({
        title: "Falha ao salvar perfil",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Subsection
      icon={<Sparkles className="h-4 w-4" />}
      title="Perfil"
      description="Seu nome e empresa entram no system prompt das conversas."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nome" icon={<User className="h-3.5 w-3.5" />}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Maria Silva"
            disabled={!loaded || saving}
            spellCheck={false}
          />
        </Field>
        <Field label="Empresa" icon={<Building2 className="h-3.5 w-3.5" />}>
          <Input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Inc."
            disabled={!loaded || saving}
            spellCheck={false}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!loaded || saving}>
          <Save className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar perfil"}
        </Button>
      </div>
    </Subsection>
  );
}

// ── arquivos ────────────────────────────────────────────────────────────────

function FilesSubsection() {
  const [files, setFiles] = useState<KnowledgeFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  async function refresh() {
    try {
      setFiles(await listKnowledgeFiles());
    } catch (err) {
      toast({
        title: "Falha ao listar arquivos",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  useEffect(() => {
    let cancelled = false;
    listKnowledgeFiles()
      .then((fs) => {
        if (!cancelled) setFiles(fs);
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: "Falha ao carregar arquivos",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function ingest(list: FileList | File[]) {
    const arr = Array.from(list).filter((f) =>
      f.name.toLowerCase().endsWith(".md"),
    );
    if (arr.length === 0) {
      toast({
        title: "Apenas arquivos .md são aceitos",
        variant: "destructive",
      });
      return;
    }
    setUploading((n) => n + arr.length);
    for (const file of arr) {
      try {
        const content = await file.text();
        await uploadKnowledgeFile({ filename: file.name, content });
      } catch (err) {
        toast({
          title: `Falha ao subir ${file.name}`,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    }
    setUploading((n) => Math.max(0, n - arr.length));
    void refresh();
  }

  async function handleRemove(id: string, filename: string) {
    try {
      await deleteKnowledgeFile({ id });
      setFiles((prev) => prev.filter((f) => f.id !== id));
      toast({ title: `${filename} removido` });
    } catch (err) {
      toast({
        title: `Falha ao remover ${filename}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <Subsection
      icon={<FileText className="h-4 w-4" />}
      title="Arquivos da base"
      description="Markdown sobre você, seus processos e ferramentas. Cada upload regenera o resumo."
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void ingest(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-6 py-6 text-center transition-colors",
          dragging
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--border)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)]",
        )}
      >
        <Upload className="h-5 w-5 text-[var(--text-tertiary)]" />
        <p className="text-xs text-[var(--text-secondary)]">
          {dragging
            ? "Solte aqui pra adicionar"
            : "Arraste .md ou clique pra selecionar"}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".md,text/markdown"
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) {
              void ingest(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>

      {loading ? (
        <p className="text-xs text-[var(--text-tertiary)]">Carregando...</p>
      ) : files.length === 0 && uploading === 0 ? (
        <p className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-3 py-4 text-center text-xs text-[var(--text-secondary)]">
          Nenhum arquivo ainda.
        </p>
      ) : (
        <ScrollArea className="max-h-56 rounded-lg border border-[var(--border-sub)] bg-[var(--bg-primary)]">
          <ul className="divide-y divide-[var(--border-sub)]">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <FileText className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {f.filename}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                  {formatRelative(f.uploaded_at)}
                </span>
                <button
                  type="button"
                  onClick={() => void handleRemove(f.id, f.filename)}
                  aria-label={`Remover ${f.filename}`}
                  className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--error)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {uploading > 0 ? (
              <li className="flex items-center gap-3 px-3 py-2 text-xs text-[var(--text-secondary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent)]" />
                Subindo {uploading} arquivo{uploading > 1 ? "s" : ""}...
              </li>
            ) : null}
          </ul>
        </ScrollArea>
      )}
    </Subsection>
  );
}

// ── resumo ──────────────────────────────────────────────────────────────────

function SummarySubsection() {
  const [summary, setSummary] = useState<KnowledgeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    getKnowledgeSummary()
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: "Falha ao carregar resumo",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const fresh = await regenerateKnowledgeSummary();
      setSummary(fresh);
      toast({
        title: fresh ? "Resumo regenerado" : "Sem documentos pra resumir",
      });
    } catch (err) {
      toast({
        title: "Falha ao regenerar resumo",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <Subsection
      icon={<RefreshCw className="h-4 w-4" />}
      title="Resumo do contexto"
      description="Texto gerado a partir dos arquivos. Injetado no system prompt das conversas."
    >
      <textarea
        readOnly
        value={summary?.summary ?? ""}
        placeholder={
          loading
            ? "Carregando..."
            : "Nenhum resumo ainda — gere depois de subir alguns arquivos."
        }
        rows={8}
        className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--code-bg)] p-3 font-mono text-xs leading-relaxed text-[var(--code-text)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--text-tertiary)]">
          {summary
            ? `Gerado a partir de ${summary.source_count} documento${
                summary.source_count !== 1 ? "s" : ""
              } · ${formatRelative(summary.generated_at)}`
            : "Sem resumo"}
        </p>
        <Button
          variant="outline"
          onClick={handleRegenerate}
          disabled={loading || regenerating}
        >
          {regenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {regenerating ? "Regenerando..." : "Regenerar"}
        </Button>
      </div>
    </Subsection>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

interface SubsectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

function Subsection({ icon, title, description, children }: SubsectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-[var(--text-tertiary)]">{icon}</span>
          {title}
        </h4>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
        <span className="text-[var(--text-tertiary)]">{icon}</span>
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * Coarse "agora", "5 min", "2h", "3d" formatter — same precision the
 * conversations list uses. Avoids pulling in a date library for one use.
 */
function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const seconds = Math.max(0, (Date.now() - ts) / 1000);
  if (seconds < 60) return "agora";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
