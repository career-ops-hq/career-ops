"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanyLogo } from "@/components/company-logo";
import { scoreNum, scoreTone } from "@/lib/format";
import { companyPresentation } from "@/lib/company-presentation.mjs";
import { statusWriteError } from "@/lib/home/status-result.mjs";
import type { Application } from "@/lib/career-ops";
import type { CardReason } from "@/lib/machine-summary.mjs";

const DECISION_TONE: Record<string, string> = {
  Apply: "text-emerald-600 dark:text-emerald-400",
  Consider: "text-sky-600 dark:text-sky-400",
  "Research first": "text-amber-600 dark:text-amber-400",
  Skip: "text-muted",
};

// Awaiting-decision row: a scored role with no terminal status. Primary action
// opens the report (PDF + Apply live there). Skip / Applied still write status,
// and onDecided lets the parent offer an undo once the card is gone.
export function DecisionCard({ app, reason, onDecided }: { app: Application; reason?: CardReason; onDecided?: (status: "Applied" | "Discarded") => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "Applied" | "Discarded">("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedStatus, setFailedStatus] = useState<"Applied" | "Discarded" | null>(null);
  const submitting = useRef(false);
  const score = scoreNum(app.score);
  const tone = scoreTone(app.score);
  const company = companyPresentation(app);

  const setStatus = async (status: "Applied" | "Discarded") => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(status);
    setError(null);
    setFailedStatus(null);
    try {
      const response = await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: app.n, status }) });
      const result = await response.json().catch(() => null);
      const failure = statusWriteError(response.ok, result, status);
      if (failure) {
        setError(failure);
        setFailedStatus(status);
        return;
      }
      setDone(status);
      onDecided?.(status);
      router.refresh();
    } catch {
      setError("Could not confirm the change. Check your connection and pipeline, then retry.");
      setFailedStatus(status);
    } finally {
      submitting.current = false;
      setBusy("");
    }
  };

  if (done) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface/40 p-3.5 transition hover:border-brand/30">
      <div className="flex items-start gap-2.5">
        <CompanyLogo name={company.logoName} size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{company.label}</p>
          <p className="truncate text-[13px] text-muted">{app.role}</p>
        </div>
        {Number.isFinite(score) && score > 0 && (
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
              tone === "good" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-surface-hover text-muted",
            )}
          >
            {app.score}
          </span>
        )}
      </div>
      {reason && (
        <div data-testid="card-reason" className="space-y-0.5 text-xs leading-snug">
          {reason.decision && <p className={cn("font-medium", DECISION_TONE[reason.decision] ?? "text-muted")}>{reason.decision}</p>}
          {reason.plus && <p className="line-clamp-1 text-muted"><span className="text-emerald-600 dark:text-emerald-400">+</span> {reason.plus}</p>}
          {reason.minus && <p className="line-clamp-1 text-muted"><span className="text-red-600 dark:text-red-400">−</span> {reason.minus}</p>}
        </div>
      )}
      <div className="flex items-center gap-2">
        {/* Primary is the report (PDF + Apply live there). Marking Applied from
            Today skipped that path and wrote a status with no application. */}
        <Link
          href={`/pipeline/${app.n}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand-text transition hover:bg-brand/15 max-sm:min-h-[44px]"
        >
          <FileText className="size-3.5" /> Review
        </Link>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setStatus("Discarded")}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-60 max-sm:min-h-[44px] max-sm:px-4"
        >
          {busy === "Discarded" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Skip
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setStatus("Applied")}
          title="Record Applied without opening the apply flow"
          className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-faint transition hover:text-foreground disabled:opacity-60 max-sm:min-h-[44px]"
        >
          {busy === "Applied" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Applied
        </button>
      </div>
      {error && (
        <div role="alert" className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400">
          <p className="min-w-0 flex-1">{error}</p>
          {failedStatus && <button type="button" disabled={!!busy} onClick={() => setStatus(failedStatus)} className="shrink-0 underline disabled:opacity-60 max-sm:min-h-[44px]">Retry</button>}
        </div>
      )}
    </div>
  );
}
