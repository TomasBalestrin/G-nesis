import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

interface OnboardingPageProps {
  /**
   * Called after the user signals they're done with onboarding. Parent
   * persists the `onboarding_complete` flag in `app_state` and re-renders
   * with the main app shell.
   *
   * Receives a Promise so the placeholder can show a brief "Concluindo..."
   * state during the IPC roundtrip — avoids the user double-clicking and
   * triggering two writes.
   */
  onComplete: () => Promise<void> | void;
}

/**
 * First-run onboarding surface. Currently a single welcome screen — the
 * spec calls for a richer flow (knowledge upload, persona setup) that
 * later tasks will graft into this shell. The placeholder is mounted by
 * `App.tsx` when `app_state["onboarding_complete"]` is absent and gates
 * the app behind a single explicit completion click.
 *
 * Fullscreen layout (no sidebar/header) — kept minimal so future steps
 * can drop into the same container without fighting the chrome.
 */
export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [finishing, setFinishing] = useState(false);

  async function handleFinish() {
    if (finishing) return;
    setFinishing(true);
    try {
      await onComplete();
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-primary)] p-6">
      <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-10 text-center shadow-lg animate-fade-in">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--accent-soft)]">
          <Sparkles className="h-8 w-8 text-[var(--accent)]" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          Bem-vindo ao Genesis
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--text-secondary)]">
          Antes de começar, vamos configurar sua base de conhecimento pessoal —
          documentos sobre seu cargo, processos e ferramentas. O assistente
          usa esses arquivos pra entender seu contexto sem precisar perguntar
          toda vez.
        </p>
        <p className="mx-auto mt-3 max-w-sm text-xs text-[var(--text-tertiary)]">
          Esta é a tela inicial; passos seguintes do onboarding entram aqui
          em iterações futuras.
        </p>
        <Button
          onClick={handleFinish}
          size="lg"
          className="mt-8 w-full"
          disabled={finishing}
        >
          {finishing ? "Concluindo..." : "Começar"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
