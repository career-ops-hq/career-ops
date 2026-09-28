"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Kanban, Table, Calendar, Search, ExternalLink, FileText, Plus, ShieldCheck, ArrowRight } from "lucide-react";

type Application = {
  n: string;
  date: string;
  company: string;
  via: string;
  role: string;
  score: string;
  status: string;
  pdf: string;
  report: string;
  notes: string;
};

const STAGES = [
  "Evaluated",
  "Applied",
  "Responded",
  "Interview",
  "Offer",
  "Rejected",
  "Discarded",
  "SKIP",
  "Hired",
];

export default function TrackerPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"table" | "kanban" | "timeline">("table");
  const [search, setSearch] = useState("");
  const [updatingN, setUpdatingN] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const fetchTracker = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tracker");
      const data = await res.json();
      setApps(data.applications || []);
    } catch {}
    finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracker();
  }, []);

  const handleStatusChange = async (n: string, newStatus: string) => {
    setUpdatingN(n);
    setStatusError(null);
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatusError(data.error || `Failed to update status (${res.status})`);
        return;
      }
      await fetchTracker();
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdatingN(null);
    }
  };

  const filtered = apps.filter(
    (a) =>
      a.company.toLowerCase().includes(search.toLowerCase()) ||
      a.role.toLowerCase().includes(search.toLowerCase()) ||
      a.notes.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Kanban className="size-6 text-brand" />
            Applications Tracker
          </h1>
          <p className="text-xs text-muted mt-1">
            Canonical application lifecycle records from <code className="text-[11px] font-mono bg-surface-hover px-1 py-0.5 rounded">data/applications.md</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surface p-1">
              <button
                onClick={() => setView("table")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  view === "table" ? "bg-brand text-white" : "text-muted hover:text-foreground"
                }`}
              >
                <Table className="size-3.5" /> Table
              </button>
              <button
                onClick={() => setView("kanban")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  view === "kanban" ? "bg-brand text-white" : "text-muted hover:text-foreground"
                }`}
              >
                <Kanban className="size-3.5" /> Kanban
              </button>
              <button
                onClick={() => setView("timeline")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  view === "timeline" ? "bg-brand text-white" : "text-muted hover:text-foreground"
                }`}
              >
                <Calendar className="size-3.5" /> Timeline
              </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-2.5 size-4 text-faint" />
        <input
          type="text"
          placeholder="Search applications by company, role, or notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border bg-surface pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-none"
        />
      </div>

      {statusError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          {statusError}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-sm text-muted">Loading application tracker...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
          <Kanban className="size-10 text-faint mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No applications found</h3>
          <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
            Process jobs in your Pipeline to create application records in your tracker.
          </p>
        </div>
      ) : view === "table" ? (
        /* TABLE VIEW */
        <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface/50 text-faint font-semibold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Company & Role</th>
                <th className="px-4 py-3">Applied Date</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((app) => (
                <tr key={app.n} className="hover:bg-surface-hover/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-faint">#{app.n}</td>
                  <td className="px-4 py-3">
                    <div className="font-bold text-foreground">{app.company}</div>
                    <div className="text-muted text-[11px]">{app.role}</div>
                  </td>
                  <td className="px-4 py-3 text-faint">{app.date || "—"}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-brand-text">
                    {app.score || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={app.status}
                      disabled={updatingN === app.n}
                      onChange={(e) => handleStatusChange(app.n, e.target.value)}
                      className="rounded bg-surface-hover border border-border px-2 py-1 text-xs text-foreground focus:border-brand focus:outline-none capitalize"
                    >
                      {STAGES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-faint max-w-xs truncate">{app.notes || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/pipeline/${app.n}`}
                      className="inline-flex items-center gap-1 text-[11px] text-brand hover:underline font-medium"
                    >
                      <FileText className="size-3.5" /> View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view === "kanban" ? (
        /* KANBAN VIEW */
        <div className="flex gap-4 overflow-x-auto pb-6">
          {STAGES.map((stage) => {
            const stageApps = filtered.filter(
              (a) => a.status.toLowerCase() === stage.toLowerCase()
            );
            return (
              <div
                key={stage}
                className="w-72 shrink-0 rounded-xl border border-border bg-surface/50 p-3 space-y-3 flex flex-col"
              >
                <div className="flex items-center justify-between px-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-foreground">
                    {stage}
                  </div>
                  <span className="rounded-full bg-surface-hover border border-border px-2 py-0.5 text-[10px] font-bold text-muted">
                    {stageApps.length}
                  </span>
                </div>

                <div className="space-y-2 flex-1 overflow-y-auto max-h-[70vh] pr-0.5">
                  {stageApps.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border/60 p-4 text-center text-[11px] text-faint">
                      Empty
                    </div>
                  ) : (
                    stageApps.map((app) => (
                      <div
                        key={app.n}
                        className="rounded-lg border border-border bg-surface p-3 space-y-2 shadow-sm hover:border-brand/40 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-xs text-foreground">{app.company}</div>
                          <span className="text-[10px] font-mono text-faint">#{app.n}</span>
                        </div>
                        <div className="text-[11px] text-muted">{app.role}</div>
                        {app.notes && (
                          <div className="text-[10px] text-faint bg-surface-hover/40 p-1.5 rounded">
                            {app.notes}
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px]">
                          <span className="text-brand-text font-bold">Score: {app.score || "—"}</span>
                          <Link href={`/jobs/${app.n}`} className="text-brand hover:underline">
                            Report →
                          </Link>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TIMELINE VIEW */
        <div className="space-y-4">
          {filtered.map((app) => (
            <div
              key={app.n}
              className="rounded-xl border border-border bg-surface p-4 flex items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand-text font-bold text-xs">
                  #{app.n}
                </div>
                <div>
                  <div className="font-bold text-sm text-foreground">{app.company}</div>
                  <div className="text-xs text-muted">{app.role}</div>
                  <div className="text-[11px] text-faint mt-0.5">Applied on {app.date || "Unknown Date"}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="rounded-full bg-surface-hover border border-border px-3 py-1 text-xs font-semibold text-foreground capitalize">
                  {app.status}
                </span>
                <Link
                  href={`/jobs/${app.n}`}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  View Details
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
