"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, ChevronsUpDown, X, Compass, ArrowRight, ExternalLink, Download } from "lucide-react";
import type { Application, InboxJob } from "@/lib/career-ops";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { CANONICAL_STATES, scoreNum, scoreTone } from "@/lib/format";
import { StatusSelect } from "@/components/status-select";
import { applicationKey, applySavedStatus, saveStatuses } from "@/lib/pipeline-status.mjs";
import { InboxTriage } from "@/components/inbox/inbox-triage";
import { cn } from "@/lib/cn";
import { companyPresentation, companySearchText } from "@/lib/company-presentation.mjs";
import { PipelineTableRowsSkeleton } from "@/components/page-loading-skeletons";
import { startRouteProgress } from "@/components/route-progress";
import { sortRows } from "@/lib/core/pipeline-sort.mjs";
import { PageFrame } from "@/components/page-frame";
import { PIPELINE_TABS, pipelineQuery, pipelineTab, rowOnPipelineTab } from "@/lib/pipeline-navigation.mjs";
import { COMPARE_MAX } from "@/lib/pipeline-compare.mjs";
import { postingHref, postingLabel } from "@/lib/posting-url.mjs";
import { trackerCsv, trackerCsvFilename } from "@/lib/tracker-csv.mjs";
import { trackerEmptyMessage } from "@/lib/tracker-empty.mjs";

type Tab = (typeof PIPELINE_TABS)[number];

const SORT_KEYS = ["tracker", "company", "role", "score", "status", "date"] as const;
type SortKey = (typeof SORT_KEYS)[number];

