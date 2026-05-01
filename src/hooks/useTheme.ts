import { useEffect, useState } from "react";

const STORAGE_KEY = "genesis-theme";

export type Theme = "light" | "dark";

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  // Fall back to the data-theme attr seeded by index.html (default
  // "dark" via inline script). Em SSR-like contexts onde o DOM
  // não está disponível, default ainda é dark.
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // tokens.css (B1) define `:root, [data-theme="dark"]` e
  // `[data-theme="light"]`. Sempre setamos o atributo explícito —
  // não removemos no dark — pra evitar drift entre o primeiro
  // render (com attr seeded em index.html) e estados subsequentes.
  root.setAttribute("data-theme", theme);
  // Mantém a class .dark pro Tailwind dark mode utilities seguirem
  // funcionando enquanto a migração pro Elite Premium acontece.
  root.classList.toggle("dark", theme === "dark");
}

/**
 * App theme toggle (`light` / `dark`). Aplica `data-theme` no
 * `<html>` — tokens.css (B1) lê esse atributo pra trocar todos os
 * tokens semânticos atomicamente. Persiste em `localStorage` —
 * reloads herdam a escolha. Index.html roda um inline script antes
 * de hydrate pra prevenir flash do tema padrão dark quando a
 * preferência salva é light.
 *
 * Storage strategy: localStorage (sync, single-process). Tauri tem
 * SQLite via IPC mas adicionar async aqui geraria flash potencial
 * antes do tema persistido carregar — local first pra UI snappy.
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
