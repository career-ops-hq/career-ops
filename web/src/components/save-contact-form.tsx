"use client";

import { useState } from "react";
import { UserPlus, Check, Loader2 } from "lucide-react";

const TYPES = [
  { value: "recruiter", label: "Recruiter" },
  { value: "hiring-manager", label: "Hiring manager" },
  { value: "peer", label: "Team peer" },
  { value: "interviewer", label: "Interviewer" },
  { value: "other", label: "Other" },
];

// Confirm-then-save UI for a contact the "Find contacts" job surfaced. The
// job's free-text output isn't reliably parseable into structured fields, so
// this asks the user to copy the name/link from what they just read above —
// deliberate friction is the point (contacto.md: never save without the
// candidate confirming), and it's the one path that makes a found contact
// durable across sessions/devices instead of living only in this job's
// localStorage entry.
export function SaveContactForm({
  defaultCompany,
  trackerNum,
  defaultMessage = "",
}: {
  defaultCompany: string;
  trackerNum: string;
  /** The drafted outreach message, prefilled from the job output's first code
   *  block if the caller has it — otherwise the user pastes it in manually. */
  defaultMessage?: string;
}) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState(defaultCompany);
  const [type, setType] = useState("recruiter");
  const [title, setTitle] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, company, type, title, linkedin, email, trackerNum, notes: message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <div className="mt-6 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
        <Check className="mt-0.5 size-4 shrink-0" />
        <span>
          Saved to your contacts{message.trim() ? " — message included, so it's here next time you need it, not just in this job's history" : ""} — exportable anytime with <code className="text-xs">node contacts.mjs --vcf</code>.
        </span>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface/40 p-4">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-muted">
        <UserPlus className="size-3.5" /> Save this contact
      </h2>
      <p className="mt-1 text-xs text-faint">
        So you don&apos;t have to search again — copy the name and link from above. Saved to <code className="text-xs">data/contacts.tsv</code>, the same file the CLI uses.
      </p>
      <form onSubmit={save} className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name *"
          className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand max-sm:min-h-[44px]"
        />
        <input
          required
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company *"
          className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand max-sm:min-h-[44px]"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand max-sm:min-h-[44px]"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand max-sm:min-h-[44px]"
        />
        <input
          value={linkedin}
          onChange={(e) => setLinkedin(e.target.value)}
          placeholder="LinkedIn URL (optional)"
          className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand max-sm:min-h-[44px]"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (optional)"
          className="rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand max-sm:min-h-[44px]"
        />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="The outreach message (optional) — paste it here so it's saved alongside the contact, not just in this job's history"
          rows={3}
          className="resize-y rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-brand sm:col-span-2"
        />
        {error && <p className="text-xs text-red-500 sm:col-span-2">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-50 sm:col-span-2 max-sm:min-h-[44px]"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
          Save contact
        </button>
      </form>
    </div>
  );
}
