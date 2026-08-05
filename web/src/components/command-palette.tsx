"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Command, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { searchNavItems } from "@/lib/nav-items";

const OPEN_EVENT = "career-ops:open-command-palette";

export function openCommandPalette() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function CommandPaletteLauncher({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      aria-label="Sök och navigera"
      className={cn(
        "flex items-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-foreground",
        compact ? "min-h-11 min-w-11 justify-center p-2" : "w-full gap-2.5 px-3 py-2 text-sm",
      )}
    >
      <Search className="size-4" />
      {!compact && (
        <>
          <span>Sök i Career-Ops</span>
          <span className="ml-auto inline-flex items-center gap-0.5 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-faint">
            <Command className="size-2.5" />K
          </span>
        </>
      )}
    </button>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const results = searchNavItems(query);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "?" && !typing) {
        event.preventDefault();
        setOpen(true);
        setQuery("hjälp");
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/55 px-4 pt-[12vh] backdrop-blur-sm" role="presentation" onMouseDown={() => setOpen(false)}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Sök i Career-Ops"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-5 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && results[0]) navigate(results[0].href);
            }}
            placeholder="Sök funktion, uppgift eller fråga…"
            aria-label="Sök funktion"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-faint"
          />
          <kbd className="rounded border border-border bg-background px-2 py-1 text-[10px] text-faint">ESC</kbd>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-2">
          {results.length ? results.map(({ href, label, description, icon: Icon, chip }) => (
            <button
              key={href}
              type="button"
              onClick={() => navigate(href)}
              className="group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted group-hover:text-brand-text">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  {label}
                  {chip && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-text">{chip}</span>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">{description}</span>
              </span>
              <ArrowRight className="size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )) : (
            <div className="px-4 py-10 text-center">
              <p className="font-medium text-foreground">Ingen funktion hittades</p>
              <p className="mt-1 text-sm text-muted">Prova exempelvis “CV”, “ansökan”, “statistik” eller “hjälp”.</p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border bg-background/50 px-4 py-2.5 text-[11px] text-faint">
          <span>↵ öppna · ↑↓ bläddra · esc stäng</span>
          <span>All data stannar lokalt</span>
        </footer>
      </section>
    </div>
  );
}
