"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

const PILL =
  "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px] disabled:cursor-not-allowed disabled:opacity-60";

export function MarkPdfReadyButton({
  reportNum,
  ready = false,
}: {
  reportNum: number | null;
  ready?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (reportNum == null) return null;

  async function mark() {
    if (busy || ready || saved) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pdf-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: String(reportNum) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Could not mark the PDF ready.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not mark the PDF ready.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={mark}
        disabled={busy || ready || saved}
        className={
          ready
            ? `${PILL} border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400`
            : `${PILL} border-border text-muted hover:border-brand/40 hover:text-brand-text`
        }
      >
        {ready && <Check className="size-3.5" />}
        {busy ? "Saving…" : ready ? "PDF ready" : saved ? "Tracker marked" : "Mark PDF ready"}
      </button>
      {saved && !ready && (
        <span className="text-xs text-muted">The tracker is marked. PDF ready stays off until the file is in output/.</span>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </span>
  );
}
