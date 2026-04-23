import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearFatalError, useFatalError } from "@/hooks/useFatalError";

/**
 * Global blocking dialog for unrecoverable errors. Mounted once in App.tsx;
 * any code path can pop it via `reportFatalError(title, description)`.
 *
 * Reload button is offered as the fallback — for a Tauri app, full reload
 * re-runs setup() (config + DB init), which clears most transient broken
 * states.
 */
export function FatalErrorDialog() {
  const error = useFatalError();
  return (
    <Dialog
      open={error !== null}
      onOpenChange={(open) => {
        if (!open) clearFatalError();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[var(--status-error)]" />
            {error?.title ?? "Erro fatal"}
          </DialogTitle>
          <DialogDescription className="whitespace-pre-wrap">
            {error?.description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={clearFatalError}>
            Fechar
          </Button>
          <Button onClick={() => window.location.reload()}>
            Recarregar app
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
