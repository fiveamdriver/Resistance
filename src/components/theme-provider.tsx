"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "resistance-theme";
const DEFAULT_THEME: Theme = "dark";

/**
 * Runs before hydration (see the inline <script> in layout.tsx) so the
 * correct theme paints on the first frame — without it the page would
 * flash light-then-dark (or vice versa) on every load.
 */
export const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem("${STORAGE_KEY}");
    document.documentElement.dataset.theme = t === "dark" ? "dark" : "${DEFAULT_THEME}";
  } catch (e) {
    document.documentElement.dataset.theme = "${DEFAULT_THEME}";
  }
})();
`;

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (t: Theme) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always starts at the same default the server rendered — anything read
  // from document/localStorage here would differ from the SSR output (which
  // can't know the real theme) and hand React a same-render hydration
  // mismatch. That mismatch is exactly what was wiping out the data-theme
  // attribute the blocking script had already set: React's recovery from an
  // *unsuppressed* mismatch elsewhere in the tree (DitheringBackground's
  // theme-conditional render) blew away the whole subtree, script-set DOM
  // attribute included, even though <html> itself had suppressHydrationWarning.
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  // Runs synchronously after hydration commits but before the browser
  // paints, so this correction (if the real theme differs from the default)
  // is invisible rather than a flash.
  useLayoutEffect(() => {
    const attr = document.documentElement.dataset.theme;
    const current: Theme = attr === "dark" || attr === "light" ? attr : DEFAULT_THEME;
    setThemeState(current);
  }, []);

  const setTheme = (next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / storage disabled — theme just won't persist.
    }
  };

  // Cross-tab / cross-window sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === "dark" || e.newValue === "light")) {
        setThemeState(e.newValue);
        document.documentElement.dataset.theme = e.newValue;
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
