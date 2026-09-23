"use client";

import Link from "next/link";
import { FileDown, FileText, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { CvFitBadge } from "@/components/cv-fit-badge";
import { cn } from "@/lib/cn";

// Pipeline table CV column: generate button OR fit score + view link.
export function CvPipelineCell({
  n,
  company,
  pdfReady,
}: {
  n: string;
  company: string;
  pdfReady: boolean;
}) {
  const { jobs, startJob } = useJobs();
  const job = useMemo(
    () => jobs.filter((j) => j.kind === "pdf" && j.input === n).sort((a, b) => b.startedAt - a.startedAt)[0],
    [jobs, n],
  );

  const generate = () =>
    startJob({
      title: `CV PDF · ${company}`,
      subtitle: "tailored for this role",
      kind: "pdf",
      input: n,
      page: `/pipeline/${n}`,
    });

  const ready = pdfReady || job?.status === "done";

  if (job?.status === "running") {
    return (
      <Link
        href={`/jobs/${job.id}`}
        className="inline-flex items-center gap-1 text-xs text-brand"
        onClick={(e) => e.stopPropagation()}
      >
        <Loader2 className="size-3 animate-spin" /> Generating…
      </Link>
    );
  }

  if (!ready) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={generate}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted",
            "transition-colors hover:border-brand/40 hover:text-brand",
          )}
          title="Generate tailored CV PDF"
        >
          <FileDown className="size-3" /> Generate CV
        </button>
        <CostBadge kind="spend" size="xs" />
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <CvFitBadge
        report={n}
        company={company}
        pdfReady={ready}
        refreshToken={job?.status === "done" ? job.endedAt : undefined}
      />
      <a
        href={`/api/cv-pdf?company=${encodeURIComponent(company)}&report=${encodeURIComponent(n)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline dark:text-emerald-400"
        title="Open tailored CV PDF"
      >
        <FileText className="size-3" /> PDF
      </a>
    </span>
  );
}
