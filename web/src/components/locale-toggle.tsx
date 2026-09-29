"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/cn";
import { useLocale, useT } from "@/components/i18n-provider";
import { LOCALES, type Locale } from "@/lib/i18n";

const LABEL: Record<Locale, string> = { tr: "TR", en: "EN" };
const NAME: Record<Locale, string> = { tr: "Türkçe", en: "English" };

// Segmented TR | EN switch. Each option is announced by its own language name
// so a screen reader user can find their language without knowing the codes.
export function LocaleToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <div
      role="radiogroup"
      aria-label={t("Interface language")}
      className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted", className)}
    >
      <Languages className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{t("Language")}</span>
      <div className="flex overflow-hidden rounded-md border border-border">
        {LOCALES.map((value) => {
          const active = value === locale;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={NAME[value]}
              lang={value}
              onClick={() => !active && setLocale(value)}
              className={cn(
                "px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50",
                active ? "bg-brand-soft text-brand-text" : "text-faint hover:bg-surface-hover hover:text-foreground",
              )}
            >
              {LABEL[value]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
