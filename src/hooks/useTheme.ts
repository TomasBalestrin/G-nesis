import { useEffect, useState } from "react";

const STORAGE_KEY = "genesis-theme";
const DARK = "blue-dark";
const LIGHT = "blue-light";

export type Theme = typeof DARK | typeof LIGHT;

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return DARK;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === DARK || saved === LIGHT) return saved;
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === LIGHT ? LIGHT : DARK;
}

/**
 * App theme toggle. Flips `<html data-theme>` between `blue-dark` and
 * `blue-light` (design.css ships 4 themes but the toggle surfaces only the
 * dark/light axis — user picks color family via Settings if/when that lands).
 * State is persisted to localStorage so the reload keeps the choice.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme,
    isDark: theme === DARK,
    toggle: () => setTheme((t) => (t === DARK ? LIGHT : DARK)),
    setTheme,
  };
}
