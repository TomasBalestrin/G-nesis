import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import "./EliteBadge.css";

export type BadgeVariant =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "premium";

export interface BadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "className"> {
  variant?: BadgeVariant;
  className?: string;
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  info: "badge-info",
  premium: "badge-premium",
};

/**
 * Badge — Elite Premium (DESIGN.md §09).
 *
 * Pílula translúcida + dot colorido antes do texto. 5 variantes
 * mapeadas pros tokens semânticos do design system (--ok, --wr,
 * --er, --in, --gd). Background usa o variant `-b` (mute 7-12%)
 * pra preservar contraste com surface escura sem fugir das
 * constraints "sem gradiente / sem glow".
 *
 * Renderiza `<span>` (inline). Pra usar em contexto inline-block
 * com altura fixa, basta adicionar Tailwind helpers via className.
 *
 * forwardRef pra integração com Radix (ex: Tooltip wrapper) sem
 * perder a ref.
 */
export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = "info", className, children, ...rest },
  ref,
) {
  const classes = ["badge", VARIANT_CLASS[variant], className]
    .filter(Boolean)
    .join(" ");

  return (
    <span ref={ref} className={classes} {...rest}>
      {children}
    </span>
  );
});
