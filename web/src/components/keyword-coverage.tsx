"use client";

import { useEffect, useState } from "react";
import { ScanSearch } from "lucide-react";
import { coverageModel, coverageBand } from "@/lib/keyword-coverage.mjs";
import type { CoverageModel } from "@/lib/keyword-coverage.mjs";

// ATS keyword coverage for this report's JD against the CV, from the core's
// keyword-match.mjs via /api/keyword-match.
//
// Sits on the report because that is where the decision is — "is my CV going to
// read as a match for this JD?" is asked while looking at the offer, not on a
// separate page.
//
// DIAGNOSTIC, and the UI has to keep it that way. There is no pass mark and no
// red state: the script's own header states the project rule that keywords get
// reformulated, never fabricated, and a failing grade is what pushes someone to
// paste the missing terms in verbatim.
const BAND_CLASS: Record<string, string> = {
  high: "text-brand-text",
  mid: "text-foreground",
  low: "text-foreground",
  unknown: "text-faint",
};

const REASON_COPY: Record<string, string> = {
  "no-keywords": "This report has no “Keywords extracted” block, so there is nothing to compare the CV against.",
  "no-script": "keyword-match.mjs isn’t in this career-ops checkout.",
  "no-report": "The report file couldn’t be found.",
  failed: "The keyword check didn’t complete.",
  unparseable: "The keyword check returned something unreadable.",
  unavailable: "The keyword check isn’t available.",
};

export function KeywordCoverage({ reportId }: { reportId: string }) {
  const [model, setModel] = useState<CoverageModel | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/keyword-match?report=${encodeURIComponent(reportId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setModel(coverageModel(d)))
      .catch(() => alive && setModel(coverageModel(null)));
    return () => {
      alive = false;
    };
  }, [reportId]);

  if (!model) {
    return (
      <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
        <div className="h-5 w-44 animate-pulse rounded bg-muted/25" aria-hidden />
        <div className="mt-3 h-16 w-full animate-pulse rounded bg-muted/25" aria-hidden />
      </section>
    );
  }

  if (!model.available) {
    // Stated, not hidden: "no keywords block" is a fact about this report that
    // tells the reader what to do next, and silently omitting the panel would
    // read as the check having passed.
    return (
      <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
        <Header />
        <p className="mt-2 text-sm text-muted">{REASON_COPY[model.reason ?? "unavailable"] ?? REASON_COPY.unavailable}</p>
      </section>
    );
  }

  const band = coverageBand(model.coveragePct);

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
      <Header />

      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-3xl tabular-nums ${BAND_CLASS[band]}`}>
          {model.coveragePct === null ? "—" : `${model.coveragePct}%`}
        </span>
        <span className="text-sm text-muted">
          {model.presentCount} of {model.total} JD keyword{model.total === 1 ? "" : "s"} found in your CV
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        {model.tiers.map((tier) =>
          tier.terms.length === 0 ? null : (
            <div key={tier.key}>
              <p className="text-xs uppercase tracking-wide text-faint">
                {tier.label} <span className="normal-case tracking-normal">· {tier.hint}</span>
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {tier.terms.map((term) => (
                  <li
                    key={term}
                    className={
                      tier.key === "missing"
                        ? "rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted"
                        : "rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-foreground"
                    }
                  >
                    {term}
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}
      </div>

      <p className="mt-4 text-xs text-faint">
        Diagnostic only — nothing here edits your CV. Reformulate what you genuinely have; never add a keyword you cannot
        back up.
      </p>
    </section>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ScanSearch className="size-4 text-brand" />
      <h2 className="font-display text-base text-landing">ATS keyword coverage</h2>
      <span className="text-xs text-faint">this JD vs your CV</span>
    </div>
  );
}
