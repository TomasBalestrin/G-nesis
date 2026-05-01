import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import "./Pill.css";

export interface PillProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  /** Quando true, aplica .pill-selected (bg gold-mute discreto). */
  selected?: boolean;
  className?: string;
}

/**
 * Pill — Elite Premium (DESIGN.md §11).
 *
 * Chip pílula clicável. Outline padrão; selected adiciona bg
 * gold-mute pra filter chips / tag selectors. Aceita ícones via
 * children (`<Pill><Icon />Texto</Pill>`); CSS força svg 14×14
 * stroke 1.5.
 *
 * forwardRef pra integração com Radix (Tooltip asChild etc).
 * type="button" default. selected → aria-pressed pra leitor de
 * tela diferenciar de toggle off/on.
 */
export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { selected, className, type = "button", children, ...rest },
  ref,
) {
  const classes = ["pill", selected ? "pill-selected" : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      aria-pressed={selected ? true : undefined}
      {...rest}
    >
      {children}
    </button>
  );
});
