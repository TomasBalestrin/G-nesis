import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { CaminhoDetail } from "@/components/caminhos/CaminhoDetail";
import { CaminhoList } from "@/components/caminhos/CaminhoList";
import { NewCaminhoForm } from "@/components/caminhos/NewCaminhoForm";
import { ChatIndexRedirect } from "@/components/chat/ChatIndexRedirect";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { MainLayout } from "@/components/layout/MainLayout";
import { OnboardingPage } from "@/components/onboarding/OnboardingPage";
import { KnowledgeSection } from "@/components/settings/KnowledgeSection";
import { SettingsCaminhosSection } from "@/components/settings/SettingsCaminhosSection";
import { SettingsConfigSection } from "@/components/settings/SettingsConfigSection";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { SettingsSkillsSection } from "@/components/settings/SettingsSkillsSection";
import { SettingsWorkflowsSection } from "@/components/settings/SettingsWorkflowsSection";
import { CreateSkillFlow } from "@/components/skills/CreateSkillFlow";
import { SkillDetailView } from "@/components/skills/SkillDetailView";
import { WorkflowEditor } from "@/components/workflows/WorkflowEditor";
import { WorkflowList } from "@/components/workflows/WorkflowList";
import { WorkflowViewer } from "@/components/workflows/WorkflowViewer";
import { FatalErrorDialog } from "@/components/ui/fatal-error-dialog";
import { EliteToaster } from "@/components/ui/EliteToast";
import { Toaster } from "@/components/ui/toaster";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { useTheme } from "@/hooks/useTheme";
import { useToast } from "@/hooks/useToast";
import {
  getAppStateValue,
  getConfig,
  setAppStateValue,
} from "@/lib/tauri-bridge";
import { useAppStore } from "@/stores/appStore";
import type { Config } from "@/types/config";

const ONBOARDING_FLAG_KEY = "onboarding_complete";

