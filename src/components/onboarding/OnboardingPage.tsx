import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
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
  regenerateKnowledgeSummary,
  setAppStateValue,
  uploadKnowledgeFile,
} from "@/lib/tauri-bridge";
import type { KnowledgeFileMeta, KnowledgeSummary } from "@/types/knowledge";

interface OnboardingPageProps {
  /**
   * Persisted by App.tsx after the call resolves. App also sets the
   * `onboarding_complete` flag in app_state, so this component shouldn't
   * write that key directly — just signal completion.
   */
  onComplete: () => Promise<void> | void;
}

type Step = 1 | 2 | 3;
const TOTAL_STEPS = 3;

const USER_NAME_KEY = "user_name";
const COMPANY_NAME_KEY = "company_name";

/**
 * 3-step first-run wizard:
 *   1. Quem é você?      — name + company → app_state
 *   2. Documentos        — drag/drop .md, immediate upload to backend
 *   3. Resumo            — regenerateKnowledgeSummary, review, finish
 *
 * Step 2 → 3 is conditional: clicking "Pular" jumps straight to onComplete
 * (no documents = no summary to review). Step 2 → "Continuar" enters step 3
 * which gracefully handles an empty corpus (`summary === null`).
 *
 * Layout: fullscreen overlay (`fixed inset-0`), max-w-xl card, fade-in.
 * All colors via design system tokens — switches automatically with the
 * `data-theme` attribute set by `useTheme`.
 */
export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [files, setFiles] = useState<KnowledgeFileMeta[]>([]);
  const [finishing, setFinishing] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)] p-4 sm:p-6">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg animate-fade-in">
        <StepIndicator current={step} total={TOTAL_STEPS} />
        <div className="px-6 pb-8 pt-4 sm:px-10">
          {step === 1 ? (
            <PersonStep
              name={name}
              company={company}
              onNameChange={setName}
              onCompanyChange={setCompany}
              onNext={() => setStep(2)}
            />
          ) : step === 2 ? (
            <DocumentsStep
              files={files}
              onFilesChange={setFiles}
              onContinue={() => setStep(3)}
              onSkip={async () => {
                if (finishing) return;
                setFinishing(true);
                await onComplete();
                setFinishing(false);
              }}
              skipping={finishing}
            />
          ) : (
            <SummaryStep
              hasFiles={files.length > 0}
              finishing={finishing}
              onFinish={async () => {
                if (finishing) return;
                setFinishing(true);
                await onComplete();
                setFinishing(false);
              }}
              onBack={() => setStep(2)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] px-6 py-4 sm:px-10">
      {Array.from({ length: total }).map((_, i) => {
        const n = (i + 1) as Step;
        const reached = n <= current;
        return (
          <div
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              reached ? "bg-[var(--accent)]" : "bg-[var(--bg-tertiary)]",
            )}
          />
        );
      })}
      <span className="ml-2 font-mono text-xs text-[var(--text-tertiary)]">
        {current}/{total}
      </span>
    </div>
  );
}

// ── step 1: person ──────────────────────────────────────────────────────────

interface PersonStepProps {
  name: string;
  company: string;
  onNameChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
  onNext: () => void;
}

