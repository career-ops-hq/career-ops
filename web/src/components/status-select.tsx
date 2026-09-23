"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { CANONICAL_STATES } from "@/lib/format";
import { OUTCOME_STATUSES, type OutcomeStatus } from "@/lib/outcome-status";
import { Button } from "@/components/ui/button";

type PendingOutcome = { status: OutcomeStatus; prev: string };

// Status writeback via /api/status → set-status.mjs or outcome.mjs (never raw
// tracker edits). Terminal outcomes open a feedback panel before saving.
export function StatusSelect({ n, current }: { n: string; current: string }) {
  const [status, setStatus] = useState(current);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingOutcome | null>(null);
  const [feedback, setFeedback] = useState("");
  const [stage, setStage] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    setStatus(current);
  }, [current]);

  async function saveStatus(
    next: string,
    opts?: { feedback?: string; stage?: string; note?: string },
  ): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, status: next, ...opts }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "write failed");
      setStatus(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "write failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    if (next in OUTCOME_STATUSES) {
      setPending({ status: next as OutcomeStatus, prev: status });
      setFeedback("");
      setStage("");
      setNote("");
      setError("");
      setStatus(next);
      return;
    }
    const prev = status;
    setStatus(next);
    const ok = await saveStatus(next);
    if (!ok) setStatus(prev);
  }

  async function confirmOutcome() {
    if (!pending) return;
    const ok = await saveStatus(pending.status, {
      feedback: feedback.trim() || undefined,
      stage: stage.trim() || undefined,
      note: note.trim() || undefined,
    });
    if (ok) {
      setPending(null);
      setFeedback("");
      setStage("");
      setNote("");
    } else {
      setStatus(pending.prev);
    }
  }

  function cancelOutcome() {
    if (pending) setStatus(pending.prev);
    setPending(null);
    setFeedback("");
    setStage("");
    setNote("");
    setError("");
  }

  const known = (CANONICAL_STATES as readonly string[]).includes(status);
  const showStage = pending?.status === "Interview";

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <span className="inline-flex items-center gap-2">
        <label className="text-xs text-faint">status</label>
        <select
          value={status}
          onChange={onChange}
          disabled={busy}
          className="rounded-md border border-border bg-surface px-2.5 py-1 text-sm text-foreground outline-none transition-colors focus:border-brand/50 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {!known && <option value={status}>{status}</option>}
          {CANONICAL_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {busy && <Loader2 className="size-3.5 animate-spin text-faint" />}
        {saved && !busy && (
          <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
            <Check className="size-3" /> saved
          </span>
        )}
      </span>

      {pending && (
        <div className="w-full min-w-[min(100%,20rem)] rounded-lg border border-border bg-surface/60 p-3">
          <p className="text-xs font-medium text-foreground">
            Record {pending.status.toLowerCase()} outcome
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            Archives CV snapshot and logs feedback for pattern analysis.
          </p>

          {showStage && (
            <label className="mt-2.5 block">
              <span className="text-[11px] text-faint">Stage reached</span>
              <input
                type="text"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                placeholder="e.g. Tech screen, Final round"
                className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand/50"
              />
            </label>
          )}

          <label className="mt-2.5 block">
            <span className="text-[11px] text-faint">
              {pending.status === "Rejected" ? "Recruiter feedback (verbatim)" : "Feedback (optional)"}
            </span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder={
                pending.status === "Rejected"
                  ? "Paste the rejection reason exactly as received…"
                  : "Any notes from the company or interviewer…"
              }
              className="mt-1 w-full resize-y rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand/50"
            />
          </label>

          <label className="mt-2 block">
            <span className="text-[11px] text-faint">Tracker note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Short note appended to the tracker row"
              className="mt-1 w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-brand/50"
            />
          </label>

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={confirmOutcome}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : "Save outcome"}
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={cancelOutcome}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </span>
  );
}
