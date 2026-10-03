"use client";

import { useEffect, useState } from "react";
import { Building2, CircleCheck, CircleSlash, CircleHelp } from "lucide-react";
import { companyCardModel, isConclusion } from "@/lib/company-history.mjs";
import type { CompanyCardModel, Verdict } from "@/lib/company-history.mjs";

// What the tracker already knows about this company, from the core's
// company-history.mjs via /api/company-history.
//
// On the report because it answers the question that sits next to "should I
// apply?": have these people ever replied to me, and do they re-list this role?
// Both facts are already on disk and were previously CLI-only.
//
// The one thing this view must not do is turn "not checked" into "nothing
// found" — see lib/company-history.mjs for why the core draws that line and
// what it costs to lose it.
const ICON = {
  finding: CircleCheck,
  absence: CircleSlash,
  "not-checked": CircleHelp,
} as const;

export function CompanyEvidence({ company }: { company: string }) {
  const [model, setModel] = useState<CompanyCardModel | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/company-history?company=${encodeURIComponent(company)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setModel(companyCardModel(d)))
      .catch(() => alive && setModel(companyCardModel(null)));
    return () => {
      alive = false;
    };
  }, [company]);

  if (!model) {
    return (
      <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted/25" aria-hidden />
        <div className="mt-3 h-12 w-full animate-pulse rounded bg-muted/25" aria-hidden />
      </section>
    );
  }

  // Silent when unavailable. Unlike the keyword panel, this one adds context to
  // a page that reads fine without it, and "company-history.mjs isn't in this
  // checkout" is not something the reader can act on from here.
  if (!model.available) return null;

  return (
    <section className="mt-8 rounded-2xl border border-border bg-surface/40 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Building2 className="size-4 text-brand" />
        <h2 className="font-display text-base text-landing">What you already know about {model.company ?? company}</h2>
      </div>

      <div className="mt-3 grid gap-2.5">
        <Row verdict={model.responsiveness} />
        <Row verdict={model.churn} />
      </div>

      {model.facts.length > 0 && (
        <ul className="mt-3 grid gap-1">
          {model.facts.slice(0, 5).map((f, i) => (
            <li key={i} className="text-xs text-faint">
              #{String(f.num ?? "?")} · {String(f.outcome ?? "—")}
              {f.date ? ` · ${String(f.date)}` : ""}
              {f.stale ? " · stale" : ""}
            </li>
          ))}
        </ul>
      )}

      {model.explanations.map((e, i) => (
        <p key={i} className="mt-3 text-xs text-muted">
          {e}
        </p>
      ))}
    </section>
  );
}

function Row({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return null;
  const Icon = ICON[verdict.kind] ?? CircleHelp;
  return (
    <div className="flex items-start gap-2.5">
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${isConclusion(verdict) ? "text-brand" : "text-faint"}`}
        aria-hidden
      />
      <div className="min-w-0">
        {/* A not-checked row is deliberately muted: it is the absence of a
            check, and it should not carry the visual weight of a finding. */}
        <p className={isConclusion(verdict) ? "text-sm text-foreground" : "text-sm text-muted"}>{verdict.headline}</p>
        {verdict.detail && <p className="text-xs text-faint">{verdict.detail}</p>}
      </div>
    </div>
  );
}
