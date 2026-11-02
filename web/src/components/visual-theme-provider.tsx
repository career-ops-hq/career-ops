"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_VISUAL_THEME, isVisualTheme, storedVisualTheme, VISUAL_STORAGE_KEY } from "@/lib/visual-theme.mjs";

type VisualTheme = "ocean" | "classic";
type VisualThemeContextValue = { visual: VisualTheme; setVisual: (theme: VisualTheme) => void };
const VisualThemeContext = createContext<VisualThemeContextValue | null>(null);

function applyVisual(theme: VisualTheme) {
  document.documentElement.dataset.visual = theme;
}

export function VisualThemeProvider({ children }: { children: React.ReactNode }) {
  const [visual, setVisualState] = useState<VisualTheme>(DEFAULT_VISUAL_THEME);

  useEffect(() => {
    const initial = storedVisualTheme(document.documentElement.dataset.visual);
    setVisualState(initial);
    applyVisual(initial);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== VISUAL_STORAGE_KEY) return;
      const next = storedVisualTheme(event.newValue);
      setVisualState(next);
      applyVisual(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setVisual = useCallback((next: VisualTheme) => {
    if (!isVisualTheme(next)) return;
    setVisualState(next);
    applyVisual(next);
    try {
      window.localStorage.setItem(VISUAL_STORAGE_KEY, next);
    } catch {
      /* Storage-disabled environments still get the selected theme in this tab. */
    }
  }, []);
  const value = useMemo(() => ({ visual, setVisual }), [visual, setVisual]);
  return <VisualThemeContext.Provider value={value}>{children}</VisualThemeContext.Provider>;
}

export function useVisualTheme(): VisualThemeContextValue {
  const context = useContext(VisualThemeContext);
  if (!context) throw new Error("useVisualTheme must be used inside VisualThemeProvider");
  return context;
}
