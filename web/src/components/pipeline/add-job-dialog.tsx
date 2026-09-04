"use client";

import { useEffect, useMemo, useState } from "react";
import { Link2, Loader2, X } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { CostBadge } from "@/components/cost/cost-badge";
import { parsePastedUrls, companyFromJobUrl, postingKey } from "@/lib/job-url.mjs";

// "Add job URL" — the manual counterpart to discovery. Paste a link you were sent
// and it runs the SAME kind:"evaluate" worker the inbox shortlist uses, which is the
// real modes/oferta.md evaluation plus the canonical report and tracker row.
//
// LinkedIn is the reason the URL is normalized rather than passed straight through:
// its /jobs/view page is an authwall for a headless agent, so job-url.mjs points the
// fetch at the public guest endpoint while the tracker keeps the clickable link.
export function AddJobDialog({ inboxUrls, onClose }: { inboxUrls: string[]; onClose: () => void }) {
  const { jobs, startEvaluate } = useJobs();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { entries, errors } = useMemo(() => parsePastedUrls(text), [text]);

  // Already-seen check, free: the inbox URLs are already on this page and past
  // evaluate runs are already in localStorage. Warn, never block — re-scoring a
  // posting after it was edited is legitimate. Compared on postingKey, not the
  // raw string, so a pipeline row that still carries tracking noise (e.g. a
  // LinkedIn "?trk=..." link) still matches the canonical URL a fresh paste
  // normalizes to.
  const seen = useMemo(() => {
    const s = new Set(inboxUrls.map(postingKey));
    for (const j of jobs) if (j.kind === "evaluate" && j.input) s.add(postingKey(j.input));
    return s;
  }, [inboxUrls, jobs]);
  const dupes = entries.filter((e) => seen.has(postingKey(e.url)));

  const evaluateAll = () => {
    const batchId = entries.length > 1 ? `paste-${Date.now()}` : undefined;
    for (const e of entries) {
      startEvaluate({ url: e.url, subtitle: e.url, page: "/pipeline", batchId });
    }
    onClose();
  };

  const addToInbox = async () => {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/explore/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offers: entries.map((e) => ({
            url: e.url,
            company: companyFromJobUrl(e.url),
            title: "Pasted link",
            location: "",
            postedAt: "",
            ats: "",
            source: "pasted",
          })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        setError(typeof j.error === "string" ? j.error : "Could not add these to the inbox.");
        setAdding(false);
        return;
      }
      onClose();
    } catch {
      setError("Could not add these to the inbox.");
      setAdding(false);
    }
  };

  const count = entries.length;
  const linkedInCount = entries.filter((e) => e.kind === "linkedin").length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[10vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add job URL"
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg">Add job URL</h2>
            <p className="mt-1 text-sm text-muted">Paste a posting link and score it against your CV.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-faint transition-colors hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="https://www.linkedin.com/jobs/view/4434693435/"
          className="mt-4 w-full resize-y rounded-lg border border-border bg-bg/60 px-3 py-2 font-mono text-xs outline-none transition-colors placeholder:text-faint focus:border-brand/50"
        />
        <p className="mt-1.5 text-xs text-faint">One per line to add several at once.</p>

        {linkedInCount > 0 && (
          <p className="mt-2 text-xs text-muted">
            LinkedIn detected. The public version of the posting is read, since the normal page blocks automated readers.
          </p>
        )}
        {dupes.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {dupes.length === 1 ? "This one is" : `${dupes.length} of these are`} already in your pipeline. Adding again re-scores it.
          </p>
        )}
        {errors.length > 0 && (
          <ul className="mt-2 space-y-1">
            {errors.map((e, i) => (
              <li key={`${e.raw}-${i}`} className="text-xs text-rose-400">
                {e.error}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={count === 0 || adding}
            onClick={evaluateAll}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-40 max-sm:min-h-[44px]"
          >
            <Link2 className="size-4" />
            {count > 1 ? `Evaluate ${count} now` : "Evaluate now"}
          </button>
          <button
            type="button"
            disabled={count === 0 || adding}
            onClick={addToInbox}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-40 max-sm:min-h-[44px]"
          >
            {adding && <Loader2 className="size-4 animate-spin" />}
            Add to inbox
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <CostBadge kind="spend" size="xs" />
          <span className="text-xs text-faint">Evaluating uses tokens. Adding to the inbox is free.</span>
        </div>
      </div>
    </div>
  );
}
