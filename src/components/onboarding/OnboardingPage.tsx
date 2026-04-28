import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  Loader2,
  MessageSquare,
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
  callOpenAI,
  deleteKnowledgeFile,
  regenerateKnowledgeSummary,
  saveConfig,
  setAppStateValue,
  uploadKnowledgeFile,
} from "@/lib/tauri-bridge";
import type { Config } from "@/types/config";
import type { KnowledgeFileMeta, KnowledgeSummary } from "@/types/knowledge";

interface OnboardingPageProps {
  /** Bootstrap config read once by App. The wizard pre-fills the API
   *  key field with whatever's already on disk so users with the key
   *  in env or a stale config.toml don't retype, and uses
   *  `skills_dir` as the value to pass to `saveConfig` when
   *  persisting the verified key in step 2. */
  initialConfig: Config;
  /** Called only after the final step. Persists the
   *  `onboarding_complete` flag in app_state and flips the App's
   *  render gate. */
  onComplete: () => Promise<void> | void;
}

type Step = 1 | 2 | 3 | 4 | 5;
const TOTAL_STEPS = 5;

const USER_NAME_KEY = "user_name";
const COMPANY_NAME_KEY = "company_name";

/**
 * Unified 5-step first-run wizard:
 *   1. Welcome      — quick logo + intent
 *   2. API key      — paste + Test (saves verified key to config.toml)
 *   3. Perfil       — name + company → app_state
 *   4. Documents    — upload .md files (skippable)
 *   5. Resumo       — generated digest review + finish
 *
 * Replaces the old SetupWizard + OnboardingPage pair: users used to
 * see "3 done → 3 more" which felt broken. Now it's a single flow
 * with a 5-pill progress bar.
 *
 * Skipping step 4 jumps to step 5 — `SummaryStep` reads
 * `hasFiles={files.length > 0}` and gracefully degrades to a "Pronto!"
 * message when the corpus is empty.
 */
export function OnboardingPage({ initialConfig, onComplete }: OnboardingPageProps) {
  const [step, setStep] = useState<Step>(1);
  const [apiKey, setApiKey] = useState(initialConfig.openai_api_key ?? "");
  const [apiKeyVerified, setApiKeyVerified] = useState(false);
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
            <WelcomeStep onNext={() => setStep(2)} />
          ) : step === 2 ? (
            <ApiKeyStep
              apiKey={apiKey}
              onApiKeyChange={setApiKey}
              verified={apiKeyVerified}
              onVerifiedChange={setApiKeyVerified}
              skillsDir={initialConfig.skills_dir}
              onNext={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          ) : step === 3 ? (
            <PersonStep
              name={name}
              company={company}
              onNameChange={setName}
              onCompanyChange={setCompany}
              onNext={() => setStep(4)}
              onBack={() => setStep(2)}
            />
          ) : step === 4 ? (
            <DocumentsStep
              files={files}
              onFilesChange={setFiles}
              onContinue={() => setStep(5)}
              onSkip={() => setStep(5)}
              onBack={() => setStep(3)}
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
              onBack={() => setStep(4)}
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

// ── step 1: welcome ─────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
        <Sparkles className="h-8 w-8 text-[var(--accent)]" />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Bem-vindo ao Genesis
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--text-secondary)]">
          Vamos configurar em alguns passos rápidos.
        </p>
      </div>
      <Button onClick={onNext} size="lg" className="w-full">
        Começar
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ── step 2: api key ─────────────────────────────────────────────────────────

interface ApiKeyStepProps {
  apiKey: string;
  onApiKeyChange: (v: string) => void;
  verified: boolean;
  onVerifiedChange: (v: boolean) => void;
  skillsDir: string;
  onNext: () => void;
  onBack: () => void;
}

