import { BrowserRouter, Route, Routes } from "react-router-dom";

import { ChatPanel } from "@/components/chat/ChatPanel";
import { MainLayout } from "@/components/layout/MainLayout";
import { ProgressDashboard } from "@/components/progress/ProgressDashboard";
import { NewProjectForm } from "@/components/projects/NewProjectForm";
import { ProjectDetail } from "@/components/projects/ProjectDetail";
import { ProjectList } from "@/components/projects/ProjectList";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { SkillEditor } from "@/components/skills/SkillEditor";
import { SkillList } from "@/components/skills/SkillList";
import { SkillViewer } from "@/components/skills/SkillViewer";
import { Toaster } from "@/components/ui/toaster";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route index element={<ChatPanel />} />
          <Route path="skills" element={<SkillList />} />
          <Route path="skills/new" element={<SkillEditor />} />
          <Route path="skills/:name" element={<SkillViewer />} />
          <Route path="projects" element={<ProjectList />} />
          <Route path="projects/new" element={<NewProjectForm />} />
          <Route path="projects/:id" element={<ProjectDetail />} />
          <Route path="progress" element={<ProgressDashboard />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;

interface PagePlaceholderProps {
  title: string;
  hint?: string;
}

function PagePlaceholder({ title, hint }: PagePlaceholderProps) {
  return (
    <div className="h-full p-8 space-y-2">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      {hint ? <p className="text-sm text-[var(--text-2)]">{hint}</p> : null}
    </div>
  );
}

function NotFoundPage() {
  return <PagePlaceholder title="404" hint="Rota não encontrada" />;
}
