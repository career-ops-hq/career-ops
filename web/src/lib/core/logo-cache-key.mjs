import { createHash } from "node:crypto";
import { normalizeTextKey } from "./normalize-text-key.mjs";

// Cache identity for name-resolved company logos (see app/api/logo/route.ts).
//
// The logo cache is written once per key and never revalidated — misses are
// stored as an empty sentinel precisely so a dead company is never refetched.
// That permanence puts two requirements on the key that a bare slug cannot meet:
//
//  1. It must change when candidate generation changes. Otherwise a machine
//     that cached a miss under the old resolver keeps serving that miss forever
//     and the improvement is invisible exactly where it was needed.
//  2. It must not collide. Two different companies sharing a key means one of
//     them wears the other's logo permanently, with no expiry to correct it.

/** Bump whenever `companyDomains()` in app/api/logo/route.ts changes which
 *  domains it tries, or in what order — OR whenever the key derivation itself
 *  changes, per requirement 1 above: an unchanged version leaves any entry
 *  poisoned under the old derivation permanently reachable, with nothing to
 *  correct it. The version is part of every key, so bumping it makes entries
 *  written by the previous resolver unreachable.
 *  v2: curated brand domains (notion.so, zoom.us, …) now precede slug guesses.
 *  v3: normalization switched from `[^a-z0-9]` to the Unicode-safe
 *  normalizeTextKey (#2369/#2666's own lesson, reintroduced here independently)
 *  — v2 stripped every non-ASCII letter, so "Škoda" and "Koda" hashed to the
 *  IDENTICAL key and one silently wore the other's logo forever (requirement 2,
 *  violated). Bumping discards any v2 entry poisoned this way rather than
 *  leaving it reachable under an unchanged "koda" key. */
export const COMPANY_KEY_VERSION = "v3";

/** Cache key for a company name, or null if the name carries nothing to key on.
 *
 *  Normalizing before hashing is deliberate: "Acme, Inc." and "acme inc" are one
 *  brand and should share one cached favicon across every card, this search and
 *  every future one. The digest is taken over the full normalized name so that
 *  truncating the readable prefix to 40 characters — which keeps cache files
 *  greppable by eye — cannot merge two long legal entity names into one entry.
 *
 *  normalizeTextKey (not a bare `[^a-z0-9]` strip) keeps non-ASCII letters —
 *  "Škoda" and "Koda", or two CJK company names, must NOT collapse onto the
 *  same key just because an ASCII-only filter would erase what distinguished
 *  them. See normalize-text-key.mjs's own header for the historical bug this
 *  reintroduces if reverted. */
/** Truncate to at most `n` Unicode CODE POINTS, not UTF-16 code units.
 *  `String.prototype.slice` counts code units, so it can land mid-surrogate-
 *  pair for a non-BMP letter (real: rarer Han characters live in the CJK
 *  Extension blocks, astral-plane code points) — cutting the pair leaves a
 *  lone surrogate in the key, an invalid UTF-16 string. Spreading a string
 *  iterates by code point, so the pair is always kept or dropped whole. */
function truncateCodePoints(s, n) {
  return [...s].slice(0, n).join("");
}

export function companyCacheKey(company) {
  const normalized = normalizeTextKey(company);
  if (!normalized) return null;
  // The digest covers the FULL normalized name (never truncated), so
  // collision-safety never depended on the prefix — only the prefix's own
  // validity as a string does.
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 10);
  return `co_${COMPANY_KEY_VERSION}_${truncateCodePoints(normalized, 40)}_${digest}`;
}
