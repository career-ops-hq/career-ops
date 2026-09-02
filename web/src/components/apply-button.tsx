"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Lock, Loader2, X, ExternalLink } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import { useApply } from "@/components/apply/apply-provider";

// The "Apply" CTA — brand orange, paper-plane. Enabled ONLY when the tailored CV
// for THIS offer is ready (the tracker's PDF column is ✅, or a pdf worker for
// this #n just finished). On click it opens the apply form-proxy for the offer
// (where the user reviews and submits it themselves — never auto-submit).
//
// A LinkedIn posting cannot be applied to directly: the apply session browses in a
// fresh, cookie-less context, so LinkedIn serves its authwall and the flow dies.
// So the click first asks /api/apply/resolve for the real application URL, which
// reconstructs the employer's ATS link and records it on the report. That call is
// cheap once recorded (answered from disk) and skipped entirely for non-LinkedIn
// postings, so the common case still feels like a plain button.
//
// Resolution deliberately refuses to guess between look-alike postings, so this
// has to handle three outcomes, not one: resolved (go), ambiguous (the user picks
// from ranked candidates), and unresolved (the user pastes the link themselves).

type Candidate = { title: string; url: string; location: string; score: number };
type Resolution = {
  status: "resolved" | "ambiguous" | "unresolved";
  applyUrl: string | null;
  source?: string;
  reason?: string;
  candidates?: Candidate[];
  posting?: { title?: string; company?: string };
  error?: string;
};

export function ApplyButton({
  n,
  url,
  applyUrl,
  company,
  pdfReady,
}: {
  n: string;
  /** The canonical posting link (what the tracker records). */
  url?: string;
  /** An already-recorded **Apply URL:**, if this offer has been resolved before. */
  applyUrl?: string;
  company: string;
  pdfReady: boolean;
}) {
  const router = useRouter();
  const { jobs } = useJobs();
  const apply = useApply();

  const [resolving, setResolving] = useState(false);
  const [choice, setChoice] = useState<Resolution | null>(null);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pdfJobDone = jobs.some((j) => j.kind === "pdf" && j.input === n && j.status === "done");
  // Either link is a usable starting point: the recorded apply URL goes straight
  // to the form, and the posting URL is what resolution works from.
  const hasUrl = !!url && /^https?:\/\//i.test(url);
  const hasApplyUrl = !!applyUrl && /^https?:\/\//i.test(applyUrl);
  const ready = (pdfReady || pdfJobDone) && (hasUrl || hasApplyUrl);

  const openApply = (applyUrl: string) => {
    // n + from ride along so the Apply page can mark this row Applied and
    // return the user to the page they left. Read straight off the handler's
    // own location: usePathname() drops the query and hash, which is where
    // the list filter and the row anchor live.
    const { pathname, search, hash } = window.location;
    apply.open(applyUrl, { prefill: true, company, n, from: `${pathname}${search}${hash}` });
    router.push("/apply");
  };

  const start = async () => {
    setResolving(true);
    setError(null);
    try {
      const res = await fetch("/api/apply/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n }),
      });
      const j = (await res.json().catch(() => ({}))) as Resolution;
      if (!res.ok || j.error) {
        setError(typeof j.error === "string" ? j.error : "Could not work out where to apply.");
        return;
      }
      if (j.status === "resolved" && j.applyUrl) {
        openApply(j.applyUrl);
        return;
      }
      // Ambiguous or unresolved: hand the decision to the user rather than guessing.
      setChoice(j);
    } catch {
      setError("Could not work out where to apply.");
    } finally {
      setResolving(false);
    }
  };

  // Record the user's choice on the report, then open it. Persisting means the
  // next apply for this offer skips resolution entirely.
  const choose = async (applyUrl: string) => {
    setResolving(true);
    setError(null);
    try {
      const res = await fetch("/api/apply/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ n, pick: applyUrl }),
      });
      const j = (await res.json().catch(() => ({}))) as Resolution;
      if (!res.ok || j.error) {
        setError(typeof j.error === "string" ? j.error : "Could not save that link.");
        return;
      }
      setChoice(null);
      openApply(applyUrl);
    } catch {
      setError("Could not save that link.");
    } finally {
      setResolving(false);
    }
  };

  if (!ready) {
    return (
      <button
        type="button"
        disabled
        title={!hasUrl && !hasApplyUrl ? "No application URL on this report" : "Generate the tailored CV (PDF) first to apply"}
        className="inline-flex cursor-not-allowed items-center justify-center gap-1.5 rounded-full border border-border bg-surface/40 px-3.5 py-1 text-xs font-medium text-faint max-sm:min-h-[44px]"
      >
        <Lock className="size-3.5" /> Apply
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={resolving}
        className="inline-flex items-center justify-center gap-1.5 rounded-full bg-brand px-3.5 py-1 text-xs font-medium text-brand-foreground shadow-sm transition-colors hover:bg-brand-200 disabled:opacity-70 max-sm:min-h-[44px]"
        title="Apply: opens the form pre-filled, you review and submit yourself"
      >
        {resolving ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
        {resolving ? "Finding the form…" : "Apply"}
      </button>

      {error && !choice && <span className="ml-2 text-xs text-rose-400">{error}</span>}

      {choice && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[10vh]"
          onClick={() => setChoice(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose the application form"
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-lg">
                  {choice.status === "ambiguous" ? "Which posting is this?" : "Where should this apply?"}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {choice.status === "ambiguous"
                    ? "LinkedIn hides the employer's application link, so this was matched against their careers board. Several postings match closely enough that picking for you could send this to the wrong role."
                    : "LinkedIn hides the employer's application link and their careers board could not be matched automatically."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChoice(null)}
                aria-label="Close"
                className="rounded-md p-1 text-faint transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {choice.reason && <p className="mt-2 text-xs text-faint">{choice.reason}</p>}

            {!!choice.candidates?.length && (
              <ul className="mt-4 space-y-2">
                {choice.candidates.map((c) => (
                  <li key={c.url}>
                    <button
                      type="button"
                      onClick={() => choose(c.url)}
                      disabled={resolving}
                      className="w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-left transition-colors hover:border-brand/50 disabled:opacity-60"
                    >
                      <span className="block text-sm text-foreground">{c.title}</span>
                      {c.location && <span className="mt-0.5 block text-xs text-muted">{c.location}</span>}
                      <span className="mt-1 block truncate font-mono text-[11px] text-faint">{c.url}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <label htmlFor={`apply-url-${n}`} className="text-xs text-muted">
                Or paste the application link yourself
              </label>
              <input
                id={`apply-url-${n}`}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder="https://job-boards.greenhouse.io/acme/jobs/123"
                className="mt-1.5 w-full rounded-lg border border-border bg-bg/60 px-3 py-2 font-mono text-xs outline-none transition-colors placeholder:text-faint focus:border-brand/50"
              />
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-brand"
                >
                  Open the LinkedIn posting to find it <ExternalLink className="size-3" />
                </a>
              )}
            </div>

            {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => choose(pasted.trim())}
                disabled={resolving || !/^https?:\/\//i.test(pasted.trim())}
                className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
              >
                {resolving ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Use this link
              </button>
              <button
                type="button"
                onClick={() => setChoice(null)}
                className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
