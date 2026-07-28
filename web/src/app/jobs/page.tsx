"use client";

import Link from "next/link";
import { Check, AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { pillTone } from "@/components/jobs/worker-pills";
import { cn } from "@/lib/cn";

const TONE_CHIP = {
  good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  bad: "bg-red-500/15 text-red-700 dark:text-red-400",
  muted: "bg-surface-hover text-muted",
} as const;

export default function JobsHistory() {
  const { jobs, clearFinished } = useJobs();

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">Workers</h1>
          <p className="mt-1 text-sm text-muted">
            Every evaluation you ran — a persistent log. <span className="tabular-nums">{jobs.length}</span> total.
          </p>
        </div>
        {jobs.some((j) => j.status !== "running") && (
          <button
            onClick={clearFinished}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <Trash2 className="size-3.5" /> Clear finished
          </button>
        )}
      </div>

      {jobs.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-12 text-center text-sm text-muted">
          No workers yet. Hit <span className="text-foreground">Evaluate</span> on an inbox posting to spin one up.
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
          {jobs.map((j) => {
            const tone = pillTone(j);
            return (
              <li key={j.id}>
                <Link href={`/jobs/${j.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover">
                  {j.status === "running" ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
                  ) : j.status === "error" ? (
                    <AlertTriangle className="size-4 shrink-0 text-red-400" />
                  ) : (
                    <Check className="size-4 shrink-0 text-emerald-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{j.title}</div>
                    {(j.subtitle || j.result?.summary) && (
                      <div className="truncate text-xs text-muted">{j.result?.summary || j.subtitle}</div>
                    )}
                  </div>
                  {j.result?.score != null && (
                    <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", TONE_CHIP[tone])}>
                      {j.result.score}/5
                    </span>
                  )}
                  <span className="hidden shrink-0 text-xs capitalize text-faint sm:block">{j.status}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
