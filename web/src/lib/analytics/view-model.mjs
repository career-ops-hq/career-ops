// Shaping for the Analytics progress + stats views.
//
// Pure JS so the page can import it and `node --test` can cover it, matching
// funnel-tiles.mjs / awaiting.mjs.
//
// ── Why there is a module here at all ───────────────────────────────────────
//
// Nothing below COMPUTES a metric. stats.mjs and analyze-patterns.mjs already
// do that, and computeFunnel()'s docstring in stats.mjs is the canonical funnel
// definition that the Go dashboard's ComputeProgressMetrics mirrors — a second
// implementation in the web is how those three start disagreeing (#2369).
//
// What this module does is decide WHAT MAY BE SHOWN. Both core scripts ship
// honesty signals next to their numbers — `smallSample`, `sufficientSample`,
// `minSampleForClaim`, `coveragePct` — and a view that renders the number while
// dropping the caveat turns a hedged figure into a confident one. Those rules
// are the part worth testing, so they live here rather than inside JSX.

/**
 * @typedef {{key: string, label: string, value: number}} FunnelStage
 * @typedef {{key: string, label: string, value: number|null}} FunnelRate
 *   `value: null` means the rate has no denominator — absent, not zero.
 * @typedef {{tracked: number, active: number, offers: number, avgScore: number|null, topScore: number|null}} ProgressTotals
 *   `reason` is null when available; otherwise why not, which decides whether
 *   the view explains itself or stays quiet.
 * @typedef {{available: boolean, reason: "no-core"|"no-data"|null, totals: ProgressTotals, funnel: {stages: FunnelStage[], rates: FunnelRate[]}, provisional: boolean}} ProgressModel
 *
 * @typedef {Record<string, string|number|undefined>} BreakdownRow
 * @typedef {{key: "threshold", label: string, value: number|null, note: string|null, sampleSize: number|null, provisional: boolean}} ThresholdSection
 * @typedef {{key: string, label: string, rows: BreakdownRow[], dimension: string, partial: boolean}} BreakdownSection
 * @typedef {{key: "vendor", label: string, rows: BreakdownRow[], claimable: boolean, coveragePct: number, minSampleForClaim: number, identified: number, citation: string|null}} VendorSection
 * @typedef {ThresholdSection|BreakdownSection|VendorSection} StatsSection
 * @typedef {{state: "unavailable"|"below-threshold"|"ready", progress: {current: number, threshold: number|null, message: string}|null, sections: StatsSection[]}} StatsModel
 */

/** A rate that cannot be computed is absent, never 0. */
const NO_RATE = null;

/**
 * A percentage is only meaningful when something was counted.
 *
 * `responseRate: 0` with nothing applied means "no data", not "0% of employers
 * replied" — and a 0% response rate shown to someone who has not applied yet is
 * the app telling them their search is failing before it has started.
 *
 * @param {number|undefined} rate - Percentage from the core.
 * @param {number|undefined} denominator - Count the rate was taken over.
 * @returns {number|null}
 */
export function rateOrNull(rate, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return NO_RATE;
  if (!Number.isFinite(rate)) return NO_RATE;
  return rate;
}

/**
 * The progress view's model, from stats.mjs's payload.
 *
 * @param {object|null} stats - Parsed stats.mjs output, or null when unavailable.
 * @returns {ProgressModel}
 */
export function progressModel(stats) {
  const tracker = stats?.tracker ?? null;
  const funnel = stats?.funnel ?? null;
  if (!tracker || !funnel) {
    // Two different facts, and collapsing them is how the Conversion block
    // disappears for every new user with no explanation. "no-core" is stats.mjs
    // not being reachable at all — a non-event worth staying quiet about.
    // "no-data" is stats.mjs running fine and reporting it has no tracker yet,
    // which is the normal starting state and needs to be said out loud.
    // stats.mjs already distinguishes them in its own metadata, so read that
    // rather than guess from the absence.
    const reason = stats ? "no-data" : "no-core";
    return { available: false, reason, totals: { tracked: 0, active: 0, offers: 0, avgScore: null, topScore: null }, funnel: { stages: [], rates: [] }, provisional: false };
  }

  const n = (v) => (Number.isFinite(v) ? v : 0);

  // Cumulative, in lifecycle order — the everApplied ⊇ everResponded ⊇
  // everInterview ⊇ everOffer nesting stats.mjs guarantees. Rendered in this
  // order so a later stage can never appear larger than an earlier one.
  const stages = [
    { key: "everApplied", label: "Applied", value: n(funnel.everApplied) },
    { key: "everResponded", label: "Responded", value: n(funnel.everResponded) },
    { key: "everInterview", label: "Interviewed", value: n(funnel.everInterview) },
    { key: "everOffer", label: "Offers", value: n(funnel.everOffer) },
  ];

  // Each rate is gated on the count it is taken over, not on its own value.
  const rates = [
    { key: "responseRate", label: "Response rate", value: rateOrNull(funnel.responseRate, funnel.everApplied) },
    { key: "interviewRate", label: "Interview rate", value: rateOrNull(funnel.interviewRate, funnel.everApplied) },
    { key: "offerRate", label: "Offer rate", value: rateOrNull(funnel.offerRate, funnel.everApplied) },
  ];

  return {
    available: true,
    reason: null,
    totals: {
      tracked: n(tracker.total),
      active: n(tracker.activeApps),
      offers: n(funnel.everOffer),
      avgScore: Number.isFinite(tracker.avgScore) && tracker.total > 0 ? tracker.avgScore : null,
      topScore: Number.isFinite(tracker.topScore) && tracker.total > 0 ? tracker.topScore : null,
    },
    funnel: { stages, rates },
    // stats.mjs's own flag. Carried through so the view can mark the rates
    // provisional instead of presenting three percentages off four applications
    // as a finding.
    provisional: funnel.smallSample === true,
  };
}

