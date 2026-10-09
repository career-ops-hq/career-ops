"use client";

import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <Button
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      type="button"
      onClick={toggleTheme}
      aria-label="Tema escuro"
      aria-pressed={dark}
      title={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      className={cn("text-muted", showLabel && "w-full justify-start px-2 text-xs", className)}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {showLabel && <span>Tema escuro</span>}
    </Button>
  );
}
