import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { reportFatalError } from "@/hooks/useFatalError";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Top-level catch-all for render/lifecycle exceptions. Without it, a single
 * thrown error inside a render (typically from a malformed Tauri event payload
 * reaching MessageBubble or useExecution) would unmount the entire React tree
 * and leave the user staring at a black screen — the historical
 * "skill execution crasha o app" pattern.
 *
 * On catch:
 *   1. Logs to console for dev/debug.
 *   2. Calls `reportFatalError(...)` so the global FatalErrorDialog can pop —
 *      that dialog must be mounted OUTSIDE this boundary by App.tsx,
 *      otherwise it would die together with the broken tree.
 *   3. Renders an inline fallback with a Recarregar button. Reload re-runs
 *      `setup()` (config + DB init + state hydration), which clears most
 *      transient broken states.
 *
 * Class component because Error Boundaries are still class-only on React 19.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message ?? "erro desconhecido",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Both surfaces — console for the dev tools, FatalErrorDialog for the
    // running app. The dialog only renders when something subscribed to
    // useFatalError mounts (FatalErrorDialog at the App root); when the
    // boundary itself owns the only render path, the inline fallback below
    // is what the user actually sees.
    console.error("[ErrorBoundary]", error, info.componentStack);
    reportFatalError(
      "Erro inesperado",
      `${error?.message ?? "erro desconhecido"}\n\n${info?.componentStack ?? ""}`,
    );
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[var(--bg-primary)] p-6 text-center">
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Algo deu errado
          </h1>
          <p className="max-w-md whitespace-pre-wrap text-sm text-[var(--text-secondary)]">
            {this.state.message}
          </p>
          <Button onClick={() => window.location.reload()}>Recarregar</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
