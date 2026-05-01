import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

import "./EliteButton.css";

export type ButtonVariant =
  | "primary"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive";

export type ButtonSize = "default" | "small";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional extra classes appended after the variant/size mix. Useful
   *  when a caller needs a spacing helper (`mt-4`) without rebuilding
   *  the variant style. */
  className?: string;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  outline: "btn-outline",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  destructive: "btn-destructive",
};

/**
 * Elite Premium button — DESIGN.md §07.
 *
 * 5 variants × 2 sizes. `type="button"` por default pra evitar submit
 * acidental quando dropado dentro de um <form> sem prop explícita.
 * Forward de ref pra integração com Radix/shadcn primitives (Tooltip,
 * DropdownMenuTrigger asChild, etc).
 *
 * Estilos vivem em ./Button.css — não usa Tailwind utility classes
 * porque o design system pede um set fixo de receitas (cores via
 * tokens --gd/--er/etc, sem shadow/gradiente).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "default",
      type = "button",
      className,
      children,
      ...rest
    },
    ref,
  ) {
    const classes = [
      "btn",
      VARIANT_CLASS[variant],
      size === "small" ? "btn-sm" : null,
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <button ref={ref} type={type} className={classes} {...rest}>
        {children}
      </button>
    );
  },
);
