// Elite Premium toast hook — module-scoped queue + React subscription
// bridge. Componentes chamam `eliteToast({...})` imperativamente; o
// `<EliteToaster />` consome a fila via `useEliteToast()` pra
// renderizar.
//
// Convivência com shadcn `useToast`: ambos coexistem; eliteToast é
// pra surfaces visuais já migradas pro Elite Premium. Migração
// gradual.

import { useEffect, useState } from "react";

export type EliteToastVariant = "success" | "error" | "warning";

export interface EliteToast {
  id: string;
  variant: EliteToastVariant;
  title: string;
  message?: string;
}

interface InternalToast extends EliteToast {
  /** Sinaliza fade-out animation; o item permanece na fila por
   *  `LEAVE_DURATION` ms antes do REMOVE final pra dar tempo da
   *  animação rodar sem flash. */
  leaving?: boolean;
}

const ENTER_DURATION_MS = 4500;
const LEAVE_DURATION_MS = 150;

type Listener = (toasts: InternalToast[]) => void;

let memoryToasts: InternalToast[] = [];
const listeners: Set<Listener> = new Set();
const dismissTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
const removeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

function setState(next: InternalToast[]) {
  memoryToasts = next;
  for (const listener of listeners) {
    listener(memoryToasts);
  }
}

function generateId(): string {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function scheduleDismiss(id: string) {
  if (dismissTimers.has(id)) return;
  const t = setTimeout(() => {
    dismissTimers.delete(id);
    dismissEliteToast(id);
  }, ENTER_DURATION_MS);
  dismissTimers.set(id, t);
}

function scheduleRemove(id: string) {
  if (removeTimers.has(id)) return;
  const t = setTimeout(() => {
    removeTimers.delete(id);
    setState(memoryToasts.filter((toast) => toast.id !== id));
  }, LEAVE_DURATION_MS);
  removeTimers.set(id, t);
}

/**
 * Empilha um toast novo na fila. Retorna o id pra dismissal manual
 * via `dismissEliteToast(id)`. Auto-dismiss em 4.5s (ENTER_DURATION).
 */
export function eliteToast(input: Omit<EliteToast, "id"> & { id?: string }): string {
  const id = input.id ?? generateId();
  const next: InternalToast = {
    id,
    variant: input.variant,
    title: input.title,
    message: input.message,
  };
  setState([...memoryToasts.filter((t) => t.id !== id), next]);
  scheduleDismiss(id);
  return id;
}

/**
 * Marca um toast como "saindo" e remove da fila após o fade-out.
 * Idempotente: chamar duas vezes no mesmo id é noop. Limpa o auto-
 * dismiss timer pra evitar dispatch duplicado.
 */
export function dismissEliteToast(id: string) {
  const target = memoryToasts.find((t) => t.id === id);
  if (!target || target.leaving) return;

  const dismissTimer = dismissTimers.get(id);
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimers.delete(id);
  }

  setState(memoryToasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
  scheduleRemove(id);
}

/**
 * Hook que subscribe ao queue. `<EliteToaster />` é o consumer
 * principal. Retorna a lista atual de toasts (incluindo os em
 * fade-out) — o consumer aplica a className apropriada baseado no
 * `leaving` flag.
 */
export function useEliteToast(): InternalToast[] {
  const [toasts, setToasts] = useState<InternalToast[]>(memoryToasts);

  useEffect(() => {
    listeners.add(setToasts);
    setToasts(memoryToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  return toasts;
}