export function PipelineView({
  applications,
  inbox,
  inboxCount,
  trackerShape = "rows",
}: {
  applications: Application[];
  inbox: InboxJob[] | null;
  inboxCount: number;
  trackerShape?: "missing" | "empty" | "malformed" | "rows";
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startNavigation] = useTransition();
  const [pendingTab, setPendingTab] = useState<Tab | null>(null);
  // Starts AFTER the POST succeeds. React replays the confirmed save over
  // intervening snapshots and discards it when the refresh transition settles.
  const [visibleApplications, showSavedStatus] = useOptimistic(applications, applySavedStatus<Application>);
  const [announcement, setAnnouncement] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const activeTab = useRef<HTMLButtonElement>(null);

  // The URL is the SINGLE source of truth for tab/min/sort/dir, so the home stat
  // tiles' deep links AND the assistant's filterPipeline/navigate actions drive
  // the table identically (no useState mirror → no desync).
  const tab: Tab = pipelineTab(params.get("tab"));
  const visibleTab = isPending && pendingTab ? pendingTab : tab;
  const pMin = parseFloat(params.get("min") ?? "");
  const minFilter: number | null = Number.isFinite(pMin) ? pMin : null;
  const pSort = params.get("sort") ?? "";
  const sortKey: SortKey = (SORT_KEYS as readonly string[]).includes(pSort) ? (pSort as SortKey) : "score";
  const sort = { key: sortKey, dir: (params.get("dir") === "1" ? 1 : -1) as 1 | -1 };

  // Search stays LOCAL for snappy typing; seeded from the URL and re-synced only
  // when the URL's q changes (i.e. the assistant set it) — never per keystroke.
  const [q, setQ] = useState(params.get("q") ?? "");
  // Typing stays local, so include it explicitly when leaving the list.
  const detailQuery = pipelineQuery(params.toString(), q);
  const lastUrlQ = useRef(params.get("q") ?? "");
  useEffect(() => {
    const urlQ = params.get("q") ?? "";
    if (urlQ !== lastUrlQ.current) {
      lastUrlQ.current = urlQ;
      setQ(urlQ);
    }
  }, [params]);

  const setParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v == null || v === "") sp.delete(k);
        else sp.set(k, String(v));
      }
      const qs = sp.toString();
      if (qs === params.toString()) return;
      if (Object.prototype.hasOwnProperty.call(updates, "tab")) {
        const nextTab = String(updates.tab ?? "INBOX").toUpperCase();
        if ((PIPELINE_TABS as readonly string[]).includes(nextTab)) setPendingTab(nextTab as Tab);
      }
      startRouteProgress();
      startNavigation(() => {
        router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
      });
    },
    [params, router, pathname, startNavigation],
  );

  useEffect(() => {
    if (!isPending) setPendingTab(null);
  }, [isPending]);

  // The table filters on a deferred copy of the search text. The input shows
  // each keystroke at once; re-filtering and re-rendering every tracker row
  // runs at low priority, and React drops a stale render when the next
  // keystroke arrives, so typing no longer waits on the whole table.
  const deferredQ = useDeferredValue(q);

  const filtered = useMemo(() => {
    if (tab === "INBOX") return [];
    let rows = visibleApplications;
    if (tab !== "ALL") rows = rows.filter((r) => rowOnPipelineTab(r.status, tab));
    if (minFilter != null) {
      rows = rows.filter((r) => {
        const n = scoreNum(r.score);
        return !Number.isNaN(n) && n >= minFilter;
      });
    }
    if (deferredQ.trim()) {
      const needle = deferredQ.toLowerCase();
      rows = rows.filter((r) => companySearchText(r).toLowerCase().includes(needle));
    }
    // scoreNum is the real score parser (it handles the tracker's "4.2/5"
    // cells); sortRows takes it rather than keeping a second copy (#4333).
    return sortRows(
      rows,
      sort,
      scoreNum,
      (row) => companyPresentation(row).label,
    ) as Application[];
  }, [visibleApplications, tab, deferredQ, sort, minFilter]);

  const filteredKeys = filtered.map(applicationKey);
  const selectedRows = filtered.filter((r) => selected.has(applicationKey(r)));
  const allSelected = filteredKeys.length > 0 && filteredKeys.every((k) => selected.has(k));

  function toggleRow(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([trackerCsv(filtered)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = trackerCsvFilename(tab, new Date());
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function applyBulkStatus() {
    if (!bulkStatus || selectedRows.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    setBulkError("");
    const { saved, failed } = await saveStatuses(selectedRows, bulkStatus);
    setBulkBusy(false);
    setSelected(new Set(selectedRows.filter((r) => failed.some((f) => f.n === r.n)).map(applicationKey)));
    if (failed.length > 0) {
      setBulkError(`${failed.length} not saved: ${failed.map((f) => `#${f.n} (${f.error})`).join(", ")}`);
    }
    setAnnouncement(`${saved.length} application${saved.length === 1 ? "" : "s"} set to ${bulkStatus}.`);
    startTransition(() => router.refresh());
  }

  return (
    <PageFrame>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Pipeline</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="tabular-nums">{inboxCount}</span> in inbox ·{" "}
            <span className="tabular-nums">{visibleApplications.length}</span> tracked
          </p>
        </div>
        {/* the tracker has its own search; the inbox brings its own facet filters */}
        {visibleTab !== "INBOX" && (
          <div className="flex items-center gap-2">
            <div className="relative w-64 max-w-[40vw]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search company or role…"
                className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
              />
            </div>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={isPending || filtered.length === 0}
              title={`Download the ${filtered.length} row${filtered.length === 1 ? "" : "s"} shown as a CSV file`}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface/60 px-3 py-2 text-sm text-muted transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50 max-sm:min-h-[44px] max-sm:min-w-[44px] max-sm:justify-center max-sm:px-0"
            >
              <Download aria-hidden="true" className="size-4" />
              <span className="max-sm:sr-only">Download CSV</span>
            </button>
          </div>
        )}
      </div>

      {/* tabs */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {PIPELINE_TABS.map((t) => {
          const count =
            t === "INBOX"
              ? inboxCount
              : t === "ALL"
                ? visibleApplications.length
                : visibleApplications.filter((r) => rowOnPipelineTab(r.status, t)).length;
          if (t === "OTHER" && count === 0 && visibleTab !== "OTHER") return null;
          return (
            <button
              key={t}
              type="button"
              ref={tab === t ? activeTab : undefined}
              aria-pressed={visibleTab === t}
              onClick={() => setParams({ tab: t === "INBOX" ? null : t })}
              className={cn(
                // gap-1, not a whitespace text node: flex containers drop
                // whitespace-only anonymous items, which rendered "INBOX0".
                "-mb-px inline-flex items-center justify-center gap-1 border-b-2 px-3 py-2 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                visibleTab === t
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {t} <span className="text-faint tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      <p role="status" className="sr-only">{announcement}</p>

      {visibleTab !== "INBOX" && minFilter != null && (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-faint">Filtered:</span>
          <button
            type="button"
            onClick={() => setParams({ min: null })}
            className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-text transition-colors hover:bg-brand/15"
            title="Clear score filter"
          >
            score ≥ {minFilter.toFixed(1)}
            <X className="size-3" />
          </button>
        </div>
      )}

      {visibleTab !== "INBOX" && selectedRows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm">
          <span className="tabular-nums">{selectedRows.length} selected</span>
          <select
            aria-label="Status for selected applications"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value)}
            disabled={bulkBusy}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
          >
            <option value="">Set status…</option>
            {CANONICAL_STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={applyBulkStatus}
            disabled={!bulkStatus || bulkBusy}
            className="rounded-md border border-brand/40 bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-text disabled:opacity-50"
          >
            {bulkBusy ? "Saving…" : "Apply"}
          </button>
          {selectedRows.length >= 2 && selectedRows.length <= COMPARE_MAX && (
            <Link
              href={`/pipeline/compare?n=${selectedRows.map((r) => r.n).join(",")}`}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:border-brand/40 hover:text-brand-text"
            >
              Compare
            </Link>
          )}
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted hover:text-foreground">
            Clear
          </button>
          {bulkError && <span role="alert" className="text-xs text-red-500">{bulkError}</span>}
        </div>
      )}

      {visibleTab === "INBOX" ? (
        /* ── Inbox: the triage surface (Abundance → Triage → Shortlist → Score) ── */
        <>
          {inbox === null ? (
            <div role="status" className="mt-4 overflow-x-auto rounded-2xl border border-border">
              <span className="sr-only">Loading inbox…</span>
              <table aria-hidden="true" className="w-full min-w-[44rem] text-sm">
                <tbody className="divide-y divide-border">
                  <PipelineTableRowsSkeleton />
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <InboxTriage inbox={inbox} />
              {inbox.length === 0 && <InboxEmpty tracked={visibleApplications.length} />}
            </>
          )}
        </>
      ) : isPending || filtered.length > 0 ? (
        /* ── Tracker table ──
           overflow-x-auto, not overflow-hidden: the rounded corners still clip,
           but a table too wide for the viewport can now be scrolled to instead
           of being silently cut off. min-w keeps the columns readable rather
           than letting w-full crush them on a phone. */
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="w-8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all shown applications"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(filteredKeys))}
                  />
                </th>
                {SORT_KEYS.map((k) => (
                  <th
                    key={k}
                    aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                    className={cn(
                      "whitespace-nowrap px-4 py-2.5 font-medium",
                      k === "date" && "hidden lg:table-cell",
                    )}
                  >
                    <button
                      type="button"
                      className="inline-flex cursor-pointer select-none items-center gap-1 uppercase tracking-wide hover:text-foreground"
                      onClick={() => setParams({ sort: k, dir: sort.key === k ? sort.dir * -1 : -1 })}
                    >
                      {k}
                      <ChevronsUpDown aria-hidden="true" className="size-3" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            {/* Keep editors mounted while query navigation is pending: sorting
                must not discard an open editor or an in-flight status save. */}
            <tbody className="divide-y divide-border" hidden={isPending} aria-busy={false}>
              {filtered.map((r) => {
                const company = companyPresentation(r);
                const key = applicationKey(r);
                const detailHref = `/pipeline/${encodeURIComponent(r.n)}${detailQuery ? `?${detailQuery}` : ""}`;
                const posting = postingHref(r.url);
                return (
                  <tr key={key} data-application-key={key} className="group transition-colors hover:bg-surface/40">
                    <td className="w-8 px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${company.label}, ${r.role} (#${r.n})`}
                        checked={selected.has(key)}
                        onChange={() => toggleRow(key)}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums">
                      <Link href={detailHref} tabIndex={-1} className="transition-colors group-hover:text-brand-text">
                        #{r.n}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={detailHref} className="flex items-center gap-2.5 transition-colors group-hover:text-brand-text">
                        <CompanyLogo name={company.logoName} size={20} />
                        {company.label}
                      </Link>
                    </td>
                  <td className="px-4 py-3 text-muted">
                    <div className="flex items-center gap-2">
                      <Link href={detailHref} tabIndex={-1}>{r.role}</Link>
                      {posting && (
                        <a
                          href={posting}
                          target="_blank"
                          rel="noreferrer"
                          title={posting}
                          className="inline-flex shrink-0 items-center gap-1 text-xs text-brand-text hover:underline"
                        >
                          {postingLabel(posting)}
                          <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={scoreTone(r.score)}>{r.score || "—"}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    <StatusSelect
                      n={r.n}
                      current={r.status}
                      inline
                      applicationLabel={`${company.label} — ${r.role} (#${r.n})`}
                      onSaved={(status, restoreFocus) => {
                        // If this focused row leaves its tab, preserve a useful
                        // focus target. Do not interrupt someone using search.
                        const focusedRow = document.activeElement?.closest("tr");
                        if (tab !== "ALL" && !rowOnPipelineTab(status, tab) && (restoreFocus || focusedRow?.dataset.applicationKey === key)) {
                          activeTab.current?.focus();
                        }
                        setAnnouncement(`Application #${r.n} status saved as ${status}.`);
                        startTransition(() => {
                          showSavedStatus({ key, status });
                          router.refresh();
                        });
                      }}
                    />
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-faint tabular-nums lg:table-cell">{r.date}</td>
                  </tr>
                );
              })}
            </tbody>
            {isPending && (
              <tbody className="divide-y divide-border" aria-busy="true">
                <PipelineTableRowsSkeleton trackerColumn />
              </tbody>
            )}
          </table>
        </div>
      ) : (
        <EmptyTracker shape={trackerShape} query={deferredQ} min={minFilter} tab={tab} />
      )}
    </PageFrame>
  );
}

function EmptyTracker({
  shape,
  query,
  min,
  tab,
}: {
  shape: string;
  query: string;
  min: number | null;
  tab: string;
}) {
  const copy = trackerEmptyMessage({ shape, query, min, tab });
  return (
    <div
      role={copy.kind === "malformed" ? "alert" : "status"}
      className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center"
    >
      <p className="font-display text-lg">{copy.title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{copy.detail}</p>
    </div>
  );
}

// Empty inbox. Self-sufficient for the mainstream user (a primary in-web action),
// honest for devs (the CLI/file path stays, demoted to progressive transparency).
function InboxEmpty({ tracked }: { tracked: number }) {
  return (
    <div className="dot-bg mt-4 overflow-hidden rounded-2xl border border-border bg-surface/50 bg-origin-border bg-gradient-to-tr from-brand/10 via-transparent to-transparent shadow-lg">
      <div className="flex items-center gap-2 border-b border-foreground/10 px-5 py-3">
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="size-2.5 rounded-full bg-foreground/15" aria-hidden="true" />
        <span className="ml-3 font-mono text-xs tracking-wide text-muted">career-ops · inbox</span>
      </div>
      <div className="px-6 py-10 text-center">
        <p className="font-display text-lg">
          Your <span className="text-brand-text">inbox</span> is empty.
        </p>
        {tracked > 0 && (
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
            New postings land here. Your{" "}
            <Link href="/pipeline?tab=ALL" className="font-medium text-brand-text underline-offset-2 hover:underline">
              {tracked} tracked role{tracked === 1 ? "" : "s"}
            </Link>{" "}
            {tracked === 1 ? "is" : "are"} under All.
          </p>
        )}
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">Find roles that match your CV — free, no tokens spent.</p>
        <Link
          href="/explore?run=1"
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground shadow-sm transition-all duration-200 hover:bg-brand-200 hover:-translate-y-0.5 hover:shadow-md"
        >
          <Compass className="size-4" /> {tracked > 0 ? "Run a free scan" : "Run your first free scan"} <ArrowRight className="size-4" />
        </Link>
        <p className="mx-auto mt-4 max-w-sm text-xs text-muted">
          Prefer the terminal? Run <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">career-ops scan</code>, or add job URLs to{" "}
          <code className="rounded bg-surface-hover px-1 py-0.5 font-mono">data/pipeline.md</code>.
        </p>
      </div>
    </div>
  );
}
