"use client";

import { Search, X } from "lucide-react";
import type { AtsSource } from "@/lib/explore";
import { ATS_LABEL } from "@/lib/explore";
import { FRESHNESS_WINDOWS, SENIORITY_LABEL, type Seniority } from "@/lib/inbox";
import { CostBadge } from "@/components/cost/cost-badge";
import { cn } from "@/lib/cn";

// Free, client-side facets over the raw firehose — 0 tokens, instant. Mirrors the
// Explore chip language so the two surfaces read as one system. On mobile the chip
// row scrolls INSIDE its own container (never the page).
export function FacetChips({
  within,
  setWithin,
  sources,
  toggleSource,
  seniorities,
  toggleSeniority,
  locQ,
  setLocQ,
  kw,
  setKw,
  availSources,
  availSeniorities,
  resultCount,
  totalCount,
  anyActive,
  onClear,
}: {
  within: number | null;
  setWithin: (d: number | null) => void;
  sources: Set<AtsSource>;
  toggleSource: (s: AtsSource) => void;
  seniorities: Set<Seniority>;
  toggleSeniority: (s: Seniority) => void;
  locQ: string;
  setLocQ: (v: string) => void;
  kw: string;
  setKw: (v: string) => void;
  availSources: AtsSource[];
  availSeniorities: Seniority[];
  resultCount: number;
  totalCount: number;
  anyActive: boolean;
  onClear: () => void;
}) {
  return (
    <div className="space-y-2.5">
      {/* keyword search + live count */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="Filter by company or role…"
            className="w-full rounded-lg border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40 max-sm:min-h-[44px]"
          />
        </div>
        <span className="shrink-0 text-xs text-muted">
          <span className="tabular-nums text-foreground">{resultCount}</span>
          <span className="text-faint">/{totalCount}</span>
        </span>
      </div>

      {/* chip row — desktop wraps, mobile scrolls inside the container */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {/* freshness (single-select segmented; click active to clear) */}
        <div className="inline-flex shrink-0 rounded-lg border border-border bg-surface/40 p-0.5">
          {FRESHNESS_WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setWithin(within === w.days ? null : w.days)}
              className={cn(
                "rounded-md px-2.5 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                within === w.days ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground",
              )}
            >
              {w.label}
            </button>
          ))}
        </div>

        {availSources.map((s) => (
          <Pill key={s} on={sources.has(s)} onClick={() => toggleSource(s)}>
            {ATS_LABEL[s]}
          </Pill>
        ))}

        {availSeniorities.map((s) => (
          <Pill key={s} on={seniorities.has(s)} onClick={() => toggleSeniority(s)}>
            {SENIORITY_LABEL[s]}
          </Pill>
        ))}

        {/* location contains */}
        <input
          value={locQ}
          onChange={(e) => setLocQ(e.target.value)}
          placeholder="location…"
          className="w-28 shrink-0 rounded-full border border-border bg-surface/40 px-3 text-xs outline-none transition-colors placeholder:text-faint focus:border-brand/40 max-sm:min-h-[44px] py-1"
        />

        {anyActive && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 text-xs text-faint transition-colors hover:text-foreground max-sm:min-h-[44px]"
          >
            <X className="size-3" /> Clear
          </button>
        )}
      </div>

      {/* Token-honesty is bidirectional: the "free" reassurance is as always-visible
          as the tray's "spend" cue (mobile + desktop) — never desktop-only. */}
      <div className="flex items-center gap-1.5">
        <CostBadge kind="free" size="xs" />
        <span className="text-[11px] text-faint">Filtering is free — only scoring uses tokens.</span>
      </div>
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-2.5 text-xs font-medium transition-colors max-sm:min-h-[44px]",
        on ? "border-brand/40 bg-brand-soft text-brand" : "border-border text-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
