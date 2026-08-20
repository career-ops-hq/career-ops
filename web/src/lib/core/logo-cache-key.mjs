import { createHash } from "node:crypto";

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
 *  domains it tries, or in what order. The version is part of every key, so
 *  bumping it makes entries written by the previous resolver unreachable.
 *  v2: curated brand domains (notion.so, zoom.us, …) now precede slug guesses. */
export const COMPANY_KEY_VERSION = "v2";

/** Cache key for a company name, or null if the name carries nothing to key on.
 *
 *  Normalizing before hashing is deliberate: "Acme, Inc." and "acme inc" are one
 *  brand and should share one cached favicon across every card, this search and
 *  every future one. The digest is taken over the full normalized name so that
 *  truncating the readable prefix to 40 characters — which keeps cache files
 *  greppable by eye — cannot merge two long legal entity names into one entry. */
export function companyCacheKey(company) {
  const normalized = String(company ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized) return null;
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 10);
  return `co_${COMPANY_KEY_VERSION}_${normalized.slice(0, 40)}_${digest}`;
}