function ApiKeyStep({
  apiKey,
  onApiKeyChange,
  verified,
  onVerifiedChange,
  skillsDir,
  onNext,
  onBack,
}: ApiKeyStepProps) {
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const { toast } = useToast();

  async function handleTest() {
    const key = apiKey.trim();
    if (!key) {
      toast({
        title: "Cole a API key antes de testar",
        variant: "destructive",
      });
      return;
    }
    setTesting(true);
    try {
      // Persist first — callOpenAI reads the key from the config file.
      await saveConfig({ openaiApiKey: key, skillsDir });
      const reply = await callOpenAI({
        prompt: "Responda apenas com a palavra OK.",
      });
      if (reply.trim().length > 0) {
        onVerifiedChange(true);
        toast({
          title: "API key válida",
          description: reply.trim().slice(0, 120),
        });
      } else {
        toast({ title: "Resposta vazia da OpenAI", variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: "Falha ao testar API key",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)]">
          <KeyRound className="h-5 w-5 text-[var(--accent)]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">OpenAI API Key</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Usada pelo orquestrador GPT-4o. Fica em ~/.genesis/config.toml.
          </p>
        </div>
      </header>

      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={show ? "text" : "password"}
              value={apiKey}
              onChange={(e) => {
                onApiKeyChange(e.target.value);
                onVerifiedChange(false);
              }}
              placeholder="sk-..."
              className="pr-10 font-mono"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Ocultar" : "Mostrar"}
              className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={!apiKey.trim() || testing}
          >
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : verified ? (
              <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {testing ? "Testando..." : verified ? "Válida" : "Testar"}
          </Button>
        </div>
        {verified ? (
          <p className="flex items-center gap-1.5 text-xs text-[var(--success)]">
            <CheckCircle2 className="h-3 w-3" />
            Key verificada. Pode avançar.
          </p>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">
            Clique em Testar pra validar antes de avançar.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={onBack} disabled={testing}>
          Voltar
        </Button>
        <Button onClick={onNext} disabled={!verified}>
          Próximo
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ── step 3: person ──────────────────────────────────────────────────────────

interface PersonStepProps {
  name: string;
  company: string;
  onNameChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}

function PersonStep({
  name,
  company,
  onNameChange,
  onCompanyChange,
  onNext,
  onBack,
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

        <div className="flex items-center justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onBack}
            disabled={saving}
          >
            Voltar
          </Button>
          <Button type="submit" disabled={!valid || saving}>
            {saving ? "Salvando..." : "Continuar"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
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

// ── step 4: documents ───────────────────────────────────────────────────────

interface DocumentsStepProps {
  files: KnowledgeFileMeta[];
  onFilesChange: (files: KnowledgeFileMeta[]) => void;
  onContinue: () => void;
  /** Skip jumps straight to step 5; the summary step renders a "Pronto!"
   *  state when files is empty so onComplete still happens at the end. */
  onSkip: () => void;
  onBack: () => void;
}

function DocumentsStep({
  files,
  onFilesChange,
  onContinue,
  onSkip,
  onBack,
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
        <Button variant="ghost" onClick={onBack} disabled={uploading > 0}>
          Voltar
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onSkip} disabled={uploading > 0}>
            Pular
          </Button>
          <Button onClick={onContinue} disabled={uploading > 0}>
            Continuar
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── step 5: summary + finish ────────────────────────────────────────────────

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
            {hasFiles ? "Resumo do seu contexto" : "Tudo pronto"}
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--text-secondary)]">
            {hasFiles
              ? "Esse texto vai pro system prompt em toda conversa. Você pode regenerar a qualquer momento depois."
              : "Configuração salva. Você pode adicionar documentos a qualquer momento via Settings."}
          </p>
        </div>
      </header>

      {hasFiles ? (
        <div className="rounded-xl border border-[var(--border-sub)] bg-[var(--bg-primary)] p-4">
          {loading ? (
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
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <Button variant="ghost" onClick={onBack} disabled={finishing || loading}>
          Voltar
        </Button>
        <Button
          onClick={() => void onFinish()}
          disabled={finishing || loading}
          size="lg"
        >
          <MessageSquare className="h-4 w-4" />
          {finishing ? "Concluindo..." : "Começar"}
        </Button>
      </div>
    </div>
  );
}
