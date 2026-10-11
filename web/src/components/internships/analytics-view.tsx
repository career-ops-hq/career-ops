"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type Internship = {
  id: string;
  company: string;
  role: string;
  location: string;
  status: "wishlist" | "applied" | "interviewing" | "offered" | "rejected" | "accepted" | "closed" | "not_posted" | "unknown";
  dateAdded: string;
  dateApplied?: string;
  deadline?: string;
  url?: string;
  notes: string;
  resumeFile?: string;
  score?: string;
  track?: string;
  term?: string;
  opened?: string;
  dateConfidence?: string;
  gradEligibility?: string;
  workAuth?: string;
  requirements?: string;
  priority?: string;
  source?: string;
  lastVerified?: string;
  statusLog?: { date: string; from: string; to: string; note?: string }[];
};

const STATUS_CONFIG: Record<
  Internship["status"],
  { label: string; tone: "muted" | "info" | "warn" | "good" | "bad"; dot: string }
> = {
  wishlist: { label: "Open", tone: "muted", dot: "bg-zinc-400" },
  applied: { label: "Applied", tone: "info", dot: "bg-sky-400" },
  interviewing: { label: "Interviewing", tone: "warn", dot: "bg-amber-400" },
  offered: { label: "Offered", tone: "good", dot: "bg-emerald-400" },
  accepted: { label: "Accepted", tone: "good", dot: "bg-emerald-500" },
  rejected: { label: "Rejected", tone: "bad", dot: "bg-red-400" },
  closed: { label: "Closed", tone: "bad", dot: "bg-red-300" },
  not_posted: { label: "Not Posted", tone: "muted", dot: "bg-zinc-300" },
  unknown: { label: "Unknown", tone: "muted", dot: "bg-zinc-500" },
};

const TRACK_COLORS: Record<string, string> = {
  DS: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  DA: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  BIE: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
  SWE: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
};

const FUNNEL_STAGES = ["applied", "interviewing", "offered", "accepted"] as const;

function pct(n: number, d: number): string {
  if (d === 0) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(
    (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24),
  );
}