/**
 * The stats view's model, from analyze-patterns.mjs's payload.
 *
 * Its "not enough data" reply is a RESULT, not an error: the core states the
 * threshold and how close the user is, which is more useful than an empty panel.
 *
 * @param {object|null} patterns - Parsed analyze-patterns.mjs output, or null.
 * @returns {StatsModel}
 */
export function statsModel(patterns) {
  if (!patterns) return { state: "unavailable", progress: null, sections: [] };

  if (typeof patterns.error === "string") {
    return {
      state: "below-threshold",
      progress: {
        current: Number.isFinite(patterns.current) ? patterns.current : 0,
        threshold: Number.isFinite(patterns.threshold) ? patterns.threshold : null,
        message: patterns.error,
      },
      sections: [],
    };
  }

  /** @type {StatsSection[]} */
  const sections = [];

  // Quality threshold. Shown as a recommendation only when the core says the
  // sample supports one; otherwise the reasoning is shown WITHOUT the number,
  // because a "recommended 4.7" off three outcomes reads as a rule.
  const t = patterns.scoreThreshold;
  if (t && Number.isFinite(t.recommended)) {
    sections.push({
      key: "threshold",
      label: "Quality threshold",
      value: t.sufficientSample ? t.recommended : null,
      note: typeof t.reasoning === "string" ? t.reasoning : null,
      sampleSize: Number.isFinite(t.sampleSize) ? t.sampleSize : null,
      provisional: t.sufficientSample !== true,
    });
  }

  // Breakdowns. An "Unknown"-only breakdown is not an insight — it means the
  // reports carry no metadata for that axis, and showing a single Unknown bar at
  // 100% invites the reader to conclude something about their search from the
  // absence of a field.
  for (const [key, label, rows, dim] of [
    ["archetype", "Archetype mix", patterns.archetypeBreakdown, "archetype"],
    ["remote", "Work mode", patterns.remotePolicy, "policy"],
    ["companySize", "Company size", patterns.companySizeBreakdown, "size"],
  ]) {
    const list = Array.isArray(rows) ? rows.filter((r) => Number.isFinite(r?.total) && r.total > 0) : [];
    const named = list.filter((r) => !isUnlabelled(r?.[dim]));
    if (named.length === 0) continue;
    sections.push({ key, label, rows: list, dimension: dim, partial: named.length < list.length });
  }

  // Per-ATS advance rate. The core states the sample it needs and how much of
  // the pipeline it could actually identify; below either, there is no claim to
  // make and the panel says why rather than rendering an empty chart.
  const v = patterns.vendorAnalysis;
  if (v) {
    const identified = Number.isFinite(v.identified) ? v.identified : 0;
    const need = Number.isFinite(v.minSampleForClaim) ? v.minSampleForClaim : 0;
    const enough = identified >= need && Array.isArray(v.breakdown) && v.breakdown.length > 0;
    sections.push({
      key: "vendor",
      label: "By ATS vendor",
      rows: enough ? v.breakdown : [],
      claimable: enough,
      coveragePct: Number.isFinite(v.coveragePct) ? v.coveragePct : 0,
      minSampleForClaim: need,
      identified,
      citation: typeof v.citation === "string" ? v.citation : null,
    });
  }

  return { state: "ready", progress: null, sections };
}

/**
 * Whether a breakdown label carries no information.
 *
 * `Unknown` / `unknown` / `` / `—` all mean "the reports did not say".
 *
 * @param {unknown} label
 * @returns {boolean}
 */
export function isUnlabelled(label) {
  const s = String(label ?? "").trim().toLowerCase();
  return s === "" || s === "unknown" || s === "n/a" || s === "—" || s === "-";
}
