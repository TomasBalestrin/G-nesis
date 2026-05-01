import "./ProgressBar.css";

export interface ProgressBarProps {
  /** Valor 0-100. Caller é responsável por normalizar (clamp em
   *  100, evitar NaN). Component clampa defensivamente também. */
  value: number;
  /** Texto à esquerda do row de label (ex: "Etapa 3 de 5"). Quando
   *  ausente o row inteiro some — só track + fill. */
  label?: React.ReactNode;
  /** Override do percentage à direita. Default `${value}%`. Útil
   *  pra mostrar valores tipo "320 / 500" sem perder o track. */
  percentageLabel?: React.ReactNode;
  className?: string;
  /** A11y label do role="progressbar". Default usa o `label` ou
   *  "Progresso" como fallback. */
  ariaLabel?: string;
}

/**
 * ProgressBar — Elite Premium (DESIGN.md §11).
 *
 * Track 4px gold flat. Label opcional (texto + percentage). Fill
 * usa transição em var(--motion-normal) pra animação suave quando
 * o caller atualiza `value` step-by-step.
 *
 * `role="progressbar"` + aria-valuenow/min/max pra leitores de
 * tela. Sem barra de fundo gradiente — design proíbe.
 */
export function ProgressBar({
  value,
  label,
  percentageLabel,
  className,
  ariaLabel,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const classes = ["pr", className].filter(Boolean).join(" ");
  const accessibleLabel =
    ariaLabel ??
    (typeof label === "string" ? label : undefined) ??
    "Progresso";

  return (
    <div className={classes}>
      {label !== undefined ? (
        <div className="pr-lb">
          <span>{label}</span>
          <span>{percentageLabel ?? `${Math.round(clamped)}%`}</span>
        </div>
      ) : null}
      <div
        className="pr-tr"
        role="progressbar"
        aria-label={accessibleLabel}
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="pr-fi" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
