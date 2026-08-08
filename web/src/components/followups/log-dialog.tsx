"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { CHANNELS, localISODate, type CadenceEntry, type Channel } from "@/lib/followups";
import { cn } from "@/lib/cn";

// "Log" — the full-fidelity FollowUp entry (date, channel enum, contact,
// notes). Appends one table row via /api/followups/log.
export function LogDialog({
  entry,
  onClose,
  onLogged,
}: {
  entry: CadenceEntry;
  onClose: () => void;
  onLogged: () => void;
}) {
  // Local day, not UTC — east of UTC toISOString() defaults to "yesterday"
  // and its max would block picking the user's actual today.
  const [date, setDate] = useState(() => localISODate());
  const [channel, setChannel] = useState<Channel>("Email");
  const [contact, setContact] = useState(entry.contacts[0]?.email ?? "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep free text single-line and pipe-free BEFORE it leaves the client
  // (the API's cell() normalizes again server-side — defense in depth): the
  // log is a pipe-delimited markdown table, so `|` and newlines would break
  // the row format.
  const tableSafe = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/\|/g, "/").trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/followups/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appNum: entry.num,
          company: entry.company,
          role: entry.role,
          date,
          channel,
          contact: tableSafe(contact),
          notes: tableSafe(notes),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Could not log the follow-up.");
        setSaving(false);
        return;
      }
      onLogged();
      onClose();
    } catch {
      setError("Could not log the follow-up.");
      setSaving(false);
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
        aria-label={`Log follow-up for ${entry.company}`}
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg">Log follow-up</h2>
            <p className="mt-0.5 text-sm text-muted">
              {entry.company} · {entry.role} <span className="text-faint">(#{entry.num})</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-faint transition hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-muted">
              Date
              <input type="date" required value={date} max={localISODate()} onChange={(e) => setDate(e.target.value)} className={cn(inputCls, "mt-1")} />
            </label>
            <label className="block text-xs font-medium text-muted">
              Channel
              <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={cn(inputCls, "mt-1")}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium text-muted">
            Contact <span className="font-normal text-faint">(optional)</span>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="who you reached out to"
              list={entry.contacts.length ? `co-contacts-${entry.num}` : undefined}
              className={cn(inputCls, "mt-1")}
            />
            {entry.contacts.length > 0 && (
              <datalist id={`co-contacts-${entry.num}`}>
                {entry.contacts.map((c) => (
                  <option key={c.email} value={c.email}>
                    {c.name ?? undefined}
                  </option>
                ))}
              </datalist>
            )}
          </label>
          <label className="block text-xs font-medium text-muted">
            Notes <span className="font-normal text-faint">(optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="what you said, what you're waiting on…"
              className={cn(inputCls, "mt-1 resize-none")}
            />
          </label>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-muted transition hover:text-foreground">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:pointer-events-none disabled:opacity-60"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />} Log follow-up
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
