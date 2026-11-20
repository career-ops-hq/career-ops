"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { COVER_QUESTIONS, coverAnswersText, storedCoverBrief } from "@/lib/cover-answers.mjs";
import { COVER_TONES } from "@/lib/cover-tones.mjs";

// The answers a cover run was started with. Shown whatever the run's outcome, so
// a failed draft does not take the user's own writing with it (#7441), and
// copyable so they can paste it into their agent CLI's cover mode instead.
export function CoverAnswers({ brief: stored }: { brief: unknown }) {
  const [copied, setCopied] = useState(false);
  const brief = storedCoverBrief(stored);
  if (!brief) return null;

  async function copy() {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(coverAnswersText(brief));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Non-secure context or permission denied: the answers stay selectable.
    }
  }

  return (
    <section aria-label="Your cover letter answers" className="mt-8">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Your answers</h2>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand-text max-sm:min-h-[44px]"
        >
          {copied ? <CheckIcon className="size-3.5 text-brand-text" aria-hidden="true" /> : <CopyIcon className="size-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy answers"}
        </button>
      </div>
      <dl className="mt-3 space-y-3 rounded-2xl border border-border bg-surface/40 p-5 text-sm">
        {COVER_QUESTIONS.map((q) => (
          <div key={q.name}>
            <dt className="font-medium text-foreground">{q.label}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap break-words text-muted">{brief[q.name].trim() || "No answer"}</dd>
          </div>
        ))}
        {brief.tone && (
          <div>
            <dt className="font-medium text-foreground">Tone</dt>
            <dd className="mt-0.5 text-muted">{COVER_TONES[brief.tone]}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
