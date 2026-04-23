import { useEffect, useState } from "react";

export interface FatalError {
  title: string;
  description: string;
}

// Module-scoped singleton — same pattern as useToast so it's callable from
// non-React code (e.g. safeInvoke) without prop-drilling a setter.
let listeners: Array<(error: FatalError | null) => void> = [];
let current: FatalError | null = null;

function emit(next: FatalError | null) {
  current = next;
  for (const l of listeners) l(next);
}

/**
 * Imperative setter — call from anywhere (try/catch, Tauri event handlers,
 * safeInvoke). The next render of `<FatalErrorDialog />` shows the modal.
 */
export function reportFatalError(title: string, description: string): void {
  emit({ title, description });
}

export function clearFatalError(): void {
  emit(null);
}

/** React subscription — used by `<FatalErrorDialog />`. */
export function useFatalError(): FatalError | null {
  const [error, setError] = useState<FatalError | null>(current);
  useEffect(() => {
    listeners.push(setError);
    return () => {
      listeners = listeners.filter((l) => l !== setError);
    };
  }, []);
  return error;
}
