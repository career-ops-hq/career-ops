/**
 * fingerprint-core.mjs — zero-dependency JD-content fingerprinting (#1597).
 *
 * The same job can enter the pipeline twice before any tracker row exists:
 * once as a direct company listing and once as an agency re-post with the
 * employer name stripped. URL and company+role dedup both miss that pair —
 * but agencies rarely rewrite the requirements text, so a content fingerprint
 * of the JD body catches it.
 *
 * Design: 64-bit SimHash over 3-token shingles of the normalized description.
 * SimHash keeps near-duplicate texts within a few bits of each other, so one
 * 16-hex-char column per scan-history row is enough to compare any pair later
 * without storing the body itself. Zero LLM cost, zero dependencies.
 *
 * Coverage is deliberately partial: the scanner is zero-token and only sees
 * descriptions a provider's list API already returns (e.g. Lever's
 * `descriptionPlain`). Offers without a usable body get an empty fingerprint
 * and are never matched — no body, no signal, no false positives.
 */

import { createHash } from 'crypto';
import { normalizeTextKey } from './tracker-parse.mjs';

/** Descriptions shorter than this (after normalization) carry too little
 * signal to distinguish real matches from boilerplate — skip them. */
export const FINGERPRINT_MIN_TEXT = 200;

/** Similarity at or above this is reported as a possible cross-listing.
 * 0.92 ≈ at most 5 of 64 SimHash bits differ — near-verbatim bodies. */
export const CROSSLIST_THRESHOLD = 0.92;

/** Only compare against history this recent (mirrors detect-reposts.mjs). */
export const CROSSLIST_WINDOW_DAYS = 90;

/**
 * Normalize JD text for shingling: strip tags/entities/URLs, lowercase,
 * collapse everything non-alphanumeric (unicode-aware) to single spaces.
 *
 * @param {string} text - Raw description (may contain HTML).
 * @returns {string} Normalized token stream, space-separated.
 */
export function normalizeJdText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * 64-bit SimHash of a text, as 16 lowercase hex chars — or '' when the
 * normalized text is too short to fingerprint (see FINGERPRINT_MIN_TEXT).
 *
 * @param {string} text - Raw description text.
 * @returns {string} 16-hex-char fingerprint, or '' when not fingerprintable.
 */
export function fingerprintText(text) {
  const normalized = normalizeJdText(text);
  if (normalized.length < FINGERPRINT_MIN_TEXT) return '';
  const tokens = normalized.split(' ');
  // Length alone can pass on <3 tokens (e.g. an unspaced CJK body normalizes
  // to one giant token). No shingle would ever be hashed, leaving an all-zero
  // hash that similarity() would score 1.0 against every other degenerate
  // body — treat it as unfingerprintable instead.
  if (tokens.length < 3) return '';
  const weights = new Array(64).fill(0);
  for (let i = 0; i <= tokens.length - 3; i++) {
    const shingle = `${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`;
    const digest = createHash('sha1').update(shingle).digest();
    // First 8 bytes of the SHA-1 as the shingle's 64-bit hash.
    for (let bit = 0; bit < 64; bit++) {
      const byte = digest[bit >> 3];
      weights[bit] += (byte >> (7 - (bit & 7))) & 1 ? 1 : -1;
    }
  }
  let hash = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (weights[bit] > 0) hash |= 1n << BigInt(63 - bit);
  }
  return hash.toString(16).padStart(16, '0');
}

/** A fingerprint is exactly 16 lowercase hex chars; anything else never
 * matches. Hoisted to module scope so the hot path reuses one compiled regex
 * rather than re-evaluating a literal on every call. */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

/** Set-bit count for every 16-bit value, built once at module load (64 KB).
 * A 64-bit Hamming distance then costs four table lookups instead of the 64
 * BigInt shift/mask iterations this module used to run per comparison, and
 * findCrossListings compares offers × history rows, so that per-pair cost is
 * multiplied by the product of both list lengths (#2381). */
const POPCOUNT16 = (() => {
  const table = new Uint8Array(1 << 16);
  for (let i = 1; i < table.length; i++) table[i] = table[i >> 1] + (i & 1);
  return table;
})();

/**
 * Number of set bits in a 32-bit word.
 *
 * Sign is irrelevant: both masks yield a non-negative 0..65535 index, so a
 * negative int32 (which `^` produces whenever the top bit is set) indexes the
 * table just as correctly as a positive one.
 *
 * @param {number} x - Any 32-bit integer.
 * @returns {number} 0..32.
 */
function popcount32(x) {
  return POPCOUNT16[x & 0xffff] + POPCOUNT16[(x >>> 16) & 0xffff];
}

/**
 * Split a fingerprint that has already passed FINGERPRINT_RE into its two
 * 32-bit halves.
 *
 * JS bitwise operators are 32-bit, so the 64-bit value is carried as a pair.
 * A single Number would lose precision above 2^53, and a BigInt allocates on
 * every operation — the exact cost this rewrite removes.
 *
 * @param {string} fp - Validated 16-hex-char fingerprint.
 * @returns {{hi: number, lo: number}} Upper and lower 32 bits, as int32.
 */
function splitFingerprint(fp) {
  const s = String(fp);
  return { hi: parseInt(s.slice(0, 8), 16) | 0, lo: parseInt(s.slice(8, 16), 16) | 0 };
}

/**
 * Similarity of two fingerprints: 1 − hammingDistance/64. Empty or malformed
 * fingerprints never match (returns 0).
 *
 * @param {string} a - 16-hex-char fingerprint.
 * @param {string} b - 16-hex-char fingerprint.
 * @returns {number} 0..1.
 */
