"use client";

import Link from "next/link";
import { AlertTriangle, Bookmark, BookmarkCheck, Check, ExternalLink, Loader2, X } from "lucide-react";
import type { InboxJob } from "@/lib/career-ops";
import type { AtsSource } from "@/lib/explore";
import { ATS_LABEL } from "@/lib/explore";
import { SENIORITY_LABEL, SENIORITY_ORDER, type Seniority } from "@/lib/inbox";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";

export type RowScore = { score: number | null; tone: "good" | "warn" | "bad" | "muted"; jobId: string; running: boolean };

function agoLabel(age: number | null): string | null {
  if (age == null) return null;
  if (age <= 0) return "today";
  if (age === 1) return "yesterday";
  if (age < 7) return `${age}d ago`;
  if (age < 30) return `${Math.floor(age / 7)}w ago`;
  return `${Math.floor(age / 30)}mo ago`;
}

// One raw posting in the triage list. Shows ONLY cheap, free signals + an honest
// "not scored" (CRUDA) — never a fake match%. Once its shortlist eval finishes it
// flips to EVALUADA (a real A–F badge). Save→shortlist / Skip→hidden are free + undoable.
export function TriageRow({
  job,
  source,
  age,
  seniority,
  eligibility,
  stack,
  targetSeniority,
  scored,
  selected,
  shortlisted,
  onToggleSelect,
  onSave,
  onSkip,
}: {
  job: InboxJob;
  source: AtsSource | null;
  age: number | null;
  seniority?: Seniority | null;
  eligibility?: "ok" | "warn" | null;
  stack?: string[];
  targetSeniority?: Seniority | null;
  scored?: RowScore;
  selected: boolean;
  shortlisted: boolean;
  onToggleSelect: () => void;
  onSave: () => void;
  onSkip: () => void;
}) {
  const ago = agoLabel(age);
  const evaluated = !!scored && (scored.running || scored.score != null);
  // Zero-token triage signals (never from an evaluation). Mismatch flags a role
  // scoped below the candidate's OWN target seniority (from config/profile.yml).
  const seniorityMismatch =
    !!seniority && !!targetSeniority && SENIORITY_ORDER.indexOf(seniority) > SENIORITY_ORDER.indexOf(targetSeniority);
  const stackHitList = stack ?? [];

  return (
    <li
      className={cn(
        "flex items-center gap-2.5 px-3 py-2.5 transition-colors sm:gap-3 sm:px-4",
        selected ? "bg-brand-soft/50" : "hover:bg-surface-hover",
        evaluated && "opacity-95",
      )}
    >
      {/* multi-select — power-user batch to shortlist */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        aria-label={`Select ${job.company} ${job.role}`}
        className="size-4 shrink-0 accent-brand max-sm:min-h-[44px] max-sm:min-w-[24px]"
      />

      <CompanyLogo name={job.company} size={20} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          <span className="font-medium text-foreground">{job.company}</span>
          <span className="text-muted"> · {job.role}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
          {job.location && (
            <span className="inline-flex items-center gap-0.5 truncate">
              {eligibility === "ok" && <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Likely eligible from your location" />}
              {eligibility === "warn" && <AlertTriangle className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-label="Location may not be eligible — verify" />}
              {job.location}
            </span>
          )}
          {job.compensation && (
            <span className="rounded bg-emerald-500/10 px-1 py-px font-medium text-emerald-700 dark:text-emerald-400">{job.compensation}</span>
          )}
          {seniority && (
            <span
              className={cn("rounded px-1 py-px font-medium", seniorityMismatch ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-surface-hover text-muted")}
              title={seniorityMismatch ? "Below your senior target — likely not worth a score" : undefined}
            >
              {SENIORITY_LABEL[seniority]}{seniorityMismatch ? " ⚠" : ""}
            </span>
          )}
          {source && <span className="rounded bg-surface-hover px-1 py-px font-medium text-muted">{ATS_LABEL[source]}</span>}
          {ago && <span>{ago}</span>}
          {stackHitList.length > 0 && (
            <span className="truncate font-medium text-brand" title={`Matches your target roles: ${stackHitList.join(", ")}`}>
              {stackHitList.slice(0, 3).join(" · ")}
            </span>
          )}
          {/* 🔴 CRUDA: honest "not scored" — no fabricated match%. */}
          {!evaluated && <span className="italic text-muted">not scored</span>}
        </p>
      </div>

      {/* Open the original posting — lets the user judge a raw row before spending an eval.
          Present on every row (evaluated or not); the report/worker link stays separate.
          Guard the scheme: pipeline.md is free text, so only ever render http(s) hrefs
          (never javascript:/data:), matching apply-view.tsx. */}
      {job.url && /^https?:\/\//.test(job.url) && (
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open the original posting"
          aria-label={`Open ${job.company} ${job.role} posting`}
          className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-brand max-sm:min-h-[44px] max-sm:min-w-[44px]"
        >
          <ExternalLink className="size-4" />
        </a>
      )}

      {/* EVALUADA state (right-aligned, visually distinct from raw rows) */}
      {evaluated ? (
        <Link href={`/jobs/${scored!.jobId}`} className="flex shrink-0 items-center gap-1.5 text-xs">
          {scored!.running ? (
            <>
              <Loader2 className="size-3.5 animate-spin text-brand" />
              <span className="text-brand max-sm:hidden">Scoring…</span>
            </>
          ) : (
            <Badge tone={scored!.tone}>{scored!.score}/5</Badge>
          )}
        </Link>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSave}
            title={shortlisted ? "In your shortlist" : "Save to shortlist"}
            aria-pressed={shortlisted}
            className={cn(
              "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px] max-sm:min-w-[44px]",
              shortlisted ? "text-brand" : "text-muted hover:bg-surface-hover hover:text-brand",
            )}
          >
            {shortlisted ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
            <span className="max-sm:hidden">{shortlisted ? "Saved" : "Save"}</span>
          </button>
          <button
            type="button"
            onClick={onSkip}
            title="Skip — hide from the inbox"
            className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </li>
  );
}
