"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, ChevronDown, ChevronRight, Loader2, Pin, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { LogDialog } from "@/components/followups/log-dialog";
import { NextDateDialog } from "@/components/followups/next-date-dialog";
import { scoreTone } from "@/lib/format";
import {
  type CadenceEntry,
  type CadenceMetadata,
  type Urgency,
  daysHeatClass,
  followupStatusTone,
  oxfordJoin,
  relativeDays,
  urgencyRank,
  urgencyTone,
} from "@/lib/followups";
import { cn } from "@/lib/cn";

// The /followups tracker: WHO needs a nudge today, HOW urgent, WHEN the next
// touch is due, and the permanent history of every follow-up sent. The verdict
// is the core's followup-cadence.mjs (via /api/followups?full=1) — this view
// only filters, sorts, and records.

const URGENCY_TABS = ["ALL", "OVERDUE", "URGENT", "WAITING", "COLD"] as const;
type UrgencyTab = (typeof URGENCY_TABS)[number];

const COLUMNS = [
  { key: "company", label: "Company" },
  { key: "role", label: "Role" },
  { key: "score", label: "Score" },
  { key: "status", label: "Status" },
  { key: "urgency", label: "Urgency" },
  { key: "days", label: "Days since app" },
  { key: "next", label: "Next follow-up" },
  { key: "count", label: "Follow-ups done" },
  { key: "since", label: "Days since F/U" },
] as const;
type SortKey = (typeof COLUMNS)[number]["key"];
const SORT_KEYS = COLUMNS.map((c) => c.key);

