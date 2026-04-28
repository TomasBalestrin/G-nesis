import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { ChatIndexRedirect } from "@/components/chat/ChatIndexRedirect";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { MainLayout } from "@/components/layout/MainLayout";
import { OnboardingPage } from "@/components/onboarding/OnboardingPage";
import { SetupWizard } from "@/components/onboarding/SetupWizard";
import { NewProjectForm } from "@/components/projects/NewProjectForm";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { WorkflowEditor } from "@/components/workflows/WorkflowEditor";
import { WorkflowList } from "@/components/workflows/WorkflowList";
import { WorkflowViewer } from "@/components/workflows/WorkflowViewer";
import { FatalErrorDialog } from "@/components/ui/fatal-error-dialog";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/useToast";
import { getAppStateValue, getConfig, setAppStateValue } from "@/lib/tauri-bridge";
import { useAppStore } from "@/stores/appStore";
import type { Config } from "@/types/config";

const ONBOARDING_FLAG_KEY = "onboarding_complete";

function App() {
  const [bootstrap, setBootstrap] = useState<Config | null>(null);
  const [showWizard, setShowWizard] = useState<boolean | null>(null);
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
        setShowWizard(cfg.needs_setup);
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
        setShowWizard(true);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  if (bootstrap === null || showWizard === null || onboardingDone === null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-[var(--text-secondary)]">
        Carregando...
      </div>
    );
  }

  if (showWizard) {
    return (
      <>
        <SetupWizard
          initialConfig={bootstrap}
          onComplete={() => setShowWizard(false)}
        />
        <Toaster />
        <FatalErrorDialog />
      </>
    );
  }

  if (!onboardingDone) {
    return (
      <>
        <OnboardingPage onComplete={completeOnboarding} />
        <Toaster />
        <FatalErrorDialog />
      </>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          {/* Landing — redirects to last/new conversation. */}
          <Route index element={<ChatIndexRedirect />} />

          {/* Multi-thread chat. */}
          <Route path="chat/:conversationId" element={<ChatPanel />} />

          {/* Skills: list in sidebar; no standalone /skills listing page.
              Same editor handles create (/skills/new) and edit (/skills/:name). */}
          <Route path="skills/new" element={<SkillEditor />} />
          <Route path="skills/:name" element={<SkillEditor />} />

          {/* Workflows: full catalog page + viewer + editor. /:name shows
              the read-only structured view; /:name/edit opens the markdown
              editor for changes. */}
          <Route path="workflows" element={<WorkflowList />} />
          <Route path="workflows/new" element={<WorkflowEditor />} />
          <Route path="workflows/:name" element={<WorkflowViewer />} />
          <Route path="workflows/:name/edit" element={<WorkflowEditor />} />

          {/* Projects: list is inside Settings; these routes support
              creating and inspecting a single project. */}
          <Route path="projects/new" element={<NewProjectForm />} />
          <Route path="projects/:id" element={<ProjectDetail />} />

          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <Toaster />
      <FatalErrorDialog />
    </BrowserRouter>
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
