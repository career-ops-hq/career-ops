"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileDown, Loader2, FileText, RotateCcw } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";

// Fires the career-ops `cover` worker to generate a tailored cover letter PDF
// (JSON -> reportlab, same lightweight path as CV JSON rendering).
export function GenerateCoverLetterButton({ n, company }: { n: string; company: string }) {
  const { jobs, startJob } = useJobs();
  const job = useMemo(
    () => jobs.filter((j) => j.kind === "cover" && j.input === n).sort((a, b) => b.startedAt - a.startedAt)[0],
    [jobs, n],
  );
  const generate = () =>
    startJob({
      title: `Cover letter · ${company}`,
      subtitle: "tailored for this role",
      kind: "cover",
      input: n,
      page: `/pipeline/${n}`,
    });

  if (job?.status === "running")
    return (
      <Link href={`/jobs/${job.id}`} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-3 py-1 text-xs font-medium text-brand max-sm:min-h-[44px]">
        <Loader2 className="size-3.5 animate-spin" /> Generating cover letter…
      </Link>
    );

  const ready = job?.status === "done";
  if (ready)
    return (
      <span className="inline-flex items-center gap-1">
        <a
          href={`/api/cover-pdf?company=${encodeURIComponent(company)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-500/15 dark:text-emerald-400 max-sm:min-h-[44px]"
        >
          <FileText className="size-3.5" /> View cover letter
        </a>
        <button
          onClick={generate}
          title="Regenerate cover letter"
          className="inline-flex items-center justify-center rounded-full p-1 text-faint transition-colors hover:text-brand max-sm:min-h-[44px] max-sm:min-w-[44px]"
        >
          <RotateCcw className="size-3" />
        </button>
      </span>
    );

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={generate}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        title="Generate a tailored cover letter PDF for this role"
      >
        <FileDown className="size-3.5" /> Generate cover letter
      </button>
      <CostBadge kind="spend" size="xs" />
    </span>
  );
}
