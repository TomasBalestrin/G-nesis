import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/useTheme";

import "./ThemeToggle.css";

export interface ThemeToggleProps {
  className?: string;
}

/**
 * ThemeToggle — botão ghost compacto que alterna entre dark e light.
 * Os 2 ícones (sol + lua) ficam empilhados; o CSS troca opacity +
 * scale + rotate baseado no atributo `data-theme` do <html>.
 * Transição 180ms — perceptível, sem chamar atenção.
 *
 * Usa `useTheme` (B1+D3) que persiste a escolha em localStorage e
 * aplica o atributo `data-theme` que tokens.css consome.
 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { isDark, toggle } = useTheme();
  const classes = ["theme-toggle", className].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      onClick={toggle}
      className={classes}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
    >
      <Sun className="icon-sun" aria-hidden="true" />
      <Moon className="icon-moon" aria-hidden="true" />
    </button>
  );
}
