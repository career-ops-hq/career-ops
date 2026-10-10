"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { CANONICAL_STATES } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Inline status control for the follow-up tracker.
 *
 * The follow-up cadence is calculated from the tracker's canonical status, so
 * this deliberately writes through /api/status instead of maintaining a
 * second status field in data/follow-ups.md.
 */
export function FollowupStatusSelect({
  n,
  current,
  onSaved,
}: {
  n: number;
  current: string;
  onSaved: () => void;
}) {
  const initial = CANONICAL_STATES.find((state) => state.toLowerCase() === current.toLowerCase()) ?? current;
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    const previous = status;
    setStatus(next);
    setBusy(true);
    setSaved(false);
    setError(null);

    try {
      const response = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n: String(n), status: next }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!response.ok) throw new Error(result.error || "Status update failed.");

      setStatus(result.status || next);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
      onSaved();
    } catch (cause) {
      setStatus(previous);
      setError(cause instanceof Error ? cause.message : "Status update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      <select
        aria-label={`Update status for application #${n}`}
        title="Change status — urgency recalculates from the new status and follow-up history"
        value={status}
        onChange={onChange}
        disabled={busy}
        className={cn(
          "max-w-32 rounded-md border border-border bg-surface px-1.5 py-1 text-xs font-semibold text-muted outline-none transition-colors focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40 disabled:opacity-60",
          error && "border-red-500/60",
        )}
      >
        {!CANONICAL_STATES.some((state) => state.toLowerCase() === status.toLowerCase()) && <option value={status}>{status}</option>}
        {CANONICAL_STATES.map((state) => (
          <option key={state} value={state}>
            {state}
          </option>
        ))}
      </select>
      <span role="status" aria-live="polite" aria-atomic="true" className="inline-flex min-h-3.5 items-center">
        {busy && <><Loader2 aria-hidden="true" className="size-3.5 animate-spin text-faint" /><span className="sr-only">Saving status</span></>}
        {saved && <><Check aria-hidden="true" className="size-3.5 text-brand" /><span className="sr-only">Status saved</span></>}
      </span>
      {error && <span role="alert" className="basis-full text-xs text-red-400">{error}</span>}
    </span>
  );
}
