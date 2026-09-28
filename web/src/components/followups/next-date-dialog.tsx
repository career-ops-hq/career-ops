"use client";

import { useEffect, useState } from "react";
import { Loader2, Pin, PinOff, X } from "lucide-react";
import { localISODate, type CadenceEntry } from "@/lib/followups";
import { cn } from "@/lib/cn";

/** Local today + N days, as YYYY-MM-DD. */
function plusDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localISODate(d);
}

// Pin a custom NEXT follow-up date for one application — overrides the
// computed cadence (even revives a cold one) until a follow-up is logged after
// the pin, which resumes the normal schedule. POST/DELETE /api/followups/override.
export function NextDateDialog({
  entry,
  onClose,
  onChanged,
}: {
  entry: CadenceEntry;
  onClose: () => void;
  onChanged: () => void;
}) {
  const today = localISODate();
  const [date, setDate] = useState(() =>
    entry.nextFollowupDate && entry.nextFollowupDate > today ? entry.nextFollowupDate : plusDays(3),
  );
  const [busy, setBusy] = useState<"set" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const call = async (method: "POST" | "DELETE", body: Record<string, unknown>, kind: "set" | "clear") => {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch("/api/followups/override", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Could not update the pin.");
        setBusy(null);
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("Could not update the pin.");
      setBusy(null);
    }
  };

  const inputCls =
    "w-full rounded-md border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Pin next follow-up date for ${entry.company}`}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg">Pin next follow-up</h2>
            <p className="mt-0.5 text-sm text-muted">
              {entry.company} · {entry.role} <span className="text-faint">(#{entry.num})</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-faint transition hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void call("POST", { appNum: entry.num, date }, "set");
          }}
          className="mt-4 space-y-3"
        >
          <label className="block text-xs font-medium text-muted">
            Next follow-up date
            <input type="date" required value={date} min={today} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, "mt-1")} />
          </label>
          <div className="flex gap-2">
            {[3, 7, 14].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDate(plusDays(n))}
                className={cn(
                  "rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium transition-colors hover:bg-surface-hover",
                  date === plusDays(n) && "border-brand/50 bg-brand-soft text-brand",
                )}
              >
                +{n} days
              </button>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-faint">
            Overrides the computed schedule until you log a follow-up, which resumes the normal cadence.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            {entry.nextOverride && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void call("DELETE", { appNum: entry.num }, "clear")}
                className="mr-auto inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted transition-colors hover:text-red-500 disabled:pointer-events-none disabled:opacity-60"
                title={`Currently pinned to ${entry.nextOverride}`}
              >
                {busy === "clear" ? <Loader2 className="size-3.5 animate-spin" /> : <PinOff className="size-3.5" />} Clear pin
              </button>
            )}
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-muted transition hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:pointer-events-none disabled:opacity-60"
            >
              {busy === "set" ? <Loader2 className="size-3.5 animate-spin" /> : <Pin className="size-3.5" />} Pin date
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
