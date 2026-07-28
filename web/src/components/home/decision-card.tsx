"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanyLogo } from "@/components/company-logo";
import { scoreNum, scoreTone } from "@/lib/format";
import type { Application } from "@/lib/career-ops";

// Awaiting-decision row: a scored role with no terminal status. One-tap Apply /
// Skip writes back through the EXISTING /api/status (UPDATE-only, canonical states).
export function DecisionCard({ app }: { app: Application }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "Applied" | "Discarded">("");
  const [done, setDone] = useState<string | null>(null);
  const score = scoreNum(app.score);
  const tone = scoreTone(app.score);

  const setStatus = async (status: "Applied" | "Discarded") => {
    setBusy(status);
    try {
      await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: app.n, status }) });
      setDone(status);
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy("");
    }
  };

  if (done) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface/40 p-3.5 transition hover:border-brand/30">
      <div className="flex items-start gap-2.5">
        <CompanyLogo name={app.company} size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{app.company}</p>
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
      <div className="flex items-center gap-2">
        {/* brand-soft AT REST (not a solid fill, not hover-only): a calm-but-
            affirmative primary — a queue of these reads as gentle brand, not 6
            solid shouts (P5), while staying visibly the positive action next to
            the neutral Skip even on touch (no hover). */}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setStatus("Applied")}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand-text transition hover:bg-brand/15 disabled:opacity-60 max-sm:min-h-[44px]"
        >
          {busy === "Applied" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Mark applied
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setStatus("Discarded")}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-60 max-sm:min-h-[44px] max-sm:px-4"
        >
          {busy === "Discarded" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Skip
        </button>
        <a href={`/pipeline/${app.n}`} title="Open report" aria-label="Open report" className="inline-flex shrink-0 items-center justify-center rounded p-1.5 text-faint transition hover:text-brand max-sm:min-h-[44px] max-sm:min-w-[44px]">
          <FileText className="size-4" />
        </a>
      </div>
    </div>
  );
}
