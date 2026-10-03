// Shaping for the ATS keyword-coverage panel.
//
// Pure .mjs so the report view can import it and `node --test` can cover it,
// matching funnel-tiles.mjs / awaiting.mjs.
//
// Nothing here matches keywords — keyword-match.mjs does that, synonyms and all.
// What this decides is how its verdict is PRESENTED, and the one decision that
// carries risk is the tier split.
//
// `thin` is documented in keyword-match.mjs as a SUBSET of `present` (keywords
// mentioned exactly once), and coverage counts thin keywords as present. So a
// panel that renders `present` and `thin` as two lists shows the thin ones
// twice, and a reader counting the lists gets a total larger than `total`.
// splitTiers() subtracts, so the three tiers partition the keyword set exactly.

/**
 * @typedef {{term: string}} Kw
 * @typedef {{key: "covered"|"thin"|"missing", label: string, hint: string, terms: string[]}} Tier
 * @typedef {{available: boolean, reason: string|null, total: number, presentCount: number,
 *            coveragePct: number|null, tiers: Tier[]}} CoverageModel
 */

/**
 * Partition the keyword set into three disjoint tiers.
 *
 * @param {{present?: string[], thin?: string[], missing?: string[]}} result
 * @returns {Tier[]}
 */
export function splitTiers(result) {
  const present = arr(result?.present);
  const thin = arr(result?.thin);
  const missing = arr(result?.missing);

  // Case-insensitive, because the two lists come from the same extraction and
  // should agree exactly — but a future change to either must not silently
  // start double-counting.
  const thinSet = new Set(thin.map((t) => t.toLowerCase()));
  const covered = present.filter((t) => !thinSet.has(t.toLowerCase()));

  return [
    {
      key: "covered",
      label: "Covered",
      hint: "mentioned more than once",
      terms: covered,
    },
    {
      key: "thin",
      label: "Thin",
      hint: "mentioned once — consider reinforcing",
      terms: thin,
    },
    {
      key: "missing",
      label: "Missing",
      hint: "not found in the CV",
      terms: missing,
    },
  ];
}

/**
 * The panel's model from the route's payload.
 *
 * Accepts null/undefined so a failed fetch can call it directly — an
 * unavailable panel is a normal state here, not an exception.
 *
 * @param {{available?: boolean, reason?: string|null, result?: object|null}|null|undefined} payload
 * @returns {CoverageModel}
 */
export function coverageModel(payload) {
  if (!payload?.available || !payload.result) {
    return {
      available: false,
      reason: typeof payload?.reason === "string" ? payload.reason : "unavailable",
      total: 0,
      presentCount: 0,
      coveragePct: null,
      tiers: [],
    };
  }

  const r = payload.result;
  const total = num(r.total);
  return {
    available: true,
    reason: null,
    total,
    presentCount: num(r.presentCount),
    // A percentage over no keywords is not 0% coverage, it is no measurement —
    // the same rule the analytics rates follow.
    coveragePct: total > 0 && Number.isFinite(r.coveragePct) ? r.coveragePct : null,
    tiers: splitTiers(r),
  };
}

/**
 * A coarse band for colouring, never a pass/fail.
 *
 * Deliberately three wide bands rather than a threshold: keyword-match.mjs is
 * explicitly DIAGNOSTIC, and a red "fail" badge would push the reader toward
 * stuffing the CV with terms — the exact behaviour the project rule
 * ("Keywords get reformulated, never fabricated") exists to prevent.
 *
 * @param {number|null} pct
 * @returns {"unknown"|"low"|"mid"|"high"}
 */
export function coverageBand(pct) {
  if (pct === null || !Number.isFinite(pct)) return "unknown";
  if (pct >= 75) return "high";
  if (pct >= 50) return "mid";
  return "low";
}

function arr(v) {
  return Array.isArray(v) ? v.filter((t) => typeof t === "string" && t.trim() !== "") : [];
}
function num(v) {
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}
