"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, ArrowUpDown, ChevronDown, Check, LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DiscoveredOffer } from "@/lib/explore";
import { CHINA_SOURCES } from "@/lib/employer-preset.mjs";
import {
  DEFAULT_SORT,
  FIT_BANDS,
  SORT_LABELS,
  applyResultsView,
  availableSortKeys,
  countBands,
  dirLabel,
  flipSortDir,
  normalizeSort,
  sortSummary,
  toggleBand,
  toggleSortKey,
  type FitBand,
  type SortSpec,
} from "@/lib/results-view.mjs";
import { CostBadge } from "@/components/cost/cost-badge";
import { DiscoveryCard } from "./discovery-card";
import { useExplore } from "./explore-provider";

export type EnrichedOffer = DiscoveredOffer & { inPipeline: boolean; evaluatedN?: string };

type Layout = "grid" | "list";

const segmented = "inline-flex rounded-lg border border-border bg-surface/40 p-0.5 text-xs";
const segmentOn = "bg-brand-soft text-brand-text";
const segmentOff = "text-muted hover:text-foreground";

export function ResultsList({ offers }: { offers: EnrichedOffer[] }) {
  const { companiesScanned, partial, error, addToPipeline, added, mode, running } = useExplore();
  const isAi = mode === "ai";
  const employer = offers.some(o => CHINA_SOURCES.includes(o.source));
  const [q, setQ] = useState("");
  const [sortSpec, setSortSpec] = useState<SortSpec[]>(() => [...DEFAULT_SORT]);
  const [hiddenBands, setHiddenBands] = useState<ReadonlySet<FitBand>>(() => new Set());
  const [layout, setLayout] = useState<Layout>("grid");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const sortTriggerRef = useRef<HTMLButtonElement>(null);

  // Fit bands are free title-vs-profile estimates on scan offers only; the fit
  // controls stay out of the way when nothing in this result set carries one.
  const bandCounts = useMemo(() => countBands(offers), [offers]);
  const hasFit = FIT_BANDS.some((b) => bandCounts[b] > 0);
  const sortKeys = useMemo(() => availableSortKeys(offers), [offers]);
  // A choice made earlier (e.g. Fit) falls back when a later run has nothing to apply it to.
  const sort = useMemo(() => normalizeSort(sortSpec, sortKeys), [sortSpec, sortKeys]);

  const view = useMemo(() => applyResultsView(offers, { query: q, hiddenBands, sort }), [offers, q, hiddenBands, sort]);

  // "Add all" acts on what is on screen, so a filter can't bulk-add rows the user can't see.
  const addable = view.filter((o) => !o.inPipeline && !o.evaluatedN && !added.has(o.url));

  useEffect(() => {
    if (!sortOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSortOpen(false);
      // Closing the menu from the keyboard puts focus back on the button that opened it.
      sortTriggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sortOpen]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-foreground">
            <span className="font-semibold">{offers.length}</span> {isAi ? `candidate${offers.length === 1 ? "" : "s"}` : employer ? `match${offers.length === 1 ? "" : "es"}` : `fresh role${offers.length === 1 ? "" : "s"}`}
            {view.length !== offers.length && <span className="text-faint"> · {view.length} shown</span>}
            <CostBadge kind={isAi ? "spend" : "free-network"} size="xs" className="ml-2 align-middle" />
          </p>
          <p className="text-[12px] text-faint">
            {isAi
              ? "found by AI on the open web · unverified until you evaluate"
              : employer ? "From selected employer sites · check the original JD · 0 tokens spent" : `${companiesScanned > 0 ? `${companiesScanned.toLocaleString()} companies scanned · ` : ""}0 tokens spent${partial ? " · some boards were unreachable (normal for public directories)" : ""}`}
          </p>
          {!isAi && error && <p className="text-[12px] text-amber-800 dark:text-amber-300">{error}</p>}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface/40 px-2.5 py-1.5">
            <Search className="size-3.5 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter results…"
              className="w-32 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
          </div>

          {hasFit && (
            <div role="group" aria-label="Filter by fit" className={segmented}>
              {FIT_BANDS.map((b) => {
                const on = !hiddenBands.has(b);
                return (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setHiddenBands((h) => toggleBand(h, b))}
                    title={on ? `Hide ${b}-fit results` : `Show ${b}-fit results`}
                    className={cn("rounded-md px-2.5 py-1 font-medium capitalize transition-colors", on ? segmentOn : cn(segmentOff, "text-faint line-through"))}
                  >
                    {b} <span className="tabular-nums text-faint">{bandCounts[b]}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div ref={sortRef} className="relative">
            <button
              ref={sortTriggerRef}
              type="button"
              aria-haspopup="true"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-soft hover:text-brand-text"
            >
              <ArrowUpDown className="size-3.5 text-faint" />
              Sort: {sortSummary(sort)}
              <ChevronDown className="size-3.5 text-faint" />
            </button>
            {sortOpen && (
              <div role="group" aria-label="Sort by" className="absolute right-0 top-full z-20 mt-1 w-72 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                <p className="px-2 pb-2 pt-1 text-[12px] leading-snug text-muted">Pick one or more. The order you pick is the priority. Use the chip to flip direction.</p>
                {sortKeys.map((key) => {
                  const idx = sort.findIndex((s) => s.key === key);
                  const on = idx >= 0;
                  const locked = on && sort.length === 1;
                  return (
                    <div key={key} className="flex items-center gap-2 px-1 py-0.5">
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-disabled={locked || undefined}
                        title={locked ? "At least one sort stays on" : undefined}
                        onClick={() => setSortSpec(toggleSortKey(sort, key))}
                        className="flex flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-surface-hover"
                      >
                        <span className={cn("grid size-4 shrink-0 place-items-center rounded border", on ? "border-brand bg-brand text-white" : "border-border")}>
                          {on && <Check className="size-3" strokeWidth={3} />}
                        </span>
                        {SORT_LABELS[key]}
                        {on && <span className="ml-1 text-xs font-semibold tabular-nums text-brand-text">{idx + 1}</span>}
                      </button>
                      {on && (
                        <button
                          type="button"
                          aria-label={`${SORT_LABELS[key]}: ${dirLabel(key, sort[idx].dir)}. Flip direction`}
                          onClick={() => setSortSpec(flipSortDir(sort, key))}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface/40 px-2 py-1 text-xs text-foreground transition-colors hover:bg-brand-soft hover:text-brand-text"
                        >
                          {dirLabel(key, sort[idx].dir)}
                          <ArrowUpDown className="size-3 text-faint" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div role="group" aria-label="View" className={segmented}>
            {(
              [
                { id: "grid", label: "Grid view", Icon: LayoutGrid },
                { id: "list", label: "List view", Icon: List },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={layout === id}
                title={label}
                onClick={() => setLayout(id)}
                className={cn("rounded-md px-2 py-1 transition-colors", layout === id ? segmentOn : segmentOff)}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>

          {addable.length > 1 && (
            <button
              type="button"
              onClick={() => addToPipeline(addable)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/40 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-soft hover:text-brand-text"
            >
              <Plus className="size-3.5" /> Add all {addable.length}
            </button>
          )}
        </div>
      </div>

      <div className={layout === "list" ? "flex flex-col gap-2" : "grid gap-3 sm:grid-cols-2 xl:grid-cols-3"}>
        {view.map((o) => (
          <DiscoveryCard key={o.url} offer={o} inPipeline={o.inPipeline} evaluatedN={o.evaluatedN} layout={layout === "list" ? "row" : "card"} />
        ))}
      </div>

      {view.length === 0 && (q.trim() || hiddenBands.size > 0 || !running) && (
        <p className="py-10 text-center text-sm text-faint">
          {q.trim() || hiddenBands.size === 0 ? `No results match “${q}”.` : "No results in the selected fit bands."}
        </p>
      )}
    </div>
  );
}
