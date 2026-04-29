import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router-dom";

import { CaminhoDetail } from "@/components/caminhos/CaminhoDetail";
import { CaminhoList } from "@/components/caminhos/CaminhoList";
import { NewCaminhoForm } from "@/components/caminhos/NewCaminhoForm";
import { ChatIndexRedirect } from "@/components/chat/ChatIndexRedirect";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { MainLayout } from "@/components/layout/MainLayout";
import { OnboardingPage } from "@/components/onboarding/OnboardingPage";
import { SettingsCaminhosSection } from "@/components/settings/SettingsCaminhosSection";
import { SettingsConfigSection } from "@/components/settings/SettingsConfigSection";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { SettingsSkillsSection } from "@/components/settings/SettingsSkillsSection";
import { SettingsWorkflowsSection } from "@/components/settings/SettingsWorkflowsSection";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { SkillViewerV2 } from "@/components/skills/SkillViewerV2";
import { WorkflowEditor } from "@/components/workflows/WorkflowEditor";
import { WorkflowList } from "@/components/workflows/WorkflowList";
import { WorkflowViewer } from "@/components/workflows/WorkflowViewer";
import { FatalErrorDialog } from "@/components/ui/fatal-error-dialog";
import { Toaster } from "@/components/ui/toaster";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import { useToast } from "@/hooks/useToast";
import {
  getAppStateValue,
  getConfig,
  listSkills,
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
                  /skills/new always lands on the v1 editor (new skills are
                  created in v1 format until E4 ships v2 authoring).
                  /skills/:name dispatches by version: v2 (folder layout)
                  -> SkillViewerV2 read-only viewer, v1 -> SkillEditor.
                  /skills/:name/edit always uses SkillEditor — v2 editing
                  is a follow-up task. */}
              <Route path="skills/new" element={<SkillEditor />} />
              <Route path="skills/:name" element={<SkillRouteDispatch />} />
              <Route path="skills/:name/edit" element={<SkillEditor />} />

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
                  <Outlet />. Index redirects to /settings/knowledge.
                  All 5 child routes currently render SettingsPage —
                  subsequent B-series tasks split it into per-section
                  pages so each NavLink lands on focused content. */}
              <Route path="settings" element={<SettingsLayout />}>
                <Route index element={<Navigate to="knowledge" replace />} />
                <Route path="knowledge" element={<SettingsPage />} />
                <Route path="skills" element={<SettingsSkillsSection />} />
                <Route path="caminhos" element={<SettingsCaminhosSection />} />
                <Route path="workflows" element={<SettingsWorkflowsSection />} />
                <Route path="config" element={<SettingsConfigSection />} />
              </Route>
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          <Toaster />
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

/** /skills/:name dispatcher: probes list_skills for the matching meta
 *  and renders SkillViewerV2 for v2 (`version` starts with "2"), or
 *  the v1 SkillEditor for everything else (including legacy 1.x and
 *  rows we couldn't resolve). Loading state shows a placeholder so
 *  the user doesn't see the wrong viewer flash before settling. */
function SkillRouteDispatch() {
  const { name = "" } = useParams<{ name: string }>();
  const [version, setVersion] = useState<string | null | "loading">("loading");

  useEffect(() => {
    if (!name) {
      setVersion(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const skills = await listSkills();
        if (cancelled) return;
        const found = skills.find((s) => s.name === name) ?? null;
        setVersion(found?.version ?? null);
      } catch {
        if (!cancelled) setVersion(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (version === "loading") {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
        Carregando skill...
      </div>
    );
  }
  if (typeof version === "string" && version.startsWith("2")) {
    return <SkillViewerV2 />;
  }
  // null (skill not found, list failed, or v1 row) → fall through to
  // the v1 editor; SkillEditor's own loader handles "not found" with
  // a friendly empty-state.
  return <SkillEditor />;
}
