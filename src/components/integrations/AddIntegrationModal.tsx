import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Save,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import { addIntegration, testIntegration } from "@/lib/tauri-bridge";
import type { IntegrationAuthType } from "@/lib/tauri-bridge";
import { cn } from "@/lib/utils";

type AuthKind = "bearer" | "header" | "query";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

interface AddIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save so the parent can refresh the list. */
  onSuccess: () => void;
}

/**
 * Form modal pra cadastrar uma integration. Persiste via
 * `addIntegration` (TOML + spec file + SQLite) — `Testar conexão`
 * salva primeiro e depois roda o smoke test do backend, porque o
 * `testIntegration(name)` precisa do row já existir. Se o teste
 * falhar, a row continua cadastrada — o usuário decide remover ou
 * ajustar via card list.
 */
export function AddIntegrationModal({
  open,
  onOpenChange,
  onSuccess,
}: AddIntegrationModalProps) {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [authKind, setAuthKind] = useState<AuthKind>("bearer");
  const [headerName, setHeaderName] = useState("");
  const [paramName, setParamName] = useState("");
  const [specContent, setSpecContent] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test">(null);
  const { toast } = useToast();

  // Reset on close so re-opening doesn't show stale draft from a
  // previous attempt. Doing it on close (not open) keeps the form
  // editable while the dialog is up.
  useEffect(() => {
    if (!open) {
      setName("");
      setDisplayName("");
      setBaseUrl("");
      setApiKey("");
      setShowKey(false);
      setAuthKind("bearer");
      setHeaderName("");
      setParamName("");
      setSpecContent("");
      setBusy(null);
    }
  }, [open]);

  const errors = useMemo(() => collectErrors({
    name,
    displayName,
    baseUrl,
    apiKey,
    authKind,
    headerName,
    paramName,
  }), [name, displayName, baseUrl, apiKey, authKind, headerName, paramName]);

  const canSubmit = errors.length === 0 && busy === null;
  const specWarning = specContent.trim().length === 0;

  function buildAuthType(): IntegrationAuthType {
    switch (authKind) {
      case "header":
        return { type: "header", header_name: headerName.trim() };
      case "query":
        return { type: "query", param_name: paramName.trim() };
      default:
        return { type: "bearer" };
    }
  }

  async function persist(): Promise<boolean> {
    try {
      await addIntegration({
        name: name.trim(),
        displayName: displayName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        authType: buildAuthType(),
        specContent: specContent.trim() ? specContent : undefined,
      });
      return true;
    } catch (err) {
      toast({
        title: "Falha ao salvar integração",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return false;
    }
  }

  async function handleSave() {
    setBusy("save");
    const ok = await persist();
    setBusy(null);
    if (!ok) return;
    toast({ title: `Integração ${displayName.trim()} criada` });
    onSuccess();
    onOpenChange(false);
  }

  async function handleTest() {
    setBusy("test");
    // Backend testIntegration exige row existir — saving first é o
    // único path possível sem novo IPC handler. Save+test atomicamente.
    const saved = await persist();
    if (!saved) {
      setBusy(null);
      return;
    }
    try {
      const result = await testIntegration({ name: name.trim() });
      toast({
        title: result.ok
          ? `${displayName.trim()} OK (${result.elapsed_ms} ms)`
          : `${displayName.trim()} falhou`,
        description: result.message,
        variant: result.ok ? "default" : "destructive",
      });
      // On success close the modal; on failure leave it open so the user
      // can adjust auth/url and re-test (note: re-save will fail with
      // "já existe" — the user has to remove the saved row from the card
      // list and re-add via this modal).
      if (result.ok) {
        onSuccess();
        onOpenChange(false);
      } else {
        // Row was already persisted — refresh parent so the user sees it.
        onSuccess();
      }
    } catch (err) {
      toast({
        title: "Erro de configuração",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      onSuccess();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Integração</DialogTitle>
          <DialogDescription>
            APIs REST acessadas via @{"<nome>"} no chat. A api_key fica
            só em <span className="font-mono">~/.genesis/config.toml</span> —
            nunca cruza o IPC depois de salva.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field
            label="Nome (slug)"
            hint="Lowercase, números e hífens. Vira o handle do @."
            error={fieldError(errors, "name")}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="github"
              className="font-mono"
              autoFocus
              disabled={busy !== null}
            />
          </Field>

          <Field
            label="Display Name"
            hint="Nome que aparece nos cards de Settings."
            error={fieldError(errors, "displayName")}
          >
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="GitHub"
              disabled={busy !== null}
            />
          </Field>

          <Field
            label="Base URL"
            hint="Inclua o protocolo. Ex: https://api.github.com"
            error={fieldError(errors, "baseUrl")}
          >
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.exemplo.com"
              className="font-mono"
              disabled={busy !== null}
            />
          </Field>

          <Field
            label="API Key"
            hint="Salva criptografada localmente em config.toml."
            error={fieldError(errors, "apiKey")}
          >
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ghp_xxx ou xoxb-xxx"
                className="pr-10 font-mono"
                autoComplete="off"
                spellCheck={false}
                disabled={busy !== null}
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                aria-label={showKey ? "Ocultar key" : "Mostrar key"}
                className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-[var(--text-3)] hover:text-foreground focus-visible:outline-none"
                disabled={busy !== null}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </Field>

          <Field
            label="Auth type"
            hint="Como a API key é injetada em cada request."
          >
            <select
              value={authKind}
              onChange={(e) => setAuthKind(e.target.value as AuthKind)}
              disabled={busy !== null}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="bearer">
                Bearer — Authorization: Bearer &lt;key&gt;
              </option>
              <option value="header">
                Header — &lt;header-name&gt;: &lt;key&gt;
              </option>
              <option value="query">
                Query — ?&lt;param&gt;=&lt;key&gt;
              </option>
            </select>
          </Field>

          {authKind === "header" ? (
            <Field
              label="Nome do header"
              hint="Ex: X-Api-Key, Authorization."
              error={fieldError(errors, "headerName")}
            >
              <Input
                value={headerName}
                onChange={(e) => setHeaderName(e.target.value)}
                placeholder="X-Api-Key"
                className="font-mono"
                disabled={busy !== null}
              />
            </Field>
          ) : null}

          {authKind === "query" ? (
            <Field
              label="Nome do query param"
              hint="Vira ?<param>=<key> em todas as chamadas."
              error={fieldError(errors, "paramName")}
            >
              <Input
                value={paramName}
                onChange={(e) => setParamName(e.target.value)}
                placeholder="api_key"
                className="font-mono"
                disabled={busy !== null}
              />
            </Field>
          ) : null}

          <Field
            label="Spec da API (opcional)"
            hint="Markdown que o GPT lê pra montar requests. Pode incluir endpoints, exemplos, regras de uso."
          >
            <textarea
              value={specContent}
              onChange={(e) => setSpecContent(e.target.value)}
              placeholder={"# GitHub API\n\n- GET /user — perfil autenticado\n- GET /repos/{owner}/{repo}/issues — issues\n..."}
              className="min-h-[120px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
              spellCheck={false}
              disabled={busy !== null}
            />
            {specWarning ? (
              <p className="mt-1 flex items-start gap-1.5 text-[11px] text-[var(--warning-tx,#b45309)]">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Sem spec o GPT só sabe o base_url — ele vai pedir endpoints
                específicos ao usuário. Considere adicionar pelo menos os
                endpoints principais.
              </p>
            ) : null}
          </Field>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy !== null}
          >
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={!canSubmit}
          >
            {busy === "test" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Zap className="h-4 w-4" />
            )}
            Testar conexão
          </Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {busy === "save" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FieldError {
  field:
    | "name"
    | "displayName"
    | "baseUrl"
    | "apiKey"
    | "headerName"
    | "paramName";
  message: string;
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-[11px] text-[var(--destructive)]">{error}</span>
      ) : hint ? (
        <span className={cn("text-[11px] text-[var(--text-3)]")}>{hint}</span>
      ) : null}
    </label>
  );
}

function fieldError(errors: FieldError[], field: FieldError["field"]): string | undefined {
  return errors.find((e) => e.field === field)?.message;
}

interface ValidationInput {
  name: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  authKind: AuthKind;
  headerName: string;
  paramName: string;
}

function collectErrors(input: ValidationInput): FieldError[] {
  const out: FieldError[] = [];
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    out.push({ field: "name", message: "Obrigatório." });
  } else if (!SLUG_REGEX.test(trimmedName)) {
    out.push({
      field: "name",
      message: "Use só letras minúsculas, números e hífens.",
    });
  }
  if (!input.displayName.trim()) {
    out.push({ field: "displayName", message: "Obrigatório." });
  }
  const url = input.baseUrl.trim();
  if (!url) {
    out.push({ field: "baseUrl", message: "Obrigatório." });
  } else if (!url.startsWith("http://") && !url.startsWith("https://")) {
    out.push({
      field: "baseUrl",
      message: "Inclua o protocolo (https:// recomendado).",
    });
  }
  if (!input.apiKey.trim()) {
    out.push({ field: "apiKey", message: "Obrigatório." });
  }
  if (input.authKind === "header" && !input.headerName.trim()) {
    out.push({
      field: "headerName",
      message: "Auth `header` exige o nome do header.",
    });
  }
  if (input.authKind === "query" && !input.paramName.trim()) {
    out.push({
      field: "paramName",
      message: "Auth `query` exige o nome do param.",
    });
  }
  return out;
}
