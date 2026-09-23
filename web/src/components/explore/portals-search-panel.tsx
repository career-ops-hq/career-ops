"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Radar } from "lucide-react";
import { CostBadge } from "@/components/cost/cost-badge";

type Summary = {
  queries: number;
  companies: number;
  jobBoards?: number;
  jobBoardSample?: string[];
  sample: string[];
};

// Portals tab = Level 3 WebSearch (search_queries + websearch companies).
// Direct job_boards (Instahyre, Wellfound, board-browser, RSS) are previewed
// here for discoverability but run via Pipeline → Portal scan (zero tokens).
export function PortalsSearchPanel({
  onSubmit,
  cliConfigured,
  cliName,
  onRunScan,
  label = "Run Portals search",
}: {
  onSubmit: () => void;
  cliConfigured: boolean;
  cliName?: string;
  onRunScan: () => void;
  label?: string;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/explore/portals")
      .then((r) => r.json())
      .then((d: Summary) => {
        if (!cancelled) setSummary(d);
      })
      .catch(() => {
        if (!cancelled) setSummary({ queries: 0, companies: 0, jobBoards: 0, jobBoardSample: [], sample: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const webSearchTotal = (summary?.queries ?? 0) + (summary?.companies ?? 0);
  const boardCount = summary?.jobBoards ?? 0;
  const noWebSearch = summary !== null && webSearchTotal === 0;

  return (
    <div className="space-y-3">
      {boardCount > 0 && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
            <Radar className="size-3.5" /> Direct scan boards ({boardCount})
          </div>
          <p className="text-sm text-muted">
            {summary!.jobBoardSample!.length
              ? `${summary!.jobBoardSample!.join(", ")}${boardCount > summary!.jobBoardSample!.length ? "…" : ""} — zero AI tokens (Playwright / RSS).`
              : `${boardCount} board${boardCount === 1 ? "" : "s"} in job_boards.`}
          </p>
          <Link
            href="/pipeline"
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700 transition hover:underline dark:text-emerald-300"
          >
            Run Portal scan from Pipeline → Sources
            <ArrowRight className="size-3" />
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface/30 p-5">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-brand">
          <Building2 className="size-3.5" /> WebSearch portals (Level 3)
        </div>
        <p className="text-sm text-muted">
          {summary === null
            ? "Reading portals.yml…"
            : noWebSearch
              ? "No WebSearch queries configured — add search_queries or scan_method: websearch companies to portals.yml."
              : `${webSearchTotal} WebSearch source${webSearchTotal === 1 ? "" : "s"} (${summary!.queries} quer${summary!.queries === 1 ? "y" : "ies"}, ${summary!.companies} compan${summary!.companies === 1 ? "y" : "ies"})${
                  summary!.sample.length ? `: ${summary!.sample.join(", ")}${webSearchTotal > summary!.sample.length ? "…" : ""}` : ""
                }. Uses your CLI tokens.`}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[12px] text-muted">
            {cliConfigured ? (
              <>
                Runs via <span className="text-foreground">{cliName || "your CLI"}</span> — agent WebSearch, not the free scan.
              </>
            ) : (
              "Connect an AI CLI in Config to use Portals search."
            )}
          </span>
          <button
            type="button"
            disabled={!cliConfigured || noWebSearch}
            onClick={onSubmit}
            className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-foreground shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            {label}
            <CostBadge kind="spend" size="xs" />
            <ArrowRight className="size-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onRunScan}
          className="mt-3 inline-flex items-center gap-1 text-[12px] text-faint transition hover:text-foreground"
        >
          or run the free ATS Scan tab instead →
        </button>
      </div>
    </div>
  );
}