export function AnalyticsView({ internships }: { internships: Internship[] }) {
  const stats = useMemo(() => {
    const byStatus = (s: Internship["status"]) =>
      internships.filter((i) => i.status === s);

    const applied = byStatus("applied");
    const interviewing = byStatus("interviewing");
    const offered = byStatus("offered");
    const accepted = byStatus("accepted");
    const rejected = byStatus("rejected");

    const totalApplications =
      applied.length +
      interviewing.length +
      offered.length +
      accepted.length +
      rejected.length;

    const responded =
      interviewing.length +
      offered.length +
      accepted.length +
      rejected.length;

    const responseRate = totalApplications > 0 ? responded / totalApplications : 0;

    const reachedInterview =
      interviewing.length + offered.length + accepted.length;
    const interviewRate =
      totalApplications > 0 ? reachedInterview / totalApplications : 0;

    const activePipeline =
      byStatus("wishlist").length + applied.length + interviewing.length;

    // Funnel counts: each stage includes everyone who reached it or beyond
    const funnelCounts: Record<string, number> = {
      applied: totalApplications,
      interviewing: reachedInterview,
      offered: offered.length + accepted.length,
      accepted: accepted.length,
    };

    // Track breakdown
    const tracks = new Map<string, Internship[]>();
    for (const i of internships) {
      const t = i.track || "Other";
      if (!tracks.has(t)) tracks.set(t, []);
      tracks.get(t)!.push(i);
    }

    // Timeline by month
    const months = new Map<string, number>();
    for (const i of internships) {
      const d = i.dateAdded;
      if (!d) continue;
      const key = d.slice(0, 7); // YYYY-MM
      months.set(key, (months.get(key) || 0) + 1);
    }
    const sortedMonths = [...months.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    const maxMonth = Math.max(1, ...sortedMonths.map(([, c]) => c));

    // Top companies
    const companies = new Map<string, Internship[]>();
    for (const i of internships) {
      if (!companies.has(i.company)) companies.set(i.company, []);
      companies.get(i.company)!.push(i);
    }
    const topCompanies = [...companies.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8);

    // Response time
    const responseDays: number[] = [];
    for (const i of internships) {
      if (i.dateApplied && i.statusLog && i.statusLog.length > 0) {
        const firstChange = i.statusLog
          .filter((l) => l.from === "applied" && l.to !== "applied")
          .sort((a, b) => a.date.localeCompare(b.date))[0];
        if (firstChange) {
          responseDays.push(daysBetween(i.dateApplied, firstChange.date));
        }
      }
    }
    const avgResponseDays =
      responseDays.length > 0
        ? Math.round(
            responseDays.reduce((a, b) => a + b, 0) / responseDays.length,
          )
        : null;

    return {
      totalApplications,
      responseRate,
      interviewRate,
      activePipeline,
      funnelCounts,
      tracks,
      sortedMonths,
      maxMonth,
      topCompanies,
      avgResponseDays,
      responseDays,
    };
  }, [internships]);

  return (
    <div className="space-y-8">
      {/* --- Summary Cards --- */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          label="Total Applications"
          value={stats.totalApplications}
          hint="Applied + beyond"
        />
        <SummaryCard
          label="Response Rate"
          value={pct(Math.round(stats.responseRate * 100), 100)}
          hint="Got a response"
        />
        <SummaryCard
          label="Interview Rate"
          value={pct(Math.round(stats.interviewRate * 100), 100)}
          hint="Reached interview+"
        />
        <SummaryCard
          label="Active Pipeline"
          value={stats.activePipeline}
          hint="Open + Applied + Interviewing"
        />
      </div>

      {/* --- Application Funnel --- */}
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Application Funnel</h3>
        {stats.totalApplications === 0 ? (
          <p className="text-sm text-muted">No applications yet.</p>
        ) : (
          <div className="space-y-3">
            {FUNNEL_STAGES.map((stage) => {
              const count = stats.funnelCounts[stage];
              const widthPct =
                stats.funnelCounts.applied > 0
                  ? (count / stats.funnelCounts.applied) * 100
                  : 0;
              const cfg = STATUS_CONFIG[stage];
              return (
                <div key={stage} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{cfg.label}</span>
                    <span>
                      {count} ({pct(count, stats.funnelCounts.applied)})
                    </span>
                  </div>
                  <div className="h-6 w-full overflow-hidden rounded-md bg-surface-hover">
                    <div
                      className={cn("h-full rounded-md transition-all", cfg.dot)}
                      style={{ width: `${Math.max(widthPct, 2)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* --- Track Breakdown --- */}
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Track Breakdown</h3>
        {stats.tracks.size === 0 ? (
          <p className="text-sm text-muted">No tracks assigned yet.</p>
        ) : (
          <div className="space-y-3">
            {[...stats.tracks.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([track, items]) => {
                const colorClass =
                  TRACK_COLORS[track] ||
                  "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400";
                return (
                  <div key={track} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Badge className={colorClass}>{track}</Badge>
                      <span className="text-xs tabular-nums text-muted">
                        {items.length}
                      </span>
                    </div>
                    <div className="flex gap-0.5">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          title={`${item.company} - ${STATUS_CONFIG[item.status].label}`}
                          className={cn(
                            "h-2.5 w-2.5 rounded-full",
                            STATUS_CONFIG[item.status].dot,
                          )}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {/* --- Timeline --- */}
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Applications Over Time</h3>
        {stats.sortedMonths.length === 0 ? (
          <p className="text-sm text-muted">No timeline data yet.</p>
        ) : (
          <div className="space-y-2">
            {stats.sortedMonths.map(([month, count]) => {
              const widthPct = (count / stats.maxMonth) * 100;
              return (
                <div key={month} className="flex items-center gap-3">
                  <span className="w-16 shrink-0 text-xs tabular-nums text-muted">
                    {month}
                  </span>
                  <div className="h-5 flex-1 overflow-hidden rounded-md bg-surface-hover">
                    <div
                      className="h-full rounded-md bg-sky-400 transition-all"
                      style={{ width: `${Math.max(widthPct, 3)}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* --- Top Companies --- */}
      <Card className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Top Companies</h3>
        {stats.topCompanies.length === 0 ? (
          <p className="text-sm text-muted">No companies yet.</p>
        ) : (
          <div className="space-y-2">
            {stats.topCompanies.map(([company, items]) => (
              <div
                key={company}
                className="flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="truncate text-sm text-foreground">
                    {company}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    ({items.length})
                  </span>
                </div>
                <div className="flex shrink-0 gap-1">
                  {items.map((item) => (
                    <Badge key={item.id} tone={STATUS_CONFIG[item.status].tone} className="text-[10px]">
                      {STATUS_CONFIG[item.status].label}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* --- Response Time --- */}
      <Card className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Response Time</h3>
        {stats.avgResponseDays !== null ? (
          <div>
            <div className="text-3xl font-semibold tabular-nums text-foreground">
              {stats.avgResponseDays}
              <span className="ml-1 text-base font-normal text-muted">days</span>
            </div>
            <p className="text-xs text-muted">
              Average time from application to first status change (
              {stats.responseDays.length} data point
              {stats.responseDays.length !== 1 ? "s" : ""})
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            No data yet. Response time is calculated from status log entries.
          </p>
        )}
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint: string;
}) {
  return (
    <Card className="space-y-1">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </div>
      <div className="text-xs text-faint">{hint}</div>
    </Card>
  );
}
