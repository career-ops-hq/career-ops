"use client";

import { useEffect, useState } from "react";
import { Check, X, Loader2, AlertTriangle } from "lucide-react";
import type { Job } from "@/components/jobs/job-store";
import { cn } from "@/lib/cn";

// Humanize raw agent tool names into what the user actually cares about, so a
// multi-minute evaluation reads as progress instead of a cryptic tool dump (#8).
const STEP_LABELS: Record<string, string> = {
  WebFetch: "Reading the posting",
  WebSearch: "Searching the web",
  Read: "Reading your CV & profile",
  Glob: "Looking through your files",
  Grep: "Looking through your files",
  Write: "Writing the report",
  Edit: "Updating the report",
  NotebookEdit: "Updating the report",
  Bash: "Saving to your tracker",
  TodoWrite: "Planning the steps",
  Task: "Working",
};
const humanizeStep = (label: string): string => STEP_LABELS[label] ?? label;

// Auth/sign-in failures are the most common real error — detect them so we can give
// a concrete next step instead of a dead end (#8).
function isAuthError(job: Job): boolean {
  if (job.status !== "error") return false;
  const hay = `${job.steps[job.steps.length - 1]?.label ?? ""} ${job.text}`.toLowerCase();
  return /auth|login|sign[ -]?in|credential|api[ -]?key|unauthorized|not authenticated|installed and authenticated/.test(hay);
}

const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

// Tick once a second WHILE running so a long evaluation visibly counts up (never
// looks frozen). Stops re-rendering as soon as the job settles.
function useElapsed(running: boolean, startedAt: number): number {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, startedAt]);
  return Math.max(0, now - startedAt);
}

// The ONE worker card — a pure function of a Job. Rendered in three surfaces:
// the sidebar tray (variant="tray", inside WorkerPills' Link), inline in the
// assistant chat (variant="inline"), and conceptually the /jobs/[id] timeline.
// Keeping it single is what guarantees the human UI and the agentic UI stay
// visually identical. TONE + pillTone live here (the canonical source).

export const TONE = {
  good: { bar: "bg-emerald-500/70", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", icon: "text-emerald-500" },
  warn: { bar: "bg-amber-500/70", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400", icon: "text-amber-500" },
  bad: { bar: "bg-red-400/70", chip: "bg-red-500/15 text-red-700 dark:text-red-400", icon: "text-red-400" },
  muted: { bar: "bg-zinc-400/50", chip: "bg-surface-hover text-muted", icon: "text-zinc-400" },
} as const;

export function pillTone(j: Job): keyof typeof TONE {
  if (j.status === "error") return "bad";
  if (j.status === "done") return j.result?.tone ?? "muted";
  return "muted";
}

export function WorkerCard({
  job,
  variant = "tray",
  trailing,
}: {
  job: Job;
  variant?: "tray" | "inline";
  trailing?: React.ReactNode;
}) {
  const tone = TONE[pillTone(job)];
  const running = job.status === "running";
  const elapsed = useElapsed(running, job.startedAt);
  const rawLast = job.steps[job.steps.length - 1]?.label;
  const last = rawLast ? humanizeStep(rawLast) : undefined;
  const bottom = job.status === "done" && job.result?.summary ? job.result.summary : last;
  const inline = variant === "inline";
  const hasScore = job.result?.score != null;
  const authError = isAuthError(job);
  const tokens = job.status === "done" ? job.cost?.tokens ?? 0 : 0;

  return (
    <div className={cn(inline && "rounded-xl border border-border bg-surface/60 p-2.5")}>
      <div className="flex items-center gap-2">
        {job.status === "running" ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-brand" />
        ) : job.status === "error" ? (
          <AlertTriangle className={cn("size-3 shrink-0", tone.icon)} />
        ) : (
          <Check className={cn("size-3 shrink-0", tone.icon)} />
        )}
        <span className={cn("truncate font-medium", inline ? "text-sm" : "text-xs")}>{job.title}</span>
        {hasScore && (
          <span
            className={cn(
              "ml-auto shrink-0 rounded px-1 py-0.5 font-semibold tabular-nums",
              inline ? "text-xs" : "text-[10px]",
              tone.chip,
            )}
          >
            {job.result!.score}
          </span>
        )}
        {trailing != null && (
          <span className={cn("shrink-0", hasScore ? "ml-1" : "ml-auto")}>{trailing}</span>
        )}
      </div>
      <div className={cn("mt-1.5 w-full overflow-hidden rounded-full bg-surface-hover", inline ? "h-1.5" : "h-1")}>
        {job.status === "running" ? (
          <div className="job-indeterminate h-full w-full" />
        ) : (
          <div className={cn("h-full w-full rounded-full", tone.bar)} />
        )}
      </div>
      {(bottom || running) && (
        <div className={cn("mt-1 truncate text-faint", inline ? "text-xs" : "text-[10px]")}>
          {running ? `${last ?? "Working"} · ${fmtElapsed(elapsed)}` : bottom}
        </div>
      )}
      {authError && (
        <div className={cn("mt-1 text-amber-700 dark:text-amber-400", inline ? "text-xs" : "text-[10px]")}>
          Sign your CLI in from Config, then re-run.
        </div>
      )}
      {tokens > 0 && (
        <div className={cn("mt-1 text-faint tabular-nums", inline ? "text-xs" : "text-[10px]")}>
          {fmtTokens(tokens)} tokens{job.cost?.usd != null ? ` · $${job.cost.usd.toFixed(2)}` : ""}
        </div>
      )}
    </div>
  );
}

// Re-exported icon used by callers that compose their own trailing affordances.
export { X as DismissIcon };
