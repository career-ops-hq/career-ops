"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const KEY = "career-ops:theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    // keep the browser chrome (Safari status bar / Dynamic Island) tinted to match
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next ? "#0a0a0a" : "#f7f6f3");
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    // let theme-reactive components (shaders) re-read
    window.dispatchEvent(new Event("themechange"));
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      className={cn("text-muted", className)}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
