"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { visibleNavItems } from "@/lib/nav-items";
import { paletteItems, rankPalette } from "@/lib/command-palette.mjs";
import { usePipeline } from "@/components/pipeline/pipeline-provider";

const LIMIT = 50;
const noSubscribe = () => () => {};

export function CommandPalette({ followupsEnabled }: { followupsEnabled: boolean }) {
  const router = useRouter();
  const { applications, loading } = usePipeline();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const [canPortal, setCanPortal] = useState(false);
  useEffect(() => setCanPortal(true), []);
  const shortcut = useSyncExternalStore(
    noSubscribe,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "",
  );

  const results = useMemo(
    () => rankPalette(paletteItems(visibleNavItems(followupsEnabled), applications), query, LIMIT),
    [followupsEnabled, applications, query],
  );
  const current = Math.min(active, results.length - 1);

  function open() {
    setQuery("");
    setActive(0);
    dialogRef.current?.showModal();
  }

  function choose(href: string) {
    dialogRef.current?.close();
    router.push(href);
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (dialogRef.current?.open) dialogRef.current.close();
      else open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, results]);

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[current].href);
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Search"
        aria-keyshortcuts="Control+K Meta+K"
        className="mb-4 flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <Search className="size-4" />
        Search
        {shortcut && (
          <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-faint">{shortcut}</kbd>
        )}
      </button>

      {canPortal && createPortal(
      <dialog
        ref={dialogRef}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="mx-auto mt-[12vh] w-[36rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-faint" />
          <input
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results.length ? optionId(current) : undefined}
            aria-label="Jump to a page or application"
            placeholder="Jump to a page, company, role or #number"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKeyDown}
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
        <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,24rem)] overflow-y-auto p-1.5">
          {results.map((item, index) => (
            <li
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(item.href)}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
                index === current ? "bg-brand-soft text-brand-text" : "text-foreground",
              )}
            >
              <span className="shrink-0">{item.label}</span>
              {item.detail && <span className="truncate text-xs text-muted">{item.detail}</span>}
              <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
                {item.tag}
              </span>
            </li>
          ))}
        </ul>
        {results.length === 0 && (
          <p className="px-4 pb-4 pt-1 text-sm text-muted">No page or application matches {`"${query.trim()}"`}</p>
        )}
        {loading && applications.length === 0 && <p className="px-4 pb-3 text-xs text-faint">Loading applications</p>}
      </dialog>,
      document.body,
      )}
    </>
  );
}