function App() {
  const [bootstrap, setBootstrap] = useState<Config | null>(null);
  // null while the flag is loading from app_state — keeps the UI in the
  // loading state instead of flashing the OnboardingPage, then the app.
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const hydrateAppState = useAppStore((s) => s.hydrateFromBackend);
  const { toast } = useToast();
  // Theme inicializado no nível root pra garantir sync entre o
  // inline-script seed do index.html e o estado do React. O hook é
  // idempotente — re-aplicar o tema atual via setAttribute não causa
  // flash. Persiste em localStorage e aplica data-theme no <html>.
  useTheme();

  // Pull persisted UI state (active project, active model) from app_state
  // once the backend pool is up. Idempotent — internal flag guards re-runs.
  useEffect(() => {
    void hydrateAppState();
  }, [hydrateAppState]);

  // Read the onboarding flag once on mount. Independent of the API key
  // wizard: a fresh install with a key already in env still needs the
  // welcome screen.
  useEffect(() => {
    let cancelled = false;
    getAppStateValue({ key: ONBOARDING_FLAG_KEY })
      .then((value) => {
        if (!cancelled) setOnboardingDone(value === "true");
      })
      .catch(() => {
        // Best-effort: assume not done so the user sees the welcome screen
        // and can complete onboarding. Worst case: they see it twice.
        if (!cancelled) setOnboardingDone(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function completeOnboarding() {
    try {
      await setAppStateValue({ key: ONBOARDING_FLAG_KEY, value: "true" });
    } catch (err) {
      // Persistence failed — surface a toast but still flip the local
      // state so the user isn't stuck on the welcome screen.
      toast({
        title: "Falha ao salvar progresso de onboarding",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
    setOnboardingDone(true);
  }

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((cfg) => {
        if (cancelled) return;
        setBootstrap(cfg);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          title: "Falha ao carregar configuração",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
        // Fall through to the main app so the user can still reach Settings.
        setBootstrap({
          openai_api_key: null,
          skills_dir: "",
          workflows_dir: "",
          db_path: "",
          claude_cli_path: null,
          needs_setup: true,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  if (bootstrap === null || onboardingDone === null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-[var(--text-secondary)]">
        Carregando...
      </div>
    );
  }

  // Single unified onboarding gate. The 5-step wizard handles welcome,
  // API key (saves on disk via saveConfig), perfil, documents and
  // summary in one flow — completeOnboarding flips the flag in
  // app_state which gates this branch off for subsequent runs.
  // FatalErrorDialog is intentionally mounted OUTSIDE every ErrorBoundary
  // below — when the boundary catches and the inner tree unmounts, the
  // dialog still needs a live React subtree to render its modal.
  if (!onboardingDone) {
    return (
      <>
        <ErrorBoundary>
          <OnboardingPage
            initialConfig={bootstrap}
            onComplete={completeOnboarding}
          />
          <Toaster />
          <EliteToaster />
        </ErrorBoundary>
        <FatalErrorDialog />
      </>
    );
  }

  return (
    <>
      <ErrorBoundary>
        <BrowserRouter>
          <Routes>
            <Route element={<MainLayout />}>
              {/* Landing — redirects to last/new conversation. */}
              <Route index element={<ChatIndexRedirect />} />

              {/* Multi-thread chat. */}
              <Route path="chat/:conversationId" element={<ChatPanel />} />

              {/* Skills: list in sidebar; no standalone /skills listing page.
                  /skills/new abre o CreateSkillFlow (Tela 1: nome →
                  Tela 2: chat com Skill Architect).
                  /skills/:name → SkillDetailView (visualização split com
                  árvore + preview). /skills/:name/edit → CreateSkillFlow
                  em modo edição (abre direto na etapa 2 com SKILL.md
                  hidratado). Skills v1 legacy NÃO têm mais editor — a
                  migração F1 converte tudo pra v2. */}
              <Route path="skills/new" element={<CreateSkillFlow />} />
              <Route path="skills/:name" element={<SkillDetailView />} />
              <Route path="skills/:name/edit" element={<CreateSkillFlow />} />

              {/* Capabilities: surface routes removidas em A2.
                  Backend continua expondo list_capabilities pro
                  autocomplete @ no chat e pra resolução de mention
                  dentro do system prompt — só a UI dedicada saiu. */}

              {/* Workflows: full catalog page + viewer + editor. /:name shows
                  the read-only structured view; /:name/edit opens the markdown
                  editor for changes. */}
              <Route path="workflows" element={<WorkflowList />} />
              <Route path="workflows/new" element={<WorkflowEditor />} />
              <Route path="workflows/:name" element={<WorkflowViewer />} />
              <Route path="workflows/:name/edit" element={<WorkflowEditor />} />

              {/* Caminhos: renamed projects surface. CaminhoList is the
                  full catalog; new + :id forms mirror the legacy project
                  routes. */}
              <Route path="caminhos" element={<CaminhoList />} />
              <Route path="caminhos/new" element={<NewCaminhoForm />} />
              <Route path="caminhos/:id" element={<CaminhoDetail />} />

              {/* Settings: SettingsLayout shell wraps a sub-sidebar +
                  <Outlet />. Index redirects to /settings/knowledge;
                  cada child route monta a section própria. */}
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="knowledge" replace />} />
                <Route path="knowledge" element={<KnowledgeRoute />} />
                <Route path="skills" element={<SettingsSkillsSection />} />
                <Route path="caminhos" element={<SettingsCaminhosSection />} />
                <Route path="workflows" element={<SettingsWorkflowsSection />} />
                <Route path="config" element={<SettingsConfigSection />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          <Toaster />
          <EliteToaster />
        </BrowserRouter>
      </ErrorBoundary>
      <FatalErrorDialog />
    </>
  );
}

export default App;

function NotFoundPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-xl font-bold">404</h2>
      <p className="text-sm text-[var(--text-secondary)]">Rota não encontrada.</p>
    </div>
  );
}

/** Wraps KnowledgeSection com header + scroll pra casar com o padrão
 *  das outras child routes da SettingsLayout (B2-B4). KnowledgeSection
 *  em si é só uma stack de subsections, sem cabeçalho próprio. */
function KnowledgeRoute() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h2 className="text-2xl font-bold tracking-tight">
          Base de conhecimento
        </h2>
        <p className="text-sm text-[var(--text-2)]">
          Perfil, documentos e o resumo que vai pro system prompt.
        </p>
      </header>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl p-6">
          <KnowledgeSection />
        </div>
      </div>
    </div>
  );
}

