"use client";

import { Compass, Sparkles, Building2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { CostBadge } from "@/components/cost/cost-badge";
import type { ExploreMode } from "@/lib/explore";

// Cost honesty at the point of choice: free ATS Scan (scan-ats-full), token-
// spending Portals WebSearch (search_queries), and token-spending AI search.
// Direct job_boards (board-browser / RSS) are NOT on this toggle — they run
// from Pipeline → Portal scan (zero tokens).
export function ExploreModeToggle({
  mode,
  onChange,
  cliConfigured,
}: {
  mode: ExploreMode;
  onChange: (m: ExploreMode) => void;
  cliConfigured: boolean;
}) {
  return (
    <div className="flex w-full rounded-xl border border-border bg-surface/40 p-1 sm:inline-flex sm:w-auto">
      <button
        type="button"
        onClick={() => onChange("scan")}
        aria-pressed={mode === "scan"}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition-colors sm:flex-none sm:gap-2 sm:px-3 max-sm:min-h-[44px]",
          mode === "scan" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground",
        )}
      >
        <Compass className="size-4" />
        <span className="font-medium">Scan</span>
        <span className="hidden sm:inline-flex">
          <CostBadge kind="free-network" size="xs" />
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange("portals")}
        aria-pressed={mode === "portals"}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition-colors sm:flex-none sm:gap-2 sm:px-3 max-sm:min-h-[44px]",
          mode === "portals" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground",
        )}
      >
        <Building2 className="size-4" />
        <span className="font-medium">Portals</span>
        <span className="hidden sm:inline-flex">
          <CostBadge kind="spend" size="xs" />
        </span>
        {!cliConfigured && <span className="text-[10px] text-faint">needs a CLI</span>}
      </button>
      <button
        type="button"
        onClick={() => onChange("ai")}
        aria-pressed={mode === "ai"}
        className={cn(
          "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm transition-colors sm:flex-none sm:gap-2 sm:px-3 max-sm:min-h-[44px]",
          mode === "ai" ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground",
        )}
      >
        <Sparkles className="size-4" />
        <span className="font-medium">AI search</span>
        <span className="hidden sm:inline-flex">
          <CostBadge kind="spend" size="xs" />
        </span>
        {!cliConfigured && <span className="text-[10px] text-faint">needs a CLI</span>}
      </button>
    </div>
  );
}