function PersonStep({
  name,
  company,
  onNameChange,
  onCompanyChange,
  onNext,
}: PersonStepProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  async function handleNext() {
    const n = name.trim();
    const c = company.trim();
    if (!n || !c) return;
    setSaving(true);
    try {
      await Promise.all([
        setAppStateValue({ key: USER_NAME_KEY, value: n }),
        setAppStateValue({ key: COMPANY_NAME_KEY, value: c }),
      ]);
      onNext();
    } catch (err) {
      toast({
        title: "Falha ao salvar suas informações",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const valid = name.trim().length > 0 && company.trim().length > 0;

  return (
    <div className="space-y-6">
      <header className="space-y-3 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
          <Sparkles className="h-7 w-7 text-[var(--accent)]" />
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Quem é você?</h1>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-secondary)]">
            O assistente usa essas informações pra personalizar respostas e
            sugestões.
          </p>
        </div>
      </header>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !saving) void handleNext();
        }}
      >
        <Field label="Nome" icon={<User className="h-4 w-4" />}>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Maria Silva"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Empresa" icon={<Building2 className="h-4 w-4" />}>
          <Input
            value={company}
            onChange={(e) => onCompanyChange(e.target.value)}
            placeholder="Acme Inc."
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <Button
          type="submit"
          size="lg"
          className="mt-2 w-full"
          disabled={!valid || saving}
        >
          {saving ? "Salvando..." : "Continuar"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>
    </div>
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

// ── step 2: documents ───────────────────────────────────────────────────────

interface DocumentsStepProps {
  files: KnowledgeFileMeta[];
  onFilesChange: (files: KnowledgeFileMeta[]) => void;
  onContinue: () => void;
  onSkip: () => void | Promise<void>;
  skipping: boolean;
}

function DocumentsStep({
  files,
  onFilesChange,
  onContinue,
  onSkip,
  skipping,
}: DocumentsStepProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

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
    const newlyUploaded: KnowledgeFileMeta[] = [];
    for (const file of arr) {
      try {
        const content = await file.text();
        const meta = await uploadKnowledgeFile({
          filename: file.name,
          content,
        });
        newlyUploaded.push(meta);
      } catch (err) {
        toast({
          title: `Falha ao subir ${file.name}`,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    }
    onFilesChange([...newlyUploaded, ...files]);
    setUploading((n) => Math.max(0, n - arr.length));
  }

  async function handleRemove(id: string, filename: string) {
    try {
      await deleteKnowledgeFile({ id });
      onFilesChange(files.filter((f) => f.id !== id));
    } catch (err) {
      toast({
        title: `Falha ao remover ${filename}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-3 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
          <FileText className="h-7 w-7 text-[var(--accent)]" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Conte sua rotina
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-secondary)]">
            Solte arquivos <span className="font-mono">.md</span> sobre seu
            cargo, processos e ferramentas. O assistente lê e gera um resumo
            que vira contexto pras conversas.
          </p>
        </div>
      </header>

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
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--border)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)]",
        )}
      >
        <Upload className="h-6 w-6 text-[var(--text-tertiary)]" />
        <p className="text-sm text-[var(--text-secondary)]">
          {dragging
            ? "Solte aqui pra adicionar"
            : "Arraste arquivos .md ou clique pra selecionar"}
        </p>
        <p className="text-[11px] text-[var(--text-tertiary)]">
          Vários arquivos OK · só extensão .md
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

      {files.length > 0 || uploading > 0 ? (
        <ScrollArea className="max-h-48 rounded-xl border border-[var(--border-sub)] bg-[var(--bg-primary)]">
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
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button
          variant="ghost"
          onClick={() => void onSkip()}
          disabled={uploading > 0 || skipping}
        >
          Pular
        </Button>
        <Button onClick={onContinue} disabled={uploading > 0 || skipping}>
          Continuar
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── step 3: summary ─────────────────────────────────────────────────────────

interface SummaryStepProps {
  hasFiles: boolean;
  finishing: boolean;
  onFinish: () => void | Promise<void>;
  onBack: () => void;
}

function SummaryStep({ hasFiles, finishing, onFinish, onBack }: SummaryStepProps) {
  const [summary, setSummary] = useState<KnowledgeSummary | null>(null);
  const [loading, setLoading] = useState(hasFiles);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!hasFiles) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    regenerateKnowledgeSummary()
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          toast({
            title: "Falha ao gerar resumo",
            description: message,
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
  }, [hasFiles, toast]);

  return (
    <div className="space-y-5">
      <header className="space-y-3 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--success-soft)]">
          <CheckCircle2 className="h-7 w-7 text-[var(--success)]" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">
            Resumo do seu contexto
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-secondary)]">
            Esse texto vai pro system prompt em toda conversa. Você pode
            regenerar a qualquer momento depois.
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-[var(--border-sub)] bg-[var(--bg-primary)] p-4">
        {!hasFiles ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Você pulou a etapa anterior — nenhum documento foi processado.
            Você pode adicionar mais tarde via Settings ou pelo chat.
          </p>
        ) : loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--accent)]" />
            Gerando resumo via GPT...
          </div>
        ) : error ? (
          <div className="text-sm text-[var(--error)]">
            <strong className="font-semibold">Falha:</strong> {error}
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              Você ainda pode concluir — gera o resumo depois pelo Settings.
            </p>
          </div>
        ) : summary ? (
          <ScrollArea className="max-h-64">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
              {summary.summary}
            </p>
            <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
              Baseado em {summary.source_count} documento
              {summary.source_count !== 1 ? "s" : ""}
            </p>
          </ScrollArea>
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">
            Resumo vazio — tente regenerar pelo Settings.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="ghost" onClick={onBack} disabled={finishing || loading}>
          Voltar
        </Button>
        <Button onClick={() => void onFinish()} disabled={finishing || loading}>
          {finishing ? "Concluindo..." : "Tudo certo!"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
