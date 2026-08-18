"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Check, Loader2 } from "lucide-react";

const OUTCOME_TYPES: { value: string; label: string }[] = [
  { value: "interview_progress", label: "Advanced in interview process" },
  { value: "interview_only", label: "Completed interview process" },
  { value: "offer_received", label: "Offer received" },
  { value: "hired", label: "Hired — accepted the offer" },
  { value: "offer_declined", label: "Declined the offer" },
  { value: "rejected", label: "Rejected" },
  { value: "no_response", label: "No response / ghosted" },
];

// Records the real-world result of an application: archives the submitted
// CV/cover/posting under data/outcomes/ and syncs the tracker status, via the
// core outcome.mjs script (/api/outcome) — never hand-edits applications.md.
export function OutcomeButton({ n }: { n: string }) {
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);
  const [outcomeType, setOutcomeType] = useState(OUTCOME_TYPES[0].value);
  const [stage, setStage] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    }
    if (showMenu) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  async function record(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, outcomeType, stage: stage.trim() || undefined, feedback: feedback.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "recording failed");
      setSaved(true);
      setShowMenu(false);
      setStage("");
      setFeedback("");
      setTimeout(() => setSaved(false), 2500);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "recording failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        onClick={() => setShowMenu(!showMenu)}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        title="Record what actually happened — updates the tracker and archives the submitted artifacts"
      >
        <ClipboardCheck className="size-3.5" /> Record outcome
      </button>

      {saved && (
        <span className="absolute -right-1 top-full mt-1 animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand">
          <Check className="size-3" /> recorded
        </span>
      )}

      {showMenu && (
        // Anchored left (not right, like ApplyButton) — this button sits mid-row,
        // not at the content edge, so a right-anchored w-72 popover extending
        // leftward can slide under the fixed sidebar on narrower viewports.
        <div className="absolute left-0 top-full z-[100] mt-2 w-72 origin-top-left rounded-xl border border-border bg-surface p-3 shadow-xl">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">What happened?</h4>
          <form onSubmit={record} className="flex flex-col gap-2.5">
            <select
              value={outcomeType}
              onChange={(e) => setOutcomeType(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand"
            >
              {OUTCOME_TYPES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <input
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              placeholder="Stage (optional, e.g. Final Round)"
              className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-brand"
            />
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Verbatim feedback (optional)"
              rows={2}
              className="resize-none rounded-md border border-border bg-transparent px-2.5 py-1.5 text-xs outline-none focus:border-brand"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardCheck className="size-3.5" />}
              Record &amp; update tracker
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
