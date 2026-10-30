/**
 * title-fit.mjs — banded title-vs-profile-role estimate for discovery cards.
 *
 * Deliberately mirrors the tokenizer style of profile-keywords.mjs /
 * jd-similarity.mjs instead of importing them: the Turbopack root is pinned
 * to web/, which makes repo-root .mjs imports impossible, and this module must
 * stay unit-testable under plain Node (tests/title-fit.test.mjs).
 *
 * CONTRACT (same posture as jd-similarity.mjs): this is deliberately a
 * RECOMMENDATION layer. It annotates offers with a coarse band so the user can
 * decide what to evaluate first. It NEVER gates, filters, orders, or replaces
 * the holistic evaluation score — the card tooltip says exactly that.
 *
 * Why token overlap instead of reusing firstMatch(): the existing `matched`
 * chip is a case-insensitive SUBSTRING test, so a `platform engineer` chip can
 * never match the perfectly good title "Staff Engineer, Platform". Comparing
 * word sets catches those, plus punctuation and word-order differences.
 *
 * Exposes:
 *   titleFit(title, targets): { band: 'strong'|'related'|'weak', score } | null
 *     — best token-overlap ratio between ONE target role phrase and the title.
 *       null when either side yields no usable tokens (callers omit the chip).
 */

/**
 * @typedef {Object} TitleFit
 * @property {'strong'|'related'|'weak'} band Coarse triage word — never a percentage in the UI.
 * @property {number} score Rounded overlap ratio (tests/debugging only).
 */

/**
 * @param {string|undefined|null} title Posting title as printed by the scanner.
 * @param {string[]|undefined|null} targets Profile target-role phrases.
 * @returns {TitleFit|null} Best band across targets, or null when nothing usable.
 */

// Letters/digits across scripts, plus +#/. so c#, c++, node.js, .net survive.
const TOKEN_RE = /[\p{L}\p{N}+#.]+/gu;

// Seniority/level words say nothing about WHICH role a title describes: without
// excluding them, "Senior Platform Engineer" would only ever reach 2/3 against
// the target "platform engineer" and read as a partial match. Mirrors the
// spirit of LEVELS / SENIORITY_TOKENS in jd-similarity.mjs.
const SENIORITY = new Set([
  "junior", "jr", "mid", "middle", "senior", "sr", "staff", "principal",
  "lead", "head", "chief", "associate", "assistant", "intern", "internship",
  "entry", "level", "ii", "iii", "iv",
]);

function tokens(text) {
  const raw = String(text ?? "").toLowerCase().match(TOKEN_RE) ?? [];
  return raw
    // TOKEN_RE keeps sentence-ending periods so dotted names survive intact
    // (node.js, .net); strip only TERMINAL dots afterwards, or "Engineer."
    // stops equalling "engineer" (CodeRabbit, #3261). Internal/leading dots stay.
    .map((t) => t.replace(/\.+$/, ""))
    .filter((t) => t.length > 1 && !SENIORITY.has(t));
}

export function titleFit(title, targets) {
  const titleTokens = new Set(tokens(title));
  if (!titleTokens.size || !Array.isArray(targets)) return null;

  let best = -1;
  for (const target of targets) {
    const roleTokens = [...new Set(tokens(target))];
    if (!roleTokens.length) continue;
    let hits = 0;
    for (const t of roleTokens) if (titleTokens.has(t)) hits++;
    best = Math.max(best, hits / roleTokens.length);
  }
  if (best < 0) return null;

  // Bands, not numbers: people triage in words, and a pseudo-precise percentage
  // next to the evaluation's real 1–5/A–F would invite comparing the two. The
  // score stays on the object for tests/debugging but the UI renders only the
  // band. Thresholds: a lone shared generic token ("engineer") lands weak,
  // roughly half the role's tokens lands related, most of them strong.
  const rounded = Math.round(best * 100) / 100;
  const band = rounded >= 0.6 ? "strong" : rounded >= 0.34 ? "related" : "weak";
  return { band, score: rounded };
}
