"use client";

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useOptimistic, useRef, useState, useTransition, type MouseEvent } from "react";
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
import { isSearchOnlyWrite, queryWithLiveSearch } from "@/lib/list-search-sync.mjs";
import { useListSearch } from "@/lib/use-list-search";
import { COMPARE_MAX } from "@/lib/pipeline-compare.mjs";
import { postingHref, postingLabel } from "@/lib/posting-url.mjs";
import { trackerCsv, trackerCsvFilename } from "@/lib/tracker-csv.mjs";
import { SCORE_FLOORS, keepsPendingNames, keepsStoredNames, normalizeView, omissionAfterAttempt, parseViews, removeView, savedViewPayload, upsertView, viewUpdates, viewsForMutation } from "@/lib/pipeline-views.mjs";
import { trackerEmptyMessage } from "@/lib/tracker-empty.mjs";
import { listEntrySync } from "@/lib/history-back.mjs";

type Tab = (typeof PIPELINE_TABS)[number];
type SavedView = NonNullable<ReturnType<typeof normalizeView>>;

const SORT_KEYS = ["tracker", "company", "role", "score", "status", "date"] as const;
const VIEWS_KEY = "career-ops:pipeline-views";
const REMOVAL_WARNING = "This removal is not saved yet. Reloading brings the view back.";
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
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [viewError, setViewError] = useState("");
  const [removalWarning, setRemovalWarning] = useState("");
  const storageRejected = useRef(false);
  const omittedWhileRejected = useRef(new Set<string>());
  const pendingWhileRejected = useRef(new Set<string>());
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

  // Search filters locally. The URL catches up once typing pauses, so a
  // reload or the browser Back button still has it. Tab changes include the
  // typed value immediately, before that pause.
  const qRef = useRef(params.get("q") ?? "");
  const commitParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const qs = queryWithLiveSearch(params.toString(), updates, qRef.current);
      if (qs === params.toString()) return false;
      const href = `${pathname}${qs ? `?${qs}` : ""}`;
      // Search already filtered the rows. A transition would hide them.
      if (isSearchOnlyWrite(updates)) {
        router.replace(href, { scroll: false });
        return true;
      }
      if (Object.prototype.hasOwnProperty.call(updates, "tab")) {
        const nextTab = String(updates.tab ?? "INBOX").toUpperCase();
        if ((PIPELINE_TABS as readonly string[]).includes(nextTab)) setPendingTab(nextTab as Tab);
      }
      startRouteProgress();
      startNavigation(() => {
        router.replace(href, { scroll: false });
      });
      return true;
    },
    [params, router, pathname, startNavigation],
  );
  const { q, setQ, setParams, cancelPendingSearch } = useListSearch(params, commitParams, qRef);
  // Typing stays local until the URL catches up, so include it when leaving.
  const detailQuery = pipelineQuery(params.toString(), q);
  // The list entry has to carry that search too. Otherwise Back compares the
  // return link with an older URL and opens a fresh list at the top.
  function syncTypedSearch(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click leaves Pipeline open and opens the link elsewhere.
    // replaceState would show the typed search while Next still has the old
    // params, so the next sort deletes it. The other tab already has the href.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) return;
    // The search timer would router.replace this list and can steal the click
    // if the list is still mounted while the next page loads.
    cancelPendingSearch();
    const next = listEntrySync(pathname, params.toString(), q);
    if (!next) return;
    const state = window.history.state;
    if (!state || state.__NA !== true) return;
    window.history.replaceState(state, "", next);
  }

  useEffect(() => {
    if (!isPending) setPendingTab(null);
  }, [isPending]);

  useEffect(() => {
    try {
      setViews(parseViews(localStorage.getItem(VIEWS_KEY) || "[]"));
    } catch {
      setViews([]);
    }
  }, []);

  function writeSavedViews(action: "save" | "remove", next: SavedView[]) {
    const payload = savedViewPayload(action, next);
    if (payload == null) return false;
    try {
      localStorage.setItem(VIEWS_KEY, payload);
      storageRejected.current = false;
      omittedWhileRejected.current.clear();
      pendingWhileRejected.current.clear();
      setViewError("");
      setRemovalWarning("");
      return true;
    } catch {
      storageRejected.current = true;
      if (action === "remove") setRemovalWarning(REMOVAL_WARNING);
      else setViewError("This view stays on this page only.");
      return false;
    }
  }

  function mutationBase(extraOmitted: string[] = []) {
    const omitted = [...omittedWhileRejected.current, ...extraOmitted];
    const pending = [...pendingWhileRejected.current];
    try {
      const stored = parseViews(localStorage.getItem(VIEWS_KEY) || "[]");
      return { stored, base: viewsForMutation(views, stored, storageRejected.current, omitted, pending) };
    } catch {
      // Disk could not be read, so keep the in-memory list rather than dropping unchanged views.
      return { stored: [] as SavedView[], base: viewsForMutation(views, [], true, omitted) };
    }
  }

  function saveCurrentView(name: string) {
    const view = normalizeView({ name, tab, q, min: minFilter, sort: sort.key, dir: sort.dir });
    if (!view) {
      setViewError("Name the view first.");
      return;
    }
    const { stored, base } = mutationBase();
    const next = upsertView(base, view);
    const added = base.some((item) => item.name === view.name) || next.length > base.length;
    const allow = [...omittedWhileRejected.current];
    const pending = [...pendingWhileRejected.current];
    if (!added || !keepsStoredNames(next, stored, allow) || !keepsPendingNames(next, pending, allow)) {
      setViewError("Remove a view first.");
      return;
    }
    omittedWhileRejected.current = new Set(omissionAfterAttempt(allow, view.name, true));
    setViews(next);
    setNaming(false);
    setDraftName("");
    setViewError("");
    if (!writeSavedViews("save", next)) pendingWhileRejected.current.add(view.name);
  }

  function removeSavedView(name: string) {
    const allow = [...omittedWhileRejected.current, name];
    const pending = [...pendingWhileRejected.current];
    const { stored, base } = mutationBase([name]);
    const next = removeView(base, name);
    if (!keepsStoredNames(next, stored, allow) || !keepsPendingNames(next, pending, allow)) {
      // One removal may not free room for every pending view. Remember it
      // and wait for a later write that can keep those views.
      omittedWhileRejected.current.add(name);
      pendingWhileRejected.current.delete(name);
      setViews((current) => current.filter((view) => view.name !== name));
      setRemovalWarning(REMOVAL_WARNING);
      return;
    }
    setViews(next);
    if (!writeSavedViews("remove", next)) {
      omittedWhileRejected.current.add(name);
      pendingWhileRejected.current.delete(name);
    }
  }

  function applySaved(view: SavedView) {
    setQ(view.q);
    setParams(viewUpdates(view));
  }

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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {visibleTab !== "INBOX" && <label className="inline-flex items-center gap-2 text-xs text-muted">
          Score
          <select
            aria-label="Minimum score"
            value={minFilter ?? ""}
            onChange={(event) => setParams({ min: event.target.value === "" ? null : event.target.value })}
            className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground"
          >
            <option value="">Any</option>
            {minFilter != null && !SCORE_FLOORS.includes(minFilter) && (
              <option value={String(minFilter)}>{minFilter}+</option>
            )}
            {SCORE_FLOORS.map((floor) => (
              <option key={floor} value={String(floor)}>{floor.toFixed(1)}+</option>
            ))}
          </select>
        </label>}
        {views.map((view) => {
          const active = view.tab === tab && view.q === q && view.min === minFilter && view.sort === sort.key && view.dir === sort.dir;
          return (
            <span key={view.name} className={cn("inline-flex items-center rounded-full border", active ? "border-brand/40 bg-brand-soft" : "border-border bg-surface/60")}>
              <button type="button" onClick={() => applySaved(view)} className="px-2.5 py-1 text-xs font-medium text-foreground">
                {view.name}
              </button>
              <button type="button" aria-label={`Remove view ${view.name}`} onClick={() => removeSavedView(view.name)} className="px-1.5 text-xs text-faint hover:text-foreground">
                ×
              </button>
            </span>
          );
        })}
        {naming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              saveCurrentView(draftName);
            }}
            className="inline-flex items-center gap-2"
          >
            <input
              aria-label="View name"
              value={draftName}
              autoFocus
              onChange={(event) => setDraftName(event.target.value)}
              className="w-36 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-brand/50"
            />
            <button type="submit" className="text-xs font-medium text-brand-text">Save</button>
            <button type="button" onClick={() => { setNaming(false); setDraftName(""); setViewError(""); }} className="text-xs text-muted">Cancel</button>
          </form>
        ) : (
          <button type="button" onClick={() => { setViewError(""); setNaming(true); }} className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground">
            Save view
          </button>
        )}
        {viewError && <span role="alert" className="text-xs text-red-500">{viewError}</span>}
        {removalWarning && <span role="alert" className="text-xs text-red-500">{removalWarning}</span>}
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
              href={`/pipeline/compare?n=${selectedRows.map((r) => r.n).join(",")}${detailQuery ? `&${detailQuery}` : ""}`}
              onClick={syncTypedSearch}
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
                      <Link href={detailHref} tabIndex={-1} onClick={syncTypedSearch} className="transition-colors group-hover:text-brand-text">
                        #{r.n}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={detailHref} onClick={syncTypedSearch} className="flex items-center gap-2.5 transition-colors group-hover:text-brand-text">
                        <CompanyLogo name={company.logoName} size={20} />
                        {company.label}
                      </Link>
                    </td>
                  <td className="px-4 py-3 text-muted">
                    <div className="flex items-center gap-2">
                      <Link href={detailHref} tabIndex={-1} onClick={syncTypedSearch}>{r.role}</Link>
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
