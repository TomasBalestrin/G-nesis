import { useEffect, useState } from "react";

const STORAGE_KEY = "genesis-theme";

export type Theme = "light" | "dark";

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  // Fall back to the class already on <html> (index.html seeds `dark`).
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // Tema padrão (sem atributo) já é Gold Dark via :root no design-system.css.
  // [data-theme="light"] sobrescreve para Gold Light. Removemos o atributo
  // ao voltar pra dark pra cair no fallback do :root.
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else {
    root.removeAttribute("data-theme");
  }
  // Mantém a classe .dark pra qualquer utilitário do tailwindcss-animate ou
  // selector legado que ainda assuma o esquema antigo.
  root.classList.toggle("dark", theme === "dark");
}

/**
 * App theme toggle (`light` / `dark`). Flips the `dark` class on the `<html>`
 * element — Tailwind `darkMode: ["class"]` and our `.dark` token overrides
 * key off that. Persists the choice in localStorage so reloads keep it.
 * Default is dark, set up by the `class="dark"` attribute in index.html.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme,
    isDark: theme === "dark",
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    setTheme,
  };
}
