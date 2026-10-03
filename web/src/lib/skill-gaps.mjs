// Shaping for the skill-gap panel.
//
// Pure .mjs so the CV page can import it and `node --test` can cover it.
//
// upskill.mjs does the weighting; nothing is recomputed here. What this module
// decides is when the map is trustworthy enough to show as advice, because two
// of its metadata fields describe conditions where the gaps are misleading
// rather than merely sparse — and both produce a map that LOOKS fine.

/**
 * @typedef {{skill: string, reports: number, lowFitReports: number,
 *            weightedScore: number, tier: string, sources: number[]}} Gap
 * @typedef {{kind: "no-known-skills"|"thin-coverage", text: string}} Caveat
 * @typedef {{available: boolean, reason: string|null, gaps: Gap[], caveats: Caveat[],
 *            reportsWithMachineSummary: number, reportsRead: number}} SkillGapModel
 */

/**
 * Build the panel model.
 *
 * @param {{available?: boolean, reason?: string|null, data?: object|null}|null|undefined} payload
 * @param {number} [limit] - Most-weighted gaps to keep.
 * @returns {SkillGapModel}
 */
export function skillGapModel(payload, limit = 8) {
  if (!payload?.available || !payload.data) {
    return {
      available: false,
      reason: typeof payload?.reason === "string" ? payload.reason : "unavailable",
      gaps: [],
      caveats: [],
      reportsWithMachineSummary: 0,
      reportsRead: 0,
    };
  }

  const d = payload.data;
  const m = d.metadata ?? {};
  const gaps = (Array.isArray(d.gaps) ? d.gaps : [])
    .filter((g) => g && typeof g.skill === "string" && g.skill.trim() !== "")
    .slice(0, Math.max(1, Math.trunc(limit)));

  /** @type {Caveat[]} */
  const caveats = [];

  // upskill.mjs's own comment: a CV that yields no known skills "would flood the
  // gap map with false gaps", because nothing can be subtracted as already-held.
  // The map still renders, which is exactly why this has to be said out loud —
  // a list of skills you already have, presented as things to learn, is worse
  // than no list.
  if (num(m.knownSkillCount) === 0) {
    caveats.push({
      kind: "no-known-skills",
      text:
        "No skills were recognised in your CV, so nothing could be subtracted as already-held — " +
        "some of these are probably skills you already have.",
    });
  }

  // Gaps come from reports carrying a Machine Summary. When most reports have
  // none, the map is drawn from a minority of the pipeline and says less about
  // the search than its confident ordering suggests.
  const withMs = num(m.reportsWithMachineSummary);
  const read = num(m.reportsRead);
  if (read > 0 && withMs > 0 && withMs * 2 < read) {
    caveats.push({
      kind: "thin-coverage",
      text: `Based on ${withMs} of ${read} reports — the rest carry no Machine Summary to read gaps from.`,
    });
  }

  return {
    available: true,
    reason: null,
    gaps,
    caveats,
    reportsWithMachineSummary: withMs,
    reportsRead: read,
  };
}

/**
 * Bar width for a gap, relative to the heaviest one shown.
 *
 * Relative and not absolute: `weightedScore` has no ceiling, so a fixed scale
 * would render every gap as a stub on one pipeline and a full bar on another.
 *
 * @param {Gap} gap
 * @param {Gap[]} all
 * @returns {number} 0-100
 */
export function barPct(gap, all) {
  const top = Math.max(...all.map((g) => (Number.isFinite(g.weightedScore) ? g.weightedScore : 0)), 0);
  if (top <= 0) return 0;
  const v = Number.isFinite(gap.weightedScore) ? gap.weightedScore : 0;
  return Math.max(2, Math.round((v / top) * 100));
}

function num(v) {
  return Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}
