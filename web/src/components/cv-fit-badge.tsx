"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { scoreTone } from "@/lib/format";
import type { CvJdFitResult } from "@/lib/cv-jd-fit";

type FitResponse = CvJdFitResult & { pdfReady?: boolean; evaluateScore?: string | null; error?: string };

export function CvFitBadge({
  report,
  company,
  pdfReady,
  refreshToken,
  className,
}: {
  report: string;
  company: string;
  pdfReady: boolean;
  /** Bust cache after a PDF job finishes (e.g. job.endedAt). */
  refreshToken?: number;
  className?: string;
}) {
  const [fit, setFit] = useState<FitResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pdfReady) {
      setFit(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const q = new URLSearchParams({ report, company });
    if (refreshToken) q.set("force", "1");
    fetch(`/api/cv-fit?${q}`)
      .then((r) => r.json())
      .then((data: FitResponse) => {
        if (!cancelled) setFit(data);
      })
      .catch(() => {
        if (!cancelled) setFit(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [report, company, pdfReady, refreshToken]);

  if (!pdfReady) return null;
  if (loading && !fit) {
    return <span className={`text-xs text-faint ${className ?? ""}`}>Scoring…</span>;
  }
  if (!fit?.fitScore && fit?.fitScore !== 0) {
    return (
      <span className={`text-xs text-faint ${className ?? ""}`} title="Could not score tailored CV vs JD">
        Fit —
      </span>
    );
  }

  const label = `${fit.fitScore}/5 fit`;
  const gapHint = fit.gaps?.length
    ? `JD keyword gaps: ${fit.gaps.slice(0, 6).join(", ")}${fit.gaps.length > 6 ? "…" : ""}`
    : "All extracted JD keywords found in tailored CV";
  const evalHint = fit.evaluateScore ? ` · Evaluate (master cv.md): ${fit.evaluateScore}` : "";
  const title = `Tailored CV vs JD · ${label} · ${fit.coveragePct}% keyword coverage · ${gapHint}${evalHint}`;

  return (
    <Badge tone={scoreTone(String(fit.fitScore))} className={className} title={title}>
      {label}
    </Badge>
  );
}
