"use client";

import { useEffect, useState } from "react";
import { statsModel } from "@/lib/analytics/view-model.mjs";
import type { StatsModel, BreakdownSection, ThresholdSection, VendorSection } from "@/lib/analytics/view-model.mjs";

// The "Insights" view: analyze-patterns.mjs, rendered.
//
// The core already refuses to claim things its sample cannot support, and every
// one of those refusals is surfaced here rather than smoothed over — a panel
// that quietly drops a caveat is how a hedged number becomes a rule someone
// filters their search by. The gating lives in lib/analytics/view-model.mjs and
// is unit-tested; this file only renders the decision.
export function SearchInsights() {
  const [model, setModel] = useState<StatsModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/patterns")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => alive && setModel(statsModel(d?.patterns ?? null)))
      .catch(() => alive && setModel(statsModel(null)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="mt-6 grid gap-3" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-28 w-full animate-pulse rounded-2xl bg-muted/25" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    );
  }

  if (!model || model.state === "unavailable") {
    return (
      <Empty
        title="Pattern analysis isn't available"
        body="This needs analyze-patterns.mjs in the career-ops checkout. Everything else on this page still works."
      />
    );
  }

  if (model.state === "below-threshold" && model.progress) {
    const { current, threshold, message } = model.progress;
    const pct = threshold ? Math.min(100, Math.round((current / threshold) * 100)) : 0;
    return (
      // The core's own words, plus the distance to the bar. Showing "4 of 5" is
      // the difference between "come back later" and knowing exactly when.
      <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-8 text-center">
        <p className="font-display text-lg text-landing">Not enough applications yet</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{message}</p>
        {threshold ? (
          <div className="mx-auto mt-5 max-w-xs">
            <div className="h-2 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-brand/70" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs tabular-nums text-faint">
              {current} of {threshold} applications
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  if (model.sections.length === 0) {
    return <Empty title="No patterns to show yet" body="Outcomes are what this reads — record a few and they'll appear here." />;
  }

  return (
    <div className="mt-6 grid gap-4">
      {model.sections.map((section) => {
        if (section.key === "threshold") return <Threshold key="threshold" section={section as ThresholdSection} />;
        if (section.key === "vendor") return <Vendor key="vendor" section={section as VendorSection} />;
        return <Breakdown key={section.key} section={section as BreakdownSection} />;
      })}
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface/40 px-5 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-base text-landing">{title}</h3>
        {hint && <p className="text-xs text-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center">
      <p className="font-display text-lg text-landing">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{body}</p>
    </div>
  );
}

function Threshold({ section }: { section: ThresholdSection }) {
  return (
    <Panel title={section.label} hint={section.sampleSize ? `${section.sampleSize} decided outcomes` : undefined}>
      <p className="mt-2 text-3xl tabular-nums text-foreground">
        {/* Withheld when the core says the sample does not support it: a
            "recommended 4.7" off three outcomes reads as a rule. */}
        {section.value === null ? <span className="text-faint">—</span> : section.value.toFixed(1)}
      </p>
      {section.provisional && (
        <p className="mt-1 text-xs text-muted">Too few decided outcomes to recommend a cutoff yet.</p>
      )}
      {section.note && <p className="mt-2 text-sm text-muted">{section.note}</p>}
    </Panel>
  );
}

function Breakdown({ section }: { section: BreakdownSection }) {
  const top = Math.max(1, ...section.rows.map((r) => Number(r.total) || 0));
  return (
    <Panel title={section.label} hint={section.partial ? "some rows have no recorded value" : undefined}>
      <div className="mt-3 grid gap-2">
        {section.rows.map((row, i) => {
          const label = String(row[section.dimension] ?? "—");
          const total = Number(row.total) || 0;
          const conv = Number(row.conversionRate);
          return (
            <div key={`${label}-${i}`} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-muted" title={label}>
                {label}
              </span>
              <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-brand/60" style={{ width: `${(total / top) * 100}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right text-sm tabular-nums">{total}</span>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-faint">
                {Number.isFinite(conv) ? `${conv}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Vendor({ section }: { section: VendorSection }) {
  if (!section.claimable) {
    return (
      <Panel title={section.label}>
        {/* No chart at all, and the reason stated. An advance rate over 0
            identified applications is not a small number, it is no number. */}
        <p className="mt-2 text-sm text-muted">
          {section.identified} of the applications could be matched to an ATS vendor
          {section.minSampleForClaim ? `, and ${section.minSampleForClaim} are needed before a per-vendor rate means anything` : ""}.
        </p>
      </Panel>
    );
  }
  const top = Math.max(1, ...section.rows.map((r) => Number(r.submitted ?? r.total) || 0));
  return (
    <Panel title={section.label} hint={`${section.coveragePct}% of applications identified`}>
      <div className="mt-3 grid gap-2">
        {section.rows.map((row, i) => {
          const label = String(row.vendor ?? "—");
          const n = Number(row.submitted ?? row.total) || 0;
          const rate = Number(row.advanceRate);
          return (
            <div key={`${label}-${i}`} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-muted">{label}</span>
              <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-surface">
                <div className="h-full rounded-full bg-brand/60" style={{ width: `${(n / top) * 100}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right text-sm tabular-nums">{n}</span>
              <span className="w-12 shrink-0 text-right text-xs tabular-nums text-faint">
                {Number.isFinite(rate) ? `${rate}%` : "—"}
              </span>
            </div>
          );
        })}
      </div>
      {section.citation && <p className="mt-3 text-xs text-faint">{section.citation}</p>}
    </Panel>
  );
}
