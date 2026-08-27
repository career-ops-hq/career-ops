"use client";

import { useEffect, useState } from "react";

export function ApplicationDocumentSettings() {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState("");
  useEffect(() => { fetch("/api/documents/settings").then((r) => r.json()).then((d) => setEnabled(d.autoCoverLetter === true)).catch(() => {}); }, []);
  async function update(next: boolean) {
    setEnabled(next); setStatus("Saving…");
    const response = await fetch("/api/documents/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoCoverLetter: next }) });
    setStatus(response.ok ? "Saved" : "Could not save");
  }
  return (
    <section className="mx-auto mt-8 max-w-3xl rounded-xl border border-border bg-surface p-5">
      <h2 className="font-display text-xl text-landing">Application Documents</h2>
      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-foreground">
        <input type="checkbox" checked={enabled} onChange={(event) => void update(event.target.checked)} className="mt-0.5 size-4 accent-[var(--color-brand)]" />
        <span><span className="font-medium">Automatically prepare cover letter with tailored resume</span><span className="mt-1 block text-xs text-muted">Creates a review-required workflow only. Final PDFs always require explicit approval.</span></span>
      </label>
      {status && <p role="status" className="mt-2 text-xs text-faint">{status}</p>}
    </section>
  );
}