export function similarity(a, b) {
  if (!FINGERPRINT_RE.test(a || '') || !FINGERPRINT_RE.test(b || '')) return 0;
  const x = splitFingerprint(a);
  const y = splitFingerprint(b);
  return 1 - (popcount32(x.hi ^ y.hi) + popcount32(x.lo ^ y.lo)) / 64;
}

/**
 * Largest Hamming distance (0..64) that still scores at or above `threshold`,
 * or -1 when no distance does.
 *
 * Derived by evaluating the SAME `1 - d / 64 >= threshold` comparison the
 * per-pair path used to run, not by rounding `64 * (1 - threshold)`. For
 * integer d, `d / 64` is exact in binary floating point, so the sequence is
 * exactly monotonic and this search reproduces the old accept/reject decision
 * at every threshold — including one landing exactly on a bit boundary, where a
 * floor()/ceil() derivation is off by one in one direction. The negated
 * comparison also makes a NaN threshold return -1 (reject everything), matching
 * what `score >= NaN` did before.
 *
 * @param {number} threshold - Minimum similarity, normally 0..1.
 * @returns {number} Maximum accepted bit distance, or -1 when none qualifies.
 */
function maxDistanceFor(threshold) {
  for (let d = 0; d <= 64; d++) {
    if (!(1 - d / 64 >= threshold)) return d - 1;
  }
  return 64;
}

/**
 * Company key for "different employer" checks.
 *
 * Delegates to the shared normalizeTextKey() (#2393/#2445) rather than the
 * `[a-z0-9]` strip it used to carry. That strip DELETED every non-Latin name,
 * so アクメ株式会社, グロベックス合同会社 and Яндекс all keyed to '' and compared
 * equal — and because findCrossListings() SKIPS same-key pairs as re-posts,
 * an identical posting shared between two genuinely different non-Latin
 * employers was silently never reported as a cross-listing. The Latin
 * equivalent was reported normally (#2500).
 *
 * The key keeps combining marks, so Devanagari/Arabic names differing only in
 * matras stay distinct rather than collapsing into one "employer".
 */
function companyKey(name) {
  return normalizeTextKey(String(name ?? ''));
}

/**
 * Find possible cross-listings: new offers whose fingerprint is near-identical
 * to a recent history row from a DIFFERENT company. Same-company matches are
 * re-posts (detect-reposts.mjs territory), not cross-listings — skipped here.
 *
 * Pure function: pass the offers and pre-parsed history rows in.
 *
 * This is O(offers × recentHistory), so everything that depends on only one
 * side of a pair is hoisted out of the inner loop: each row's companyKey and
 * fingerprint halves are computed once when `recent` is built, each offer's
 * once per offer, and the threshold is converted once into a maximum bit
 * distance. The inner loop is then two integer compares plus four table
 * lookups. Results are byte-identical to the per-pair similarity() version —
 * see tests/fingerprint-core.test.mjs, which differentially tests this against
 * a reference copy of the old implementation.
 *
 * @param {Array<{url: string, company: string, title: string, fingerprint?: string}>} offers
 * @param {Array<{url: string, dateStr: string, company: string, title: string, fingerprint?: string}>} historyRows
 * @param {{today?: Date, threshold?: number, windowDays?: number}} [opts]
 * @returns {Array<{offer: object, row: object, score: number}>} Matches, best first.
 */
export function findCrossListings(offers, historyRows, opts = {}) {
  const threshold = opts.threshold ?? CROSSLIST_THRESHOLD;
  const windowDays = opts.windowDays ?? CROSSLIST_WINDOW_DAYS;
  const today = opts.today ? new Date(opts.today) : new Date();
  const cutoff = today.getTime() - windowDays * 86400000;
  const maxDist = maxDistanceFor(threshold);
  // A malformed (or absent) fingerprint on either side scores 0, exactly as
  // similarity()'s regex guard did. 0 is still a match for a caller passing
  // threshold <= 0, so the zero-score branch is kept rather than dropped.
  const zeroScores = 0 >= threshold;

  // One pass over history: the date filter, companyKey and fingerprint split
  // all happen once per row instead of once per (offer, row) pair. Iteration
  // order is preserved so the pre-sort match order is unchanged.
  const recent = [];
  for (const row of historyRows) {
    if (!row.fingerprint) continue;
    const t = Date.parse(row.dateStr);
    if (Number.isNaN(t) || t < cutoff) continue;
    const valid = FINGERPRINT_RE.test(row.fingerprint);
    const half = valid ? splitFingerprint(row.fingerprint) : null;
    recent.push({ row, key: companyKey(row.company), url: row.url, valid, hi: half ? half.hi : 0, lo: half ? half.lo : 0 });
  }

  const matches = [];
  for (const offer of offers) {
    if (!offer.fingerprint) continue;
    const offerCompany = companyKey(offer.company);
    const offerValid = FINGERPRINT_RE.test(offer.fingerprint);
    // Nothing an invalid offer fingerprint is compared against can score above
    // 0, so when 0 is below the threshold the whole inner loop is dead.
    if (!offerValid && !zeroScores) continue;
    const half = offerValid ? splitFingerprint(offer.fingerprint) : null;
    const offerHi = half ? half.hi : 0;
    const offerLo = half ? half.lo : 0;
    for (const cand of recent) {
      if (cand.key === offerCompany) continue; // re-post, not cross-listing
      if (cand.url === offer.url) continue;
      let score;
      if (offerValid && cand.valid) {
        const dist = popcount32(offerHi ^ cand.hi) + popcount32(offerLo ^ cand.lo);
        // `dist > maxDist` is exactly `1 - dist / 64 < threshold` by the
        // construction of maxDistanceFor() — no float compare in the hot path.
        if (dist > maxDist) continue;
        score = 1 - dist / 64;
      } else {
        if (!zeroScores) continue;
        score = 0;
      }
      matches.push({ offer, row: cand.row, score });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}
