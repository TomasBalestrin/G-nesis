import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Cable,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Terminal,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { IntegrationsSection } from "@/components/integrations/IntegrationsSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import {
  callOpenAI,
  checkDependency,
  getConfig,
  installDependency,
  saveConfig,
} from "@/lib/tauri-bridge";
import type { Config } from "@/types/config";

const DEPS = ["claude"] as const;
type DepName = (typeof DEPS)[number];

type DepStatus = "checking" | "installed" | "missing" | "installing";

/**
 * Settings → /settings/config. API key, skills dir e checagem das deps
 * externas (claude CLI). Não inclui ProjectsSection nem KnowledgeSection
 * — essas vivem nas próprias child routes da SettingsLayout.
 */
export function SettingsConfigSection() {
  const [apiKey, setApiKey] = useState("");
  const [skillsDir, setSkillsDir] = useState("");
  const [claudeCliPath, setClaudeCliPath] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [initialNeedsSetup, setInitialNeedsSetup] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deps, setDeps] = useState<Record<DepName, DepStatus>>({
    claude: "checking",
  });
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    void loadConfig();
    void refreshDeps();
  }, []);

  async function loadConfig() {
    try {
      const cfg = await getConfig();
      setApiKey(cfg.openai_api_key ?? "");
      setSkillsDir(cfg.skills_dir);
      setClaudeCliPath(cfg.claude_cli_path);
      setInitialNeedsSetup(cfg.needs_setup);
    } catch (err) {
      toast({
        title: "Falha ao carregar configurações",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoaded(true);
    }
  }

  async function refreshDeps() {
    setDeps((prev) => ({ ...prev, claude: "checking" }));
    const results = await Promise.all(
      DEPS.map(async (name) => {
        try {
          const ok = await checkDependency({ name });
          return [name, ok ? "installed" : "missing"] as const;
        } catch {
          return [name, "missing"] as const;
        }
      }),
    );
    setDeps(Object.fromEntries(results) as Record<DepName, DepStatus>);
  }

  async function persist(): Promise<Config | null> {
    try {
      return await saveConfig({
        openaiApiKey: apiKey.trim() ? apiKey.trim() : null,
        skillsDir: skillsDir.trim(),
      });
    } catch (err) {
      toast({
        title: "Falha ao salvar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
      return null;
    }
  }

  async function handleSave() {
    if (!skillsDir.trim()) {
      toast({ title: "skills_dir obrigatório", variant: "destructive" });
      return;
    }
    setSaving(true);
    const saved = await persist();
    setSaving(false);
    if (!saved) return;
    toast({ title: "Configurações salvas" });
    if (initialNeedsSetup && !saved.needs_setup) {
      navigate("/");
    } else {
      setInitialNeedsSetup(saved.needs_setup);
    }
  }

  async function handleTest() {
    if (!apiKey.trim()) {
      toast({ title: "Cole a API key antes de testar", variant: "destructive" });
      return;
    }
    setTesting(true);
    const saved = await persist();
    if (!saved) {
      setTesting(false);
      return;
    }
    try {
      const reply = await callOpenAI({ prompt: "Responda apenas com a palavra OK." });
      if (reply.trim().length === 0) {
        toast({ title: "Resposta vazia da OpenAI", variant: "destructive" });
      } else {
        toast({
          title: "API key válida",
          description: `Resposta: ${reply.trim().slice(0, 120)}`,
        });
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

  async function pickFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Selecione o diretório de skills",
      });
      if (typeof selected === "string") setSkillsDir(selected);
    } catch (err) {
      toast({
        title: "Falha ao abrir seletor de pasta",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  async function handleInstallDep(name: DepName) {
    setDeps((prev) => ({ ...prev, [name]: "installing" }));
    try {
      await installDependency({ name });
      toast({ title: `${name} instalado` });
    } catch (err) {
      toast({
        title: `Falha ao instalar ${name}`,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      void refreshDeps();
    }
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-2)]">
        Carregando configurações...
      </div>
    );
  }

  const saveDisabled = saving || testing || !skillsDir.trim();

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h2 className="text-2xl font-bold tracking-tight">Configurações</h2>
        <p className="text-sm text-[var(--text-2)]">
          API key, diretórios e dependências externas.
        </p>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 p-6">
          <Section
            icon={<KeyRound className="h-4 w-4" />}
            title="OpenAI API key"
            description="Usada pelo orquestrador GPT-4o. Nunca é enviada pra lugar algum além da OpenAI."
          >
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="pr-10 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? "Ocultar key" : "Mostrar key"}
                  className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-[var(--text-3)] hover:text-foreground focus-visible:outline-none"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleTest}
                disabled={saving || testing || !apiKey.trim()}
              >
                <CheckCircle2 className="h-4 w-4" />
                {testing ? "Testando..." : "Testar"}
              </Button>
            </div>
          </Section>

          <Section
            icon={<FolderOpen className="h-4 w-4" />}
            title="Diretório de skills"
            description="Onde o app procura arquivos .md de skill. Default: ~/.genesis/skills."
          >
            <div className="flex gap-2">
              <Input
                value={skillsDir}
                onChange={(e) => setSkillsDir(e.target.value)}
                placeholder="/home/usuario/.genesis/skills"
                className="font-mono"
              />
              <Button type="button" variant="outline" onClick={pickFolder}>
                <FolderOpen className="h-4 w-4" />
                Selecionar
              </Button>
            </div>
          </Section>

          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saveDisabled}>
              <Save className="h-4 w-4" />
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>

          <DepsSection
            deps={deps}
            claudeCliPath={claudeCliPath}
            onRefresh={() => void refreshDeps()}
            onInstall={handleInstallDep}
          />

          <hr className="border-[var(--border-sub)]" />

          <Section
            icon={<Cable className="h-4 w-4" />}
            title="Integrações"
            description="APIs REST que o chat acessa via @<nome>. A api_key fica só em ~/.genesis/config.toml — nunca cruza o IPC boundary."
          >
            <IntegrationsSection />
          </Section>
        </div>
      </div>
    </div>
  );
}

interface DepsSectionProps {
  deps: Record<DepName, DepStatus>;
  claudeCliPath: string | null;
  onRefresh: () => void;
  onInstall: (name: DepName) => void;
}

function DepsSection({
  deps,
  claudeCliPath,
  onRefresh,
  onInstall,
}: DepsSectionProps) {
  return (
    <Section
      icon={<Terminal className="h-4 w-4" />}
      title="Dependências externas"
      description="Binários que o Genesis chama. claude_cli_path vem de ~/.genesis/config.toml."
      action={
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          Verificar
        </Button>
      }
    >
      <ul className="divide-y divide-[var(--border-sub)] overflow-hidden rounded-lg border border-border bg-card">
        {DEPS.map((name) => (
          <DepRow
            key={name}
            name={name}
            status={deps[name]}
            path={name === "claude" ? claudeCliPath : null}
            onInstall={() => onInstall(name)}
          />
        ))}
      </ul>
    </Section>
  );
}

interface DepRowProps {
  name: DepName;
  status: DepStatus;
  path: string | null;
  onInstall: () => void;
}

function DepRow({ name, status, path, onInstall }: DepRowProps) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <DepStatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="font-mono">{name}</div>
        {path ? (
          <div className="truncate font-mono text-xs text-[var(--text-2)]">{path}</div>
        ) : null}
      </div>
      {status === "missing" ? (
        <Button type="button" size="sm" variant="outline" onClick={onInstall}>
          <Download className="h-3.5 w-3.5" />
          Instalar
        </Button>
      ) : null}
    </li>
  );
}

function DepStatusIcon({ status }: { status: DepStatus }) {
  if (status === "checking" || status === "installing") {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--text-3)]" />;
  }
  if (status === "installed") {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--accent)]" />;
  }
  return <XCircle className="h-4 w-4 shrink-0 text-[var(--destructive)]" />;
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ icon, title, description, action, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="text-[var(--text-3)]">{icon}</span>
            {title}
          </h3>
          <p className="mt-1 text-xs text-[var(--text-2)]">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
