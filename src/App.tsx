import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { ChatIndexRedirect } from "@/components/chat/ChatIndexRedirect";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { MainLayout } from "@/components/layout/MainLayout";
import { SetupWizard } from "@/components/onboarding/SetupWizard";
import { NewProjectForm } from "@/components/projects/NewProjectForm";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { FatalErrorDialog } from "@/components/ui/fatal-error-dialog";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/useToast";
import { getConfig } from "@/lib/tauri-bridge";
import { useAppStore } from "@/stores/appStore";
import type { Config } from "@/types/config";

function App() {
  const [bootstrap, setBootstrap] = useState<Config | null>(null);
  const [showWizard, setShowWizard] = useState<boolean | null>(null);
  const hydrateAppState = useAppStore((s) => s.hydrateFromBackend);
  const { toast } = useToast();

  // Pull persisted UI state (active project, active model) from app_state
  // once the backend pool is up. Idempotent — internal flag guards re-runs.
  useEffect(() => {
    void hydrateAppState();
  }, [hydrateAppState]);

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
          db_path: "",
          needs_setup: true,
        });
        setShowWizard(true);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  if (bootstrap === null || showWizard === null) {
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
