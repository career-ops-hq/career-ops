import { ChevronDown, ExternalLink } from "lucide-react";
import { ignoredByScore, scoreBandSummary, scoringDimensions } from "@/lib/score-claims.mjs";

// Native <details>, no client JS. The dimension list is the rubric in
// modes/_shared.md. Bands come from lib/score-action.mjs.

const BLOCKS: [string, string][] = [
  ["A", "Plain-English summary of the role"],
  ["B", "A table of how your CV matches each requirement, how much each requirement matters for this posting, and the gaps. Importance does not change the 1 to 5 score."],
  ["C", "Strategy. How to position yourself for this role."],
  ["D", "Compensation. Unknown when the posting states no pay."],
  ["E", "Personalization notes for your application"],
  ["F", "Interview prep. STAR stories tailored to this job."],
  ["G", "Posting legitimacy. A check that the listing is real. It does not change the 1 to 5 score."],
];

export function ScoreMethodology() {
  return (
    <details className="group mt-10 overflow-hidden rounded-2xl border border-border bg-surface/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors hover:bg-surface-hover">
        How career-ops scored this, and why it is for <span className="text-landing">you</span>
        <ChevronDown className="ml-auto size-4 text-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border px-5 py-4 text-sm">
        <p className="text-muted">
          Every role is scored <strong className="text-foreground">1.0 to 5.0</strong> from five dimensions.
          The global score is that judgment. It is not a sixth input.
        </p>
        <ul className="space-y-1 text-muted">
          {scoreBandSummary().map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">The five dimensions</div>
          <ul className="space-y-1.5">
            {scoringDimensions().map((row) => (
              <li key={row.name}>
                <span className="font-medium text-foreground">{row.name}.</span> <span className="text-muted">{row.detail}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-muted">
          These do not move the score: {ignoredByScore().join(", ")}.
        </p>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">What each report block means</div>
          <ul className="space-y-2">
            {BLOCKS.map(([k, v]) => (
              <li key={k} className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded bg-brand-soft text-xs font-semibold text-brand-text">
                  {k}
                </span>
                <span className="text-muted">{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <a
          href="https://career-ops.org/methodology"
          target="_blank"
          rel="noreferrer"
          aria-label="Full methodology (opens in a new tab)"
          className="inline-flex min-h-[24px] items-center gap-1 text-xs text-brand-text transition-colors hover:underline max-sm:min-h-[44px]"
        >
          Full methodology <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>
    </details>
  );
}
