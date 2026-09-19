"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { CANONICAL_STATES } from "@/lib/format";
import { statusFeedback } from "@/lib/status-feedback.mjs";

// Status writeback control. Updates the existing tracker row (status cell) via
// /api/status — never adds rows. Reverts on failure; confirms with the
// terminal-popup animation.
export function StatusSelect({ n, current }: { n: string; current: string }) {
  const [status, setStatus] = useState(current);
  const [saved, setSaved] = useState<{ kind: "saved" } | { kind: "followup"; date: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const selectId = `status-select-${n}`;

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const prev = status;
    setStatus(next);
    setBusy(true);
    try {
      const res = await fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, status: next }),
      });
      if (!res.ok) throw new Error("write failed");
      // The CLI seeds the follow-up itself on a move to Applied (#3470) and
      // reports it. Saying the date closes a loop that was invisible: work was
      // scheduled on the user's behalf and nothing on screen admitted it.
      const body = await res.json().catch(() => ({}));
      setSaved(statusFeedback(body?.followupSeeded));
      setTimeout(() => setSaved(null), 4000);
      router.refresh();
    } catch {
      setStatus(prev); // revert on failure
      setSaved(null);
    } finally {
      setBusy(false);
    }
  }

  const known = (CANONICAL_STATES as readonly string[]).includes(status);
  return (
    <span className="inline-flex items-center gap-2">
      {/* htmlFor/id, not a bare <label>: without the association the control
          has no accessible name, so a screen reader announces a combobox and
          not what it changes — and this one moves an application's state.
          axe-core `select-name`, the only critical finding on this page. */}
      <label htmlFor={selectId} className="text-xs text-faint">status</label>
      <select
        id={selectId}
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
      {saved && (
        <span className="animate-terminal-popup inline-flex items-center gap-1 text-xs font-medium text-brand" role="status">
          <Check className="size-3" />
          {saved.kind === "followup" ? `follow-up ${saved.date}` : "saved"}
        </span>
      )}
    </span>
  );
}
