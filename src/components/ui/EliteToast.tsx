import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import {
  dismissEliteToast,
  useEliteToast,
  type EliteToastVariant,
} from "@/hooks/useEliteToast";

import "./EliteToast.css";

export interface EliteToastProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "title"> {
  variant: EliteToastVariant;
  title: string;
  message?: string;
  /** Quando `true`, aplica a className `.toast-leaving` que dispara
   *  a animação de fade-out via CSS. Controlado pelo `<EliteToaster />`
   *  com base no flag `leaving` do queue interno. */
  leaving?: boolean;
  className?: string;
}

const VARIANT_CLASS: Record<EliteToastVariant, string> = {
  success: "toast-success",
  error: "toast-error",
  warning: "toast-warning",
};

/**
 * Toast — Elite Premium (DESIGN.md §12).
 *
 * Componente visual standalone (uma única notificação). O renderer
 * de fila (`<EliteToaster />`) é quem mantém múltiplas notificações
 * empilhadas e cuida do lifecycle de animação. Caller raro usa o
 * `<EliteToast />` direto — fluxo padrão é `eliteToast({...})`.
 */
export const EliteToast = forwardRef<HTMLDivElement, EliteToastProps>(
  function EliteToast(
    { variant, title, message, leaving, className, ...rest },
    ref,
  ) {
    const classes = [
      "toast",
      VARIANT_CLASS[variant],
      leaving ? "toast-leaving" : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div ref={ref} role="status" aria-live="polite" className={classes} {...rest}>
        <span className="toast-bar" aria-hidden="true" />
        <div className="toast-content">
          <span className="toast-title">{title}</span>
          {message ? <span className="toast-message">{message}</span> : null}
        </div>
      </div>
    );
  },
);

/**
 * Container fixed bottom-right que renderiza todos os toasts da fila
 * Elite. Mount uma vez no root da aplicação ao lado do shadcn
 * `<Toaster />` (eles coexistem; cada um consome sua própria queue).
 *
 * Os toasts em fade-out continuam montados até o LEAVE_DURATION
 * passar — `useEliteToast` mantém eles no array com `leaving=true`
 * pra animação rodar limpa. Click no toast dispara dismiss imediato.
 */
export function EliteToaster() {
  const toasts = useEliteToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toaster" role="region" aria-label="Notificações">
      {toasts.map((t) => (
        <EliteToast
          key={t.id}
          variant={t.variant}
          title={t.title}
          message={t.message}
          leaving={t.leaving}
          onClick={() => dismissEliteToast(t.id)}
        />
      ))}
    </div>
  );
}
