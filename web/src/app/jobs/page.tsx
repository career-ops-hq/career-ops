"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Briefcase,
  Search,
  SlidersHorizontal,
  FileText,
  Star,
  ExternalLink,
  Layers,
  Sparkles,
  CheckCircle2,
  Trash2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { pillTone } from "@/components/jobs/worker-pills";
import { cn } from "@/lib/cn";

type JobEntry = {
  id: string;
  n: string;
  company: string;
  role: string;
  score: string;
  status: string;
  date: string;
  report: string;
  notes: string;
};

export default function JobsPage() {
  const { jobs, clearFinished } = useJobs();
  const [tab, setTab] = useState<"all" | "workers">("all");
  const [trackerJobs, setTrackerJobs] = useState<JobEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState("all");
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);

  useEffect(() => {
    async function loadJobs() {
      setLoading(true);
      try {
        const res = await fetch("/api/tracker");
        const data = await res.json();
        setTrackerJobs(data.applications || []);
      } catch {}
      finally {
        setLoading(false);
      }
    }
    loadJobs();
  }, []);

  const toggleCompare = (id: string) => {
    setSelectedForCompare((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : prev.length < 3 ? [...prev, id] : prev
    );
  };

  const filtered = trackerJobs.filter((j) => {
    const matchesSearch =
      j.company.toLowerCase().includes(search.toLowerCase()) ||
      j.role.toLowerCase().includes(search.toLowerCase());
    const scoreNum = parseFloat(j.score);
    const matchesScore =
      minScore === "all" || (!isNaN(scoreNum) && scoreNum >= parseFloat(minScore));
    return matchesSearch && matchesScore;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2.5">
            <Briefcase className="size-6 text-brand" />
            Job Evaluations & Explorer
          </h1>
          <p className="text-xs text-muted mt-1">
            Browse full A-H structured reports, compare role alignment, and review evaluation workers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surface p-1">
              <button
                onClick={() => setTab("all")}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  tab === "all" ? "bg-brand text-white" : "text-muted hover:text-foreground"
                }`}
              >
                Evaluated Jobs ({trackerJobs.length})
              </button>
              <button
                onClick={() => setTab("workers")}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  tab === "workers" ? "bg-brand text-white" : "text-muted hover:text-foreground"
                }`}
              >
              Active Workers ({jobs.length})
            </button>
          </div>
        </div>
      </div>

      {tab === "all" ? (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-2.5 size-4 text-faint" />
              <input
                type="text"
                placeholder="Search by company or role..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface pl-9 pr-4 py-2 text-xs text-foreground placeholder:text-muted focus:border-brand focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground focus:border-brand focus:outline-none"
              >
                <option value="all">All Scores</option>
                <option value="4.0">Score ≥ 4.0</option>
                <option value="3.5">Score ≥ 3.5</option>
                <option value="3.0">Score ≥ 3.0</option>
              </select>

              {selectedForCompare.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-brand-text">
                    Comparing ({selectedForCompare.length})
                  </span>
                  <button
                    onClick={() => setSelectedForCompare([])}
                    className="text-xs text-muted hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="p-12 text-center text-sm text-muted">Loading evaluations...</div>
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20">
              <Briefcase className="size-10 text-faint mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-foreground">No evaluated jobs match</h3>
              <p className="text-xs text-muted mt-1 max-w-sm mx-auto">
                Scan portals or paste job URLs in the Quick Evaluate console to generate A-H reports.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-surface/50 text-faint font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="px-4 py-3 w-8"></th>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Company & Role</th>
                    <th className="px-4 py-3">A-H Score</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">A-H Report</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((j) => {
                    const isComparing = selectedForCompare.includes(j.n);
                    return (
                      <tr
                        key={j.n}
                        className={`hover:bg-surface-hover/50 transition-colors ${
                          isComparing ? "bg-brand-soft/10" : ""
                        }`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={isComparing}
                            onChange={() => toggleCompare(j.n)}
                            className="rounded border-border accent-brand"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-faint">#{j.n}</td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-foreground">{j.company}</div>
                          <div className="text-muted text-[11px]">{j.role}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold text-brand-text bg-brand-soft border border-brand/30 px-2 py-0.5 rounded text-xs">
                            {j.score || "—"} / 5
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-surface-hover border border-border px-2 py-0.5 text-[10px] font-medium text-foreground capitalize">
                            {j.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-faint">{j.date || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/jobs/${j.n}`}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                          >
                            <FileText className="size-3.5" /> View Report
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Workers Tab */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">
              Live AI agent worker processes.
            </span>
            {jobs.some((j) => j.status !== "running") && (
              <button
                onClick={clearFinished}
                className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
              >
                <Trash2 className="size-3.5" /> Clear finished
              </button>
            )}
          </div>

          {jobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-12 text-center bg-surface/20 text-xs text-muted">
              No workers currently active.
            </div>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {jobs.map((j) => (
                <li key={j.id}>
                  <Link
                    href={`/jobs/${j.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                  >
                    {j.status === "running" ? (
                      <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
                    ) : j.status === "error" ? (
                      <AlertTriangle className="size-4 shrink-0 text-red-400" />
                    ) : (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{j.title}</div>
                      <div className="truncate text-xs text-muted">{j.subtitle || j.result?.summary}</div>
                    </div>
                    {j.result?.score != null && (
                      <span className="rounded bg-brand-soft border border-brand/30 px-2 py-0.5 text-xs font-bold text-brand-text">
                        {j.result.score}/5
                      </span>
                    )}
                    <span className="text-xs capitalize text-faint">{j.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
