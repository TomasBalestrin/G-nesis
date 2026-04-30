import { forwardRef } from "react";
import type { HTMLAttributes } from "react";

import "./EliteCard.css";

export interface CardProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "className"> {
  /** Quando `true`, troca a border-color pra gold e a cor do título
   *  pra gold via seletor descendente em CSS. Sem mudança no
   *  background — ressalta sem gritar. */
  highlight?: boolean;
  className?: string;
}

export interface CardTitleProps
  extends Omit<HTMLAttributes<HTMLHeadingElement>, "className"> {
  className?: string;
  /** Override do nível de heading (h1-h6). Default `h3` — Cards
   *  costumam viver dentro de seções com h1/h2 já estabelecidos. */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
}

export interface CardDescriptionProps
  extends Omit<HTMLAttributes<HTMLParagraphElement>, "className"> {
  className?: string;
}

const CardRoot = forwardRef<HTMLDivElement, CardProps>(function CardRoot(
  { highlight, className, children, ...rest },
  ref,
) {
  const classes = ["card", highlight ? "card-highlight" : null, className]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={classes} {...rest}>
      {children}
    </div>
  );
});

const CardTitle = forwardRef<HTMLHeadingElement, CardTitleProps>(
  function CardTitle({ as = "h3", className, children, ...rest }, ref) {
    const classes = ["card-title", className].filter(Boolean).join(" ");
    const Tag = as;
    return (
      <Tag ref={ref} className={classes} {...rest}>
        {children}
      </Tag>
    );
  },
);

const CardDescription = forwardRef<HTMLParagraphElement, CardDescriptionProps>(
  function CardDescription({ className, children, ...rest }, ref) {
    const classes = ["card-description", className].filter(Boolean).join(" ");
    return (
      <p ref={ref} className={classes} {...rest}>
        {children}
      </p>
    );
  },
);

/**
 * Card — Elite Premium (DESIGN.md §10).
 *
 * Surface 1 (`var(--sf)`) com borda sutil (`var(--ol2)`). Sem
 * box-shadow conforme constraint absoluta. Highlight=true troca
 * a border-color pra gold + faz CardTitle aninhado herdar a cor
 * via seletor descendente — sem React Context.
 *
 * Sub-componentes expostos via propriedades estáticas:
 *   <Card.Title>  → <h3.card-title> (Lora 15px bold)
 *   <Card.Description> → <p.card-description> (DM Sans 13px tx2)
 *
 * Uso típico:
 * ```tsx
 * <Card highlight>
 *   <Card.Title>Plano Elite</Card.Title>
 *   <Card.Description>Mentoria 1:1 com PerpetuoHQ.</Card.Description>
 *   <Button variant="primary">Quero ser Elite</Button>
 * </Card>
 * ```
 */
type CardComponent = typeof CardRoot & {
  Title: typeof CardTitle;
  Description: typeof CardDescription;
};

export const Card = CardRoot as CardComponent;
Card.Title = CardTitle;
Card.Description = CardDescription;
