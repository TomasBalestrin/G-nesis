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
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  // Keep the legacy `data-theme` attribute in sync so any remaining
  // selector from the old 4-theme file behaves gracefully until it's
  // fully migrated.
  root.setAttribute("data-theme", theme === "dark" ? "blue-dark" : "blue-light");
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
