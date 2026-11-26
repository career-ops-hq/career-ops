import { memo, useEffect, useState, type MouseEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Application } from "@/lib/career-ops";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { parseReport } from "@/lib/format";
import { applicationKey } from "@/lib/pipeline-status.mjs";

const loadingReport = <p role="status" className="text-sm text-muted">Loading report…</p>;
// Keep the loading state inside the pane so the tracker stays mounted.
const ReportMarkdown = dynamic(() => import("@/components/report-markdown").then((m) => m.ReportMarkdown), {
  loading: () => loadingReport,
});
const buttonClass = "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-50";

type ReportResult = { markdown: string | null } | { problem: "changed" | "load" };

const ReviewReport = memo(function ReviewReport({ id, expectedKey }: { id: string; expectedKey: string }) {
  const [result, setResult] = useState<ReportResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      let next: ReportResult;
      try {
        const response = await fetch(`/api/pipeline/report?id=${encodeURIComponent(id)}`, {
          signal: controller.signal,
        });
        if (response.status === 404) next = { problem: "changed" };
        else if (!response.ok) next = { problem: "load" };
        else {
          const data: { key: string; markdown: string | null } = await response.json();
          // The tracker number may have been reused since the list was rendered.
          next = data.key === expectedKey ? { markdown: data.markdown } : { problem: "changed" };
        }
      } catch {
        next = { problem: "load" };
      }
      if (!controller.signal.aborted) setResult(next);
    }
    void load();
    return () => controller.abort();
  }, [id, expectedKey, attempt]);

  return (
    <div role="region" aria-label="Report content" tabIndex={0} className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40">
      {!result ? (
        loadingReport
      ) : "problem" in result ? (
        result.problem === "changed" ? (
          <p role="alert" className="text-sm text-muted">This application changed. Refresh the pipeline to review it.</p>
        ) : (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-muted">Could not load this report.</p>
            <button type="button" className={buttonClass} onClick={() => { setResult(null); setAttempt((n) => n + 1); }}>
              Retry
            </button>
          </div>
        )
      ) : result.markdown !== null ? (
        <article className="report-prose">
          <ReportMarkdown>{parseReport(result.markdown).body}</ReportMarkdown>
        </article>
      ) : (
        <p className="text-sm text-muted">There is no report for this application yet.</p>
      )}
    </div>
  );
});

export function PipelineReview({ app, index, count, pending, fullHref, onFullReport, onStep, onClose }: {
  app: Application | undefined;
  index: number;
  count: number;
  pending: boolean;
  fullHref: string;
  onFullReport: (event: MouseEvent<HTMLAnchorElement>, n: string) => void;
  onStep: (delta: -1 | 1) => void;
  onClose: () => void;
}) {
  const key = app ? applicationKey(app) : null;
  return (
    <aside id="pipeline-report-review" aria-label="Report review" className="sticky top-4 mt-4 hidden h-[calc(100dvh-2rem)] min-w-0 flex-col self-start overflow-hidden rounded-2xl border border-border bg-surface/40 xl:flex">
      <div className="shrink-0 border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs tabular-nums text-faint">{app ? `${index + 1} of ${count}` : "Report review"}</p>
            {app && (
              <>
                <h2 className="mt-1 break-words font-display text-xl text-landing">{companyPresentation(app).label}</h2>
                <p className="break-words text-sm text-muted">{app.role}</p>
              </>
            )}
          </div>
          <button type="button" aria-label="Close report review" onClick={onClose} className={buttonClass}>
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
        {app && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass} disabled={pending || index === 0} onClick={() => onStep(-1)}>
              <ChevronLeft aria-hidden="true" className="size-4" /> Previous
            </button>
            <button type="button" className={buttonClass} disabled={pending || index === count - 1} onClick={() => onStep(1)}>
              Next <ChevronRight aria-hidden="true" className="size-4" />
            </button>
            <Link className="text-sm text-brand-text hover:underline" href={fullHref} prefetch={false} onClick={(event) => onFullReport(event, app.n)}>
              Open full report
            </Link>
          </div>
        )}
      </div>
      {app && key !== null ? (
        <ReviewReport key={key} id={app.n} expectedKey={key} />
      ) : (
        <p className="p-4 text-sm text-muted">{count ? "Choose an application from the list." : "No applications match this view."}</p>
      )}
    </aside>
  );
}
