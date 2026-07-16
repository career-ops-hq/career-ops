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

/**
 * Similarity of two fingerprints: 1 − hammingDistance/64. Empty or malformed
 * fingerprints never match (returns 0).
 *
 * @param {string} a - 16-hex-char fingerprint.
 * @param {string} b - 16-hex-char fingerprint.
 * @returns {number} 0..1.
 */
export function similarity(a, b) {
  if (!/^[0-9a-f]{16}$/.test(a || '') || !/^[0-9a-f]{16}$/.test(b || '')) return 0;
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let dist = 0;
  while (x) {
    dist += Number(x & 1n);
    x >>= 1n;
  }
  return 1 - dist / 64;
}

/** Company key for "different employer" checks — same normalization family as
 * the tracker tooling (lowercase alphanumerics). */
function companyKey(name) {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Find possible cross-listings: new offers whose fingerprint is near-identical
 * to a recent history row from a DIFFERENT company. Same-company matches are
 * re-posts (detect-reposts.mjs territory), not cross-listings — skipped here.
 *
 * Pure function: pass the offers and pre-parsed history rows in.
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

  const recent = historyRows.filter((r) => {
    if (!r.fingerprint) return false;
    const t = Date.parse(r.dateStr);
    return !Number.isNaN(t) && t >= cutoff;
  });

  const matches = [];
  for (const offer of offers) {
    if (!offer.fingerprint) continue;
    const offerCompany = companyKey(offer.company);
    for (const row of recent) {
      if (companyKey(row.company) === offerCompany) continue; // re-post, not cross-listing
      if (row.url === offer.url) continue;
      const score = similarity(offer.fingerprint, row.fingerprint);
      if (score >= threshold) matches.push({ offer, row, score });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}
