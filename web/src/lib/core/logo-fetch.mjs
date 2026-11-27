import fs from "node:fs/promises";
import path from "node:path";

/**
 * Favicon lookup and cache write for app/api/logo/route.ts.
 *
 * Extracted so the one rule that matters can be exercised directly (a route
 * handler is not reachable from `node --test`, the same move as
 * company-domains.mjs): only an answer ABOUT THE DOMAIN may be cached.
 *
 * The logo cache never expires, and a miss is stored as an empty sentinel so
 * a company with no favicon is never refetched. That permanence is right for
 * an answer about the domain, and Google's favicon service gives one: the icon
 * with 200, or 404 (with a globe placeholder) for a domain it has no icon for.
 * A timeout, a network error, a 429 from a burst of lazy-loaded cards or a 5xx
 * says nothing about the domain. It used to be cached as a miss all the same,
 * which turned one bad moment into a monogram for that company forever.
 */

// A 200 this small is Google's placeholder rather than an icon.
const PLACEHOLDER_MAX_BYTES = 220;

/**
 * @typedef {{ kind: "hit", bytes: ArrayBuffer } | { kind: "miss" } | { kind: "unknown" }} LogoLookup
 */

/**
 * Fetch one domain's favicon from Google's tokenless service.
 * @param {string} domain
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<LogoLookup>}
 */
export async function fetchFavicon(domain, fetchFn = fetch) {
  try {
    const res = await fetchFn(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(3500),
      redirect: "follow",
    });
    if (res.status === 404) return { kind: "miss" };
    if (!res.ok) return { kind: "unknown" };
    const bytes = await res.arrayBuffer();
    return bytes.byteLength > PLACEHOLDER_MAX_BYTES ? { kind: "hit", bytes } : { kind: "miss" };
  } catch {
    // Timed out, offline, refused, or the body never finished arriving.
    return { kind: "unknown" };
  }
}

/**
 * Try each candidate domain in order; the first real favicon wins. The result
 * is a miss only when EVERY candidate was a definite miss: a candidate whose
 * lookup failed may have had the icon.
 * @param {string[]} candidates
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<LogoLookup>}
 */
export async function resolveLogo(candidates, fetchFn = fetch) {
  let unknown = false;
  for (const domain of candidates) {
    const result = await fetchFavicon(domain, fetchFn);
    if (result.kind === "hit") return result;
    if (result.kind === "unknown") unknown = true;
  }
  return { kind: unknown ? "unknown" : "miss" };
}

/**
 * Write a lookup to the permanent cache: the icon for a hit, the empty
 * sentinel for a miss, and nothing at all for an unknown, so the next request
 * asks again. Best-effort, like every cache write.
 * @param {string} file
 * @param {LogoLookup} result
 * @returns {Promise<boolean>} whether anything was written
 */
export async function cacheLogoResult(file, result) {
  if (result.kind === "unknown") return false;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, result.kind === "hit" ? Buffer.from(result.bytes) : new Uint8Array(0));
    return true;
  } catch {
    return false;
  }
}
