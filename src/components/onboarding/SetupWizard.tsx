import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageSquare,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  callOpenAI,
  getConfig,
  saveConfig,
  type Config,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

/** 3-step first-run wizard; rendered fullscreen when getConfig().needs_setup. */
interface SetupWizardProps {
  initialConfig: Config;
  onComplete: () => void;
}

type Step = 1 | 2 | 3;

const TOTAL_STEPS = 3;

export function SetupWizard({ initialConfig, onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [apiKey, setApiKey] = useState(initialConfig.openai_api_key ?? "");
  const [apiKeyVerified, setApiKeyVerified] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)] p-6">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg animate-fade-in">
        <StepIndicator current={step} total={TOTAL_STEPS} />
        <div className="px-8 pb-8 pt-4">
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
          ) : (
            <DoneStep onFinish={onComplete} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── step indicator ──────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border)] px-8 py-4">
      {Array.from({ length: total }).map((_, i) => {
        const n = (i + 1) as Step;
        const active = n === current;
        const past = n < current;
        return (
          <div
            key={n}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              past || active
                ? "bg-[var(--accent)]"
                : "bg-[var(--bg-tertiary)]",
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
          Orquestrador desktop de skills — automatiza tarefas
          repetitivas via Claude Code, bash e APIs, coordenado por GPT-4o.
        </p>
      </div>
      <p className="text-xs text-[var(--text-tertiary)]">
        Configurar a OpenAI key leva menos de um minuto.
      </p>
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

// ── step 3: done ────────────────────────────────────────────────────────────

function DoneStep({ onFinish }: { onFinish: () => void }) {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--success-soft)]">
        <CheckCircle2 className="h-8 w-8 text-[var(--success)]" />
      </div>
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Tudo pronto</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--text-secondary)]">
          Configuração salva. Digite{" "}
          <code className="rounded bg-[var(--code-bg)] px-1 font-mono text-xs">
            /skill-name
          </code>{" "}
          no chat pra ativar skills, ou descreva o que quer fazer — o
          assistente checa as ferramentas necessárias e pede permissão antes
          de instalar qualquer coisa.
        </p>
      </div>
      <Button onClick={onFinish} size="lg" className="w-full">
        <MessageSquare className="h-4 w-4" />
        Ir para o Chat
      </Button>
    </div>
  );
}

// ── public helper: one-shot config read for App bootstrap ───────────────────

export async function loadBootstrapConfig(): Promise<Config> {
  return getConfig();
}
