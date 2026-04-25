import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  FolderGit2,
  FolderOpen,
  KeyRound,
  Plus,
  Save,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTauriCommand } from "@/hooks/useTauriCommand";
import { useToast } from "@/hooks/useToast";
import {
  callOpenAI,
  getConfig,
  listProjects,
  saveConfig,
} from "@/lib/tauri-bridge";
import type { Config } from "@/types/config";
import type { Project } from "@/types/project";

/**
 * Onboarding + runtime configuration.
 *
 * If the page is opened with `needs_setup=true` (no API key saved), a
 * successful save redirects to `/` (chat) per ux-flows.md §4. When opened
 * manually from the sidebar, save/test just show toasts and stay on page.
 *
 * "Testar" persists first, then calls `callOpenAI` — our backend helper
 * reads the key from disk, so saving is a prerequisite. A bad key can be
 * overwritten by the next save without any cleanup.
 */
export function SettingsPage() {
  const [apiKey, setApiKey] = useState("");
  const [skillsDir, setSkillsDir] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [initialNeedsSetup, setInitialNeedsSetup] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setApiKey(cfg.openai_api_key ?? "");
        setSkillsDir(cfg.skills_dir);
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
    })();
  }, [toast]);

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
      toast({
        title: "Cole a API key antes de testar",
        variant: "destructive",
      });
      return;
    }
    setTesting(true);
    const saved = await persist();
    if (!saved) {
      setTesting(false);
      return;
    }
    try {
      const reply = await callOpenAI({
        prompt: "Responda apenas com a palavra OK.",
      });
      if (reply.trim().length === 0) {
        toast({
          title: "Resposta vazia da OpenAI",
          variant: "destructive",
        });
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
      if (typeof selected === "string") {
        setSkillsDir(selected);
      }
    } catch (err) {
      toast({
        title: "Falha ao abrir seletor de pasta",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
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
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-sm text-[var(--text-2)]">
          API key, diretório de skills e outras preferências.
        </p>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 p-6">
          {initialNeedsSetup ? <SetupBanner /> : null}

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
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
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

          <ProjectsSection />
        </div>
      </div>
    </div>
  );
}

function ProjectsSection() {
  const { data, loading, execute } = useTauriCommand(listProjects);

  useEffect(() => {
    execute();
  }, [execute]);

  return (
    <Section
      icon={<FolderGit2 className="h-4 w-4" />}
      title="Projetos"
      description="Repositórios locais onde as skills executam. Use Novo Projeto para cadastrar um repo."
    >
      <div className="space-y-2">
        <div className="flex justify-end">
          <Button asChild size="sm">
            <Link to="/projects/new">
              <Plus className="h-4 w-4" />
              Novo Projeto
            </Link>
          </Button>
        </div>
        {loading && !data ? (
          <p className="text-xs text-[var(--text-2)]">Carregando...</p>
        ) : data && data.length === 0 ? (
          <p className="rounded-lg border border-[var(--border-sub)] bg-[var(--bg-subtle)] px-3 py-4 text-center text-xs text-[var(--text-2)]">
            Nenhum projeto cadastrado.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-sub)] overflow-hidden rounded-lg border border-border bg-card">
            {(data ?? []).map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

interface ProjectRowProps {
  project: Project;
}

function ProjectRow({ project }: ProjectRowProps) {
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-subtle)]"
      >
        <FolderGit2 className="h-4 w-4 shrink-0 text-[var(--text-3)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{project.name}</div>
          <div className="truncate font-mono text-xs text-[var(--text-2)]">
            {project.repo_path}
          </div>
        </div>
      </Link>
    </li>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}

function Section({ icon, title, description, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <span className="text-[var(--text-3)]">{icon}</span>
          {title}
        </h3>
        <p className="mt-1 text-xs text-[var(--text-2)]">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SetupBanner() {
  return (
    <div className="rounded-xl border border-[var(--primary-bd)] bg-[var(--primary-bg)] p-4 text-sm text-[var(--primary-tx)]">
      <p className="font-semibold">Configuração inicial</p>
      <p className="mt-1 text-[var(--text)]">
        Cole sua OpenAI API key, teste e salve. Você será levado pro chat em
        seguida.
      </p>
    </div>
  );
}
