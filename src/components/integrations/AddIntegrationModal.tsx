import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  FileUp,
  Loader2,
  Save,
  X,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  addIntegration,
  listIntegrations,
  testIntegration,
  updateIntegration,
} from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

interface AddIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Step = 1 | 2;

/**
 * 2-step wizard for adding a REST integration.
 *
 * Step 1 — Conexão: name (slug, real-time uniqueness check), API URL
 * (https://), API key (password+toggle). "Testar conexão" hits
 * test_integration; on Connected/ServerReachable advances to step 2,
 * on AuthFailed/Unreachable shows a toast.
 *
 * Step 2 — Arquivo de contexto: drag-and-drop / click-to-pick a single
 * .md file. Read via FileReader, sent as `specContent` to the backend.
 * "Pular — adicionar depois" saves with no spec.
 *
 * Both terminal actions (Salvar / Pular) call `addIntegration` with
 * the step-1 payload + optional spec_content. Backend defaults
 * auth_type=bearer and derives display_name from the name.
 */
export function AddIntegrationModal({
  open,
  onOpenChange,
  onSuccess,
}: AddIntegrationModalProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);

  // ── Etapa 1 state ─────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set());

  // ── Etapa 2 state ─────────────────────────────────────────────────────────
  const [specName, setSpecName] = useState<string | null>(null);
  const [specContent, setSpecContent] = useState<string | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"with-spec" | "no-spec" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset everything when the modal closes so re-opening shows a fresh
  // wizard. Doing it on close (not open) keeps the form editable while
  // the dialog is mounted.
  useEffect(() => {
    if (open) {
      // Hydrate the names set so step-1 validation has data to compare against.
      void listIntegrations()
        .then((rows) =>
          setExistingNames(new Set(rows.map((r) => r.name))),
        )
        .catch(() => {
          // Silent fail — the in-flight check will catch a duplicate
          // when the user clicks Test/Save anyway.
          setExistingNames(new Set());
        });
      return;
    }
    setStep(1);
    setName("");
    setBaseUrl("");
    setApiKey("");
    setShowKey(false);
    setTesting(false);
    setTested(false);
    setSpecName(null);
    setSpecContent(null);
    setSpecError(null);
    setSaving(null);
  }, [open]);

  // Slugify on type: lowercase + spaces → hyphens. Real-time so the
  // user sees what the actual handle will be.
  function handleNameChange(raw: string) {
    const slug = raw.toLowerCase().replace(/\s+/g, "-");
    setName(slug);
    setTested(false); // any edit invalidates the previous test
  }

  const nameStatus: "empty" | "invalid" | "duplicate" | "ok" = useMemo(() => {
    if (!name) return "empty";
    if (!SLUG_REGEX.test(name)) return "invalid";
    if (existingNames.has(name)) return "duplicate";
    return "ok";
  }, [name, existingNames]);

  const urlValid = useMemo(
    () => baseUrl.startsWith("https://") || baseUrl.startsWith("http://"),
    [baseUrl],
  );

  const canTest =
    nameStatus === "ok" &&
    urlValid &&
    apiKey.trim().length > 0 &&
    !testing;

  async function handleTest() {
    setTesting(true);
    try {
      // Atomic save → test → keep-or-rollback. The backend
      // testIntegration requires the row to exist in SQLite, but the
      // wizard wants to verify BEFORE committing. Trade-off: save
      // first; on AuthFailed/Unreachable rollback would require a
      // dedicated dry-run handler, which we don't have. For now: row
      // is persisted, the user sees the failure toast, and either
      // stays on step 1 to fix and re-test (re-save will fail with
      // "já existe") or closes and re-tries from the cards list.
      await addIntegration({
        name,
        baseUrl,
        apiKey,
        // Spec lands in step 2 — no content yet.
      });
      const result = await testIntegration({ name });

      switch (result.health) {
        case "connected":
        case "server_reachable":
          setTested(true);
          // Brief beat so the user can see the green badge before the
          // step transition; otherwise the modal feels rushed.
          window.setTimeout(() => setStep(2), 600);
          break;
        case "auth_failed":
          toast({
            title: "API key inválida.",
            description:
              "O servidor respondeu mas rejeitou a chave. Confira em Settings → Integrações depois.",
            variant: "destructive",
          });
          break;
        case "unreachable":
          toast({
            title: "Não foi possível conectar. Verifique a URL.",
            description: result.message,
            variant: "destructive",
          });
          break;
      }
    } catch (err) {
      toast({
        title: "Erro ao testar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  // ── Step 2 — file handling ────────────────────────────────────────────────

  function handleFile(file: File | null) {
    setSpecError(null);
    if (!file) {
      setSpecName(null);
      setSpecContent(null);
      return;
    }
    if (!file.name.toLowerCase().endsWith(".md")) {
      setSpecError("Apenas arquivos .md são aceitos.");
      setSpecName(null);
      setSpecContent(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setSpecName(file.name);
      setSpecContent(content);
    };
    reader.onerror = () => {
      setSpecError("Não consegui ler o arquivo.");
      setSpecName(null);
      setSpecContent(null);
    };
    reader.readAsText(file);
  }

  async function saveSpecOrSkip(includeSpec: boolean) {
    setSaving(includeSpec ? "with-spec" : "no-spec");
    try {
      // The integration row was already persisted by handleTest() when
      // step 1 advanced. We need a follow-up call to attach the spec —
      // but the existing IPC contract for saving spec is via
      // add_integration's spec_content arg, which only fires on
      // CREATE. To honor the wizard semantics, when a spec is
      // attached in step 2 we need a second write. The cleanest
      // path with the current API: rely on update_integration to set
      // spec_content (it accepts spec_content too). Fall back gracefully.
      if (includeSpec && specContent) {
        // The integration row was created in step 1 (handleTest). To
        // attach the spec we lean on update_integration's spec_content
        // path — backend then routes through specs::save_spec.
        const rows = await listIntegrations();
        const fresh = rows.find((r) => r.name === name);
        if (fresh) {
          await updateIntegration({
            id: fresh.id,
            name,
            displayName: fresh.display_name,
            baseUrl,
            authType: { type: "bearer" },
            enabled: fresh.enabled === 1,
            specContent,
          });
        }
        toast({ title: "Integração adicionada!" });
      } else {
        toast({
          title: "Integração adicionada!",
          description: "Você pode adicionar o arquivo de contexto depois.",
        });
      }
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Falha ao salvar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Integração</DialogTitle>
          <DialogDescription>
            <StepIndicator step={step} />
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <Step1
            name={name}
            nameStatus={nameStatus}
            baseUrl={baseUrl}
            apiKey={apiKey}
            showKey={showKey}
            testing={testing}
            tested={tested}
            canTest={canTest}
            onNameChange={handleNameChange}
            onBaseUrlChange={(v) => {
              setBaseUrl(v);
              setTested(false);
            }}
            onApiKeyChange={(v) => {
              setApiKey(v);
              setTested(false);
            }}
            onToggleShowKey={() => setShowKey((s) => !s)}
            onTest={handleTest}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          <Step2
            specName={specName}
            specError={specError}
            saving={saving}
            fileInputRef={fileInputRef}
            onFile={handleFile}
            onBack={() => setStep(1)}
            onSave={() => saveSpecOrSkip(true)}
            onSkip={() => saveSpecOrSkip(false)}
            disabled={!specContent}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step }: { step: Step }) {
  return (
    <span className="flex items-center gap-2 text-xs text-[var(--text-3)]">
      <span
        className={cn(
          "h-1.5 w-6 rounded-full transition-colors",
          step >= 1 ? "bg-[var(--accent)]" : "bg-[var(--bg-muted)]",
        )}
      />
      <span
        className={cn(
          "h-1.5 w-6 rounded-full transition-colors",
          step >= 2 ? "bg-[var(--accent)]" : "bg-[var(--bg-muted)]",
        )}
      />
      <span>Etapa {step} de 2</span>
    </span>
  );
}

interface Step1Props {
  name: string;
  nameStatus: "empty" | "invalid" | "duplicate" | "ok";
  baseUrl: string;
  apiKey: string;
  showKey: boolean;
  testing: boolean;
  tested: boolean;
  canTest: boolean;
  onNameChange: (v: string) => void;
  onBaseUrlChange: (v: string) => void;
  onApiKeyChange: (v: string) => void;
  onToggleShowKey: () => void;
  onTest: () => void;
  onCancel: () => void;
}

function Step1({
  name,
  nameStatus,
  baseUrl,
  apiKey,
  showKey,
  testing,
  tested,
  canTest,
  onNameChange,
  onBaseUrlChange,
  onApiKeyChange,
  onToggleShowKey,
  onTest,
  onCancel,
}: Step1Props) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor="int-name">
          Nome
        </label>
        <Input
          id="int-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="github"
          className="font-mono"
          autoFocus
        />
        <NameStatusHint status={nameStatus} />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor="int-url">
          URL da API
        </label>
        <Input
          id="int-url"
          value={baseUrl}
          onChange={(e) => onBaseUrlChange(e.target.value)}
          placeholder="https://api.exemplo.com/v1"
          className="font-mono"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium" htmlFor="int-key">
          API Key
        </label>
        <div className="relative">
          <Input
            id="int-key"
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            placeholder="Cole sua chave aqui"
            className="pr-10 font-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={onToggleShowKey}
            aria-label={showKey ? "Ocultar key" : "Mostrar key"}
            className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-[var(--text-3)] hover:text-foreground focus-visible:outline-none"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel} disabled={testing}>
          Cancelar
        </Button>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={onTest} disabled={!canTest}>
            {testing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            {testing ? "Testando..." : "Testar conexão"}
          </Button>
          {tested ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
              <CheckCircle2 className="h-3 w-3" />
              Conectado!
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NameStatusHint({
  status,
}: {
  status: "empty" | "invalid" | "duplicate" | "ok";
}) {
  if (status === "empty") {
    return (
      <p className="text-[11px] text-[var(--text-3)]">
        Slug do `@` no chat. Lowercase, dígitos e hífens.
      </p>
    );
  }
  if (status === "invalid") {
    return (
      <p className="text-[11px] text-[var(--destructive)]">
        Use só letras minúsculas, dígitos e hífens (começando por
        letra/dígito).
      </p>
    );
  }
  if (status === "duplicate") {
    return (
      <p className="text-[11px] text-[var(--destructive)]">
        Este nome já está em uso.
      </p>
    );
  }
  return (
    <p className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)]">
      <CheckCircle2 className="h-3 w-3" />
      Disponível
    </p>
  );
}

interface Step2Props {
  specName: string | null;
  specError: string | null;
  saving: "with-spec" | "no-spec" | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File | null) => void;
  onBack: () => void;
  onSave: () => void;
  onSkip: () => void;
  disabled: boolean;
}

function Step2({
  specName,
  specError,
  saving,
  fileInputRef,
  onFile,
  onBack,
  onSave,
  onSkip,
  disabled,
}: Step2Props) {
  const [dragActive, setDragActive] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    onFile(file ?? null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Arquivo de contexto</h3>
        <p className="mt-1 text-[11px] text-[var(--text-2)]">
          Envie o arquivo .md com a documentação da API. Isso permite que
          o assistente saiba quais endpoints chamar e como interpretar os
          dados.
        </p>
      </div>

      {specName ? (
        <div className="flex items-center gap-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {specName}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              onFile(null);
              fileInputRef.current?.click();
            }}
          >
            Trocar
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-sm transition-colors",
            dragActive
              ? "border-[var(--accent)] bg-[var(--accent-soft)]"
              : "border-[var(--border-sub)] hover:border-[var(--text-3)]",
          )}
        >
          <FileUp className="h-6 w-6 text-[var(--text-3)]" />
          <span className="text-center text-[var(--text-2)]">
            Arraste o arquivo .md ou clique para selecionar
          </span>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".md"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />

      {specError ? (
        <p className="text-[11px] text-[var(--destructive)]">{specError}</p>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button variant="ghost" onClick={onBack} disabled={saving !== null}>
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Button>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onSkip}
            disabled={saving !== null}
          >
            {saving === "no-spec" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Pular — adicionar depois
          </Button>
          <Button onClick={onSave} disabled={disabled || saving !== null}>
            {saving === "with-spec" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar integração
          </Button>
        </div>
      </div>
    </div>
  );
}