/** Sortable value per column; null means "always last, either direction". */
function sortVal(e: CadenceEntry, key: SortKey): string | number | null {
  switch (key) {
    case "company":
      return e.company.toLowerCase();
    case "role":
      return e.role.toLowerCase();
    case "score": {
      const m = e.score?.match(/(\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) : null;
    }
    case "status":
      return e.status;
    case "urgency":
      // Severity, not alphabetical: negate rank so DESCENDING (▼, the first
      // click) puts the most pressing first — matching how the ▼ glyph reads.
      return -urgencyRank(e.urgency);
    case "days":
      return e.daysSinceApplication;
    case "next":
      return e.daysUntilNext;
    case "count":
      return e.followupCount;
    case "since":
      return e.daysSinceLastFollowup;
  }
}

type CadenceResponse = {
  available: boolean;
  metadata: CadenceMetadata | null;
  entries: CadenceEntry[];
};

export function FollowupsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState<CadenceResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dialogFor, setDialogFor] = useState<CadenceEntry | null>(null);
  const [pinFor, setPinFor] = useState<CadenceEntry | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    fetch("/api/followups?full=1")
      .then((r) => r.json())
      .then((d: CadenceResponse) => setData(d))
      .catch(() => setData({ available: false, metadata: null, entries: [] }));
  }, []);
  useEffect(refetch, [refetch]);

  // URL is the source of truth for tab/sort/dir (Pipeline convention); search
  // stays local for snappy typing, seeded from the URL. No sort param → the
  // engine's own order (most pressing first) and all headers show ⇅.
  const pTab = (params.get("urgency") ?? "").toUpperCase();
  const tab: UrgencyTab = (URGENCY_TABS as readonly string[]).includes(pTab) ? (pTab as UrgencyTab) : "ALL";
  const pSort = params.get("sort") ?? "";
  const sortKey: SortKey | null = (SORT_KEYS as readonly string[]).includes(pSort) ? (pSort as SortKey) : null;
  const dir = (params.get("dir") === "-1" ? -1 : 1) as 1 | -1;

  const [q, setQ] = useState(params.get("q") ?? "");
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
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [params, router, pathname],
  );

  const entries = useMemo(() => (data?.available ? data.entries : []), [data]);
  const meta = data?.available ? data.metadata : null;

  const filtering = tab !== "ALL" || q.trim().length > 0;
  const filtered = useMemo(() => {
    let rows = entries;
    if (tab !== "ALL") rows = rows.filter((e) => e.urgency.toUpperCase() === tab);
    if (q.trim()) {
      const needle = q.toLowerCase();
      rows = rows.filter((e) => `${e.company} ${e.role}`.toLowerCase().includes(needle));
    }
    if (!sortKey) return rows; // engine order: most pressing first
    return [...rows].sort((a, b) => {
      const av = sortVal(a, sortKey);
      const bv = sortVal(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last, either direction
      if (bv == null) return -1;
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [entries, tab, q, sortKey, dir]);

  const removeLogged = async (num: number) => {
    setActionError(null);
    try {
      const res = await fetch("/api/followups/log", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ num }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(typeof j.error === "string" ? `Couldn't remove the follow-up: ${j.error}` : "Couldn't remove the follow-up.");
      }
    } catch {
      setActionError("Couldn't remove the follow-up.");
    }
    refetch();
  };

  const toggleExpand = (num: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(num)) next.delete(num);
      else next.add(num);
      return next;
    });

  const subtitle = !data ? (
    <span className="inline-flex items-center gap-1.5">
      <Loader2 className="size-3.5 animate-spin" /> Computing cadence…
    </span>
  ) : !data.available || !meta ? (
    "Cadence unavailable"
  ) : (
    <>
      <span className="tabular-nums">{meta.actionable}</span> active ·{" "}
      <span className="tabular-nums">{meta.urgent}</span> urgent ·{" "}
      <span className="tabular-nums">{meta.overdue}</span> overdue
    </>
  );

  return (
    <div className="mx-auto max-w-none px-6 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Follow-up Tracker</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        <div className="relative w-56 max-w-[35vw]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company or role…"
            className="w-full rounded-md border border-border bg-surface/60 py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
          />
        </div>
      </div>

      {meta && !filtering && <NarrativeCard meta={meta} entries={entries} />}

      {/* urgency filter */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {URGENCY_TABS.map((t) => {
          const count = t === "ALL" ? entries.length : entries.filter((e) => e.urgency.toUpperCase() === t).length;
          return (
            <button
              key={t}
              onClick={() => setParams({ urgency: t === "ALL" ? null : t })}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                tab === t ? "border-brand text-foreground" : "border-transparent text-muted hover:text-foreground",
              )}
            >
              {t} <span className="text-faint tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {actionError && <p className="mt-3 text-xs text-red-500">{actionError}</p>}

      {!data ? null : !data.available ? (
        <EmptyPanel title="Cadence unavailable" body="The cadence engine (followup-cadence.mjs) returned nothing — check that the core scripts are present." />
      ) : filtered.length === 0 ? (
        filtering ? (
          <EmptyPanel title="No matches" body="Try a different urgency filter or clear the search." />
        ) : (
          <EmptyPanel title="Nothing to chase" body="No active applications need a follow-up. Apply to roles (or update statuses) and the cadence starts tracking them." />
        )
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-surface/60 text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="w-8 px-2 py-2.5" aria-label="Expand" />
                {COLUMNS.map((c) => {
                  const active = sortKey === c.key;
                  return (
                    <th key={c.key} aria-sort={active ? (dir === 1 ? "ascending" : "descending") : "none"} className="px-2.5 py-2.5 font-medium">
                      <button
                        type="button"
                        className="inline-flex cursor-pointer select-none items-center gap-1 uppercase tracking-wide hover:text-foreground"
                        onClick={() =>
                          // First click on Urgency descends (most pressing first —
                          // how ▼ reads); other columns start ascending.
                          setParams({ sort: c.key, dir: active ? dir * -1 : c.key === "urgency" ? -1 : 1 })
                        }
                      >
                        {c.label}
                        <span aria-hidden="true" className={cn(!active && "text-faint")}>
                          {active ? (dir === 1 ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="px-2.5 py-2.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((e) => (
                <FollowupRow
                  key={e.num}
                  entry={e}
                  expanded={expanded.has(e.num)}
                  onToggle={() => toggleExpand(e.num)}
                  onLog={() => setDialogFor(e)}
                  onPin={() => setPinFor(e)}
                  onRemove={removeLogged}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialogFor && <LogDialog entry={dialogFor} onClose={() => setDialogFor(null)} onLogged={refetch} />}
      {pinFor && <NextDateDialog entry={pinFor} onClose={() => setPinFor(null)} onChanged={refetch} />}
    </div>
  );
}

/** The one-sentence "what to do first" card — only when something is due and no
 *  filter narrows the view (spec: hidden while any filter/search is active). */
function NarrativeCard({ meta, entries }: { meta: CadenceMetadata; entries: CadenceEntry[] }) {
  const due = meta.overdue + meta.urgent;
  if (due <= 0) return null;

  const pressing = [...entries]
    .filter((e) => e.urgency === "overdue" || e.urgency === "urgent")
    .sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency) || b.daysSinceApplication - a.daysSinceApplication)
    .slice(0, 4);

  const parts: string[] = [];
  if (meta.overdue > 0) parts.push(`Overdue follow-ups: ${meta.overdue}`);
  if (meta.urgent > 0) parts.push(`Urgent: ${meta.urgent}`);
  if (pressing.length > 0) {
    parts.push(`most pressing today: ${oxfordJoin(pressing.map((e) => `${e.company} (#${e.num})`))}`);
    const days = pressing.map((e) => e.daysSinceApplication);
    const max = Math.max(...days);
    parts.push(days.every((d) => d === max) ? `all ${max} days since applied` : `up to ${max} days since applied`);
  }

  return (
    <div
      className={cn(
        "mt-5 rounded-xl border border-border border-l-4 bg-surface/40 px-4 py-3 text-sm text-muted",
        meta.overdue > 0 ? "border-l-red-500" : "border-l-amber-500",
      )}
    >
      {parts.join(" — ")}
    </div>
  );
}

function FollowupRow({
  entry: e,
  expanded,
  onToggle,
  onLog,
  onPin,
  onRemove,
}: {
  entry: CadenceEntry;
  expanded: boolean;
  onToggle: () => void;
  onLog: () => void;
  onPin: () => void;
  onRemove: (num: number) => void;
}) {
  const statusLabel = e.status.charAt(0).toUpperCase() + e.status.slice(1);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="group transition-colors hover:bg-surface/40">
        <td className="px-2 py-3">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} follow-up history for ${e.company}`}
            className="rounded p-1 text-faint transition hover:text-foreground"
          >
            <Chevron className="size-4" />
          </button>
        </td>
        <td className="px-2.5 py-3 font-medium">
          {e.reportPath ? (
            <Link href={`/pipeline/${e.num}`} className="flex items-center gap-2.5 transition-colors group-hover:text-brand">
              <CompanyLogo name={e.company} size={20} />
              {e.company}
            </Link>
          ) : (
            <span className="flex items-center gap-2.5">
              <CompanyLogo name={e.company} size={20} />
              {e.company}
            </span>
          )}
        </td>
        <td className="max-w-56 truncate px-2.5 py-3 text-muted">{e.role}</td>
        <td className="px-2.5 py-3">
          <Badge tone={scoreTone(e.score)}>{e.score || "—"}</Badge>
        </td>
        <td className="px-2.5 py-3">
          <Badge tone={followupStatusTone(e.status)}>{statusLabel}</Badge>
        </td>
        <td className="px-2.5 py-3">
          <Badge tone={urgencyTone(e.urgency)}>{e.urgency}</Badge>
        </td>
        <td className={cn("px-2.5 py-3 tabular-nums", daysHeatClass(e.daysSinceApplication))}>{e.daysSinceApplication}</td>
        <td className="whitespace-nowrap px-2.5 py-3">
          {e.daysUntilNext == null ? (
            <span className="text-faint">—</span>
          ) : (
            <span className={cn(e.daysUntilNext < 0 && "font-medium text-red-600 dark:text-red-400")} title={e.nextFollowupDate ?? undefined}>
              {relativeDays(e.daysUntilNext)}
            </span>
          )}
          {e.nextOverride && (
            <span
              className="ml-1.5 inline-flex align-[-1px]"
              title={`Pinned to ${e.nextOverride} — cleared when you log a follow-up`}
              aria-label="Pinned manually"
            >
              <Pin className="size-3 text-brand" />
            </span>
          )}
        </td>
        <td className="px-2.5 py-3 tabular-nums">{e.followupCount}</td>
        <td className={cn("px-2.5 py-3 tabular-nums", daysHeatClass(e.daysSinceLastFollowup))}>
          {e.daysSinceLastFollowup == null ? <span className="text-faint">—</span> : e.daysSinceLastFollowup}
        </td>
        <td className="whitespace-nowrap px-2.5 py-3">
          <span className="inline-flex items-center gap-0.5">
            <button
              type="button"
              onClick={onLog}
              title="Log a follow-up (date, channel, contact, notes)"
              className="rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-brand-soft hover:text-brand"
            >
              Log
            </button>
            <button
              type="button"
              onClick={onPin}
              title={e.nextOverride ? `Next date pinned to ${e.nextOverride} — change or clear` : "Pin a custom next follow-up date"}
              className={cn(
                "rounded-md p-1 transition-colors hover:bg-brand-soft hover:text-brand",
                e.nextOverride ? "text-brand" : "text-faint",
              )}
            >
              <CalendarClock className="size-3.5" />
            </button>
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-surface/30">
          <td colSpan={COLUMNS.length + 2} className="px-4 py-3">
            <HistoryPanel entry={e} onRemove={onRemove} />
          </td>
        </tr>
      )}
    </>
  );
}

function HistoryPanel({ entry: e, onRemove }: { entry: CadenceEntry; onRemove: (num: number) => void }) {
  // Tolerate an older core engine (CAREER_OPS_ROOT can point at a separate
  // checkout whose followup-cadence.mjs predates the per-entry followups[]).
  const history = e.followups ?? [];
  return (
    <div className="space-y-2 pl-7 text-sm">
      {history.length === 0 ? (
        <p className="text-faint">No follow-ups logged yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {history.map((f, i) => (
            <li key={`${f.num ?? "b"}-${f.date}-${i}`} className="group/item flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {/* Fixed-width leading slot keeps every entry's text aligned,
                  whether or not it is deletable (legacy bullets carry no num). */}
              <span className="inline-flex w-5 shrink-0 justify-center self-center">
                {f.num != null && (
                  <button
                    type="button"
                    onClick={() => onRemove(f.num!)}
                    title="Remove this logged follow-up (added by mistake?)"
                    aria-label={`Remove follow-up logged ${f.date}`}
                    className="rounded p-0.5 text-faint opacity-0 transition group-hover/item:opacity-100 hover:text-red-500 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </span>
              <span className="tabular-nums text-muted">{f.date}</span>
              <Badge tone="muted">{f.channel}</Badge>
              {f.contact && <span className="text-muted">{f.contact}</span>}
              {f.notes && <span className="text-faint">{f.notes}</span>}
            </li>
          ))}
        </ul>
      )}
      {e.contacts.length > 0 && (
        <p className="text-xs text-faint">
          Suggested contacts:{" "}
          {e.contacts.map((c, i) => (
            <span key={c.email}>
              {i > 0 && ", "}
              <a href={`mailto:${c.email}`} className="text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-brand">
                {c.name ? `${c.name} <${c.email}>` : c.email}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center">
      <p className="font-display text-lg">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}
