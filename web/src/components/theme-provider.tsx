"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isTheme, storedTheme, THEME_COLORS, THEME_STORAGE_KEY } from "@/lib/theme.mjs";

export type Theme = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  window.dispatchEvent(new Event("themechange"));
}

function savedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The inline bootstrap script establishes the correct class before React
  // hydrates. Starting from the class-derived value prevents an icon flash.
  const [theme, setThemeState] = useState<Theme>(currentTheme);

  useEffect(() => {
    const initial = currentTheme();
    setThemeState(initial);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemTheme = () => {
      // A stored choice wins over later OS changes. With no stored choice, keep
      // the bootstrap behavior live when the system preference changes.
      if (savedTheme()) return;
      const next = media.matches ? "dark" : "light";
      setThemeState(next);
      applyTheme(next);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = storedTheme(event.newValue, media.matches ? "dark" : "light");
      setThemeState(next);
      applyTheme(next);
    };

    media.addEventListener("change", onSystemTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Private browsing/storage-disabled environments remain usable. */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [setTheme, theme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

