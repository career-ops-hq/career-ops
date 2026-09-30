"use client";

import { useEffect, useState } from "react";
import { Check, X, Loader2, AlertTriangle, RotateCcw } from "lucide-react";
import type { Job } from "@/components/jobs/job-store";
import { Badge } from "@/components/ui/badge";
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
// Require an explicit auth-failure phrase. Bare `auth` matches "author",
// research prose, etc., and used to show "Sign your CLI…" on healthy runs.
function isAuthError(job: Job): boolean {
  if (job.status !== "error") return false;
  const hay = `${job.steps[job.steps.length - 1]?.label ?? ""} ${job.text}`.toLowerCase();
  return /not authenticated|authentication failed|failed to authenticate|unauthorized|sign[ -]?in|login failed|invalid api[ -]?key|no cli configured|installed and authenticated|fcc-server|proxy is not reachable/.test(hay);
}

function isFccProxyError(job: Job): boolean {
  if (job.status !== "error") return false;
  const hay = `${job.steps[job.steps.length - 1]?.label ?? ""} ${job.text}`.toLowerCase();
  return /fcc-server|proxy is not reachable/.test(hay);
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

/**
 * Gate 3 telemetry badge — SHARED by WorkerCard and /jobs/[id].
 *
 * Why one exported helper rather than the badge being inlined twice: WorkerCard
 * is deliberately the single card so the sidebar and the assistant chat cannot
 * drift apart (see the note above), and the /jobs/[id] timeline does its own
 * markup. Routing both through here is what keeps the third surface honest.
 *
 * halt is `warn`, NOT `bad`: `bad` already means job.status === "error" — a run
 * that produced nothing. A halt is an audit finding on a run that SUCCEEDED, and
 * painting it the same red as a crash teaches people to ignore it. `unavailable`
 * is `muted`, which is also the honest read: the gate could not answer, so we say
 * so rather than implying either outcome.
 */
export function gate3Badge(job: Job, size: "sm" | "xs" = "sm") {
  const g = job.gate3;
  if (!g || !g.decision) return null;

  const tone = g.decision === "pass" ? "good" : g.decision === "halt" ? "warn" : "muted";
  const detail = (g.reasons?.length ? g.reasons.join("; ") : g.reason || "").trim();

  // The gate reports machine tokens (EMPTY_OR_BLOCKED_JD_CAPTURE, …). Internal
  // identifiers don't belong on a card, so the visible string is humanized and
  // the raw value is kept in the tooltip for anyone who needs to grep the log.
  const REASON_LABELS: Record<string, string> = {
    EMPTY_OR_BLOCKED_JD_CAPTURE: "no JD captured",
    BROWSER_EXTRACT_SUBPROCESS_FAILURE: "capture failed",
    NO_LOCAL_JD: "no local JD",
    NO_TAILORED_PAYLOAD: "no tailored CV",
    LINTER_SUBPROCESS_FALLBACK: "gate unavailable",
    LINTER_REPORTED_UNAVAILABLE: "gate unavailable",
    UNPARSEABLE_LINTER_OUTPUT: "gate unavailable",
  };
  const human = REASON_LABELS[detail] || detail.replace(/_/g, " ").toLowerCase();

  const label =
    g.decision === "pass"
      ? "Gate 3: Pass"
      : g.decision === "halt"
        ? `Gate 3: Halt${human ? ` — ${human}` : ""}`
        : `Gate 3: Unaudited${human ? ` (${human})` : ""}`;

  return (
    <span className={cn("mt-1 block truncate", size === "sm" ? "text-xs" : "text-[10px]")}>
      <Badge tone={tone} className="font-medium" title={detail || undefined}>
        {label}
      </Badge>
    </span>
  );
}

export function WorkerCard({
  job,
  variant = "tray",
  trailing,
  onRetry,
}: {
  job: Job;
  variant?: "tray" | "inline";
  trailing?: React.ReactNode;
  onRetry?: () => void;
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
  const fccProxyError = isFccProxyError(job);
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
      {fccProxyError && (
        <div className={cn("mt-1 text-amber-700 dark:text-amber-400", inline ? "text-xs" : "text-[10px]")}>
          Start <code className="font-mono">fcc-server</code> in a terminal, then re-run.
        </div>
      )}
      {authError && !fccProxyError && (
        <div className={cn("mt-1 text-amber-700 dark:text-amber-400", inline ? "text-xs" : "text-[10px]")}>
          Sign your CLI in from Config, then re-run.
        </div>
      )}
      {job.status === "error" && onRetry && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRetry();
          }}
          className={cn(
            "mt-2 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand",
            inline ? "text-xs" : "text-[10px]",
          )}
        >
          <RotateCcw className="size-3" /> Retry
        </button>
      )}
      {tokens > 0 && (
        <div className={cn("mt-1 text-faint tabular-nums", inline ? "text-xs" : "text-[10px]")}>
          {fmtTokens(tokens)} tokens{job.cost?.usd != null ? ` · $${job.cost.usd.toFixed(2)}` : ""}
        </div>
      )}
      {/* Footer, not the header row: line ~125 pushes the trailing affordance
          right with an unconditional ml-auto, so a badge in the header flex
          would displace the score chip. */}
      {gate3Badge(job, inline ? "sm" : "xs")}
    </div>
  );
}

// Re-exported icon used by callers that compose their own trailing affordances.
export { X as DismissIcon };
