"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileDown, Loader2, FileText, RotateCcw, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { pdfButtonState, type PdfFailure } from "@/lib/pdf-button-state.mjs";

// Fires the real career-ops `pdf` mode (worker kind "pdf") to generate an
// ATS-optimized CV tailored to THIS offer → output/cv-… + marks the tracker.
// Once a tailored CV exists (tracker PDF ✅, or a pdf worker just finished), it
// becomes a "View tailored CV" link (served by /api/cv-pdf) + a regenerate icon.
export function GeneratePdfButton({ n, company, pdfReady }: { n: string; company: string; pdfReady: boolean }) {
  const { jobs, startJob } = useJobs();
  const job = useMemo(
    () => jobs.filter((j) => j.kind === "pdf" && j.input === n).sort((a, b) => b.startedAt - a.startedAt)[0],
    [jobs, n],
  );
  const generate = () =>
    startJob({ title: `CV PDF · ${company}`, subtitle: "tailored for this role", kind: "pdf", input: n, page: `/pipeline/${n}` });

  const state = pdfButtonState(job, pdfReady);

  if (state.kind === "running")
    return (
      <Link href={`/jobs/${state.jobId}`} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3 py-1 text-xs font-medium text-brand max-sm:min-h-[44px]">
        <Loader2 className="size-3.5 animate-spin" /> Generating CV…
      </Link>
    );

  if (state.kind === "ready")
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <a
          href={`/api/cv-pdf?n=${encodeURIComponent(n)}&company=${encodeURIComponent(company)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400 max-sm:min-h-[44px]"
        >
          <FileText className="size-3.5" /> View tailored CV
        </a>
        <Link
          href={`/pipeline/${encodeURIComponent(n)}/cv-studio`}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft/70 max-sm:min-h-[44px]"
        >
          <SlidersHorizontal className="size-3.5" /> Review and customize
        </Link>
        <button
          onClick={generate}
          title="Regenerate the tailored CV"
          className="inline-flex items-center justify-center rounded-full p-1 text-faint transition-colors hover:text-brand max-sm:min-h-[44px] max-sm:min-w-[44px]"
        >
          <RotateCcw className="size-3" />
        </button>
        <FailureNote failure={state.failure} />
      </span>
    );

  // Point-of-action cost affordance: generating a tailored CV runs the user's
  // AI (spends tokens). Surface it right on the trigger so cost is never a
  // surprise — the community's #1 pain (mirrors Explore's token-honesty).
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <button
        onClick={generate}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        title="Generate an ATS-optimized CV tailored to this role"
      >
        <FileDown className="size-3.5" /> Generate tailored CV (PDF)
      </button>
      <CostBadge kind="spend" size="xs" />
      <FailureNote failure={state.failure} />
    </span>
  );
}

function FailureNote({ failure }: { failure: PdfFailure }) {
  if (!failure) return null;
  return (
    <Link
      href={`/jobs/${failure.jobId}`}
      role="alert"
      title="Open the run log"
      className="inline-flex max-w-md items-start gap-1 text-xs text-red-700 hover:underline dark:text-red-400"
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>CV not generated. {failure.reason}</span>
    </Link>
  );
}
