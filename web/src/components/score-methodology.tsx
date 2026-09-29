import { ChevronDown, ExternalLink } from "lucide-react";
import { getT } from "@/lib/i18n/server";
import { rich } from "@/lib/i18n/rich";

// Transparency = our differentiator ("why it's a 4.0 for YOU"). The wording is
// the CANONICAL public text from career-ops.org/methodology + /docs — rendered
// verbatim, NOT a web reinterpretation of the rubric (whose weights live in the
// core, modes/_shared.md). Native <details> → no client JS.

const DIMENSIONS: [string, string][] = [
  ["Match", "how well your CV maps to the role's requirements"],
  ["North-star alignment", "how far the role moves you toward your stated career goal"],
  ["Compensation", "the offer vs market rates (says “insufficient data” when comp is missing — never invents numbers)"],
  ["Cultural signals", "team, values and ways-of-working signals from the posting"],
  ["Red flags", "ghost-job, scam or mismatch warnings"],
  ["Overall", "the single judgment that rolls the above into the score"],
];

const BLOCKS: [string, string][] = [
  ["A", "Plain-English summary of the role"],
  ["B", "A table of how your CV matches each requirement, how much each requirement matters for this posting, and the gaps"],
  ["C", "Strategy — how to position yourself for this role"],
  ["D", "Compensation research, comparing the offer to market rates"],
  ["E", "Personalization notes for your application"],
  ["F", "Interview prep — STAR stories tailored to this job"],
  ["G", "Posting legitimacy — a check that the listing is real, not a scam or ghost job"],
];

export async function ScoreMethodology() {
  const t = await getT();
  return (
    <details className="group mt-10 overflow-hidden rounded-2xl border border-border bg-surface/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors hover:bg-surface-hover">
        {rich(t("How career-ops scored this — and why it's for <b>you</b>"), { b: (c) => <span className="text-landing">{c}</span> })}
        <ChevronDown className="ml-auto size-4 text-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border px-5 py-4 text-sm">
        <p className="text-muted">
          {rich(
            t("Every role is scored <range>1.0–5.0</range> across six dimensions. <line>4.0</line> is the apply / don't-apply line — below it, career-ops recommends against applying."),
            {
              range: (c) => <strong className="text-foreground">{c}</strong>,
              line: (c) => <strong className="text-brand">{c}</strong>,
            },
          )}
        </p>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">{t("The six dimensions")}</div>
          <ul className="space-y-1.5">
            {DIMENSIONS.map(([k, v]) => (
              <li key={k}>
                <span className="font-medium text-foreground">{t(k)}</span> <span className="text-muted">· {t(v)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">{t("What each report block means")}</div>
          <ul className="space-y-2">
            {BLOCKS.map(([k, v]) => (
              <li key={k} className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded bg-brand-soft text-xs font-semibold text-brand">
                  {k}
                </span>
                <span className="text-muted">{t(v)}</span>
              </li>
            ))}
          </ul>
        </div>
        <a
          href="https://career-ops.org/methodology"
          target="_blank"
          rel="noreferrer"
          aria-label={t("Full methodology (opens in a new tab)")}
          className="inline-flex min-h-[24px] items-center gap-1 text-xs text-brand transition-colors hover:underline max-sm:min-h-[44px]"
        >
          {t("Full methodology")} <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>
    </details>
  );
}
