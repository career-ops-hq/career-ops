/**
 * Read a posting's JD on the server before an evaluate worker starts.
 *
 * The evaluate worker has no Bash (it reads an untrusted posting, so it cannot
 * be allowed to write), and its only way to read the web is WebFetch, which
 * converts a page to text and drops <script> content. Template-driven career
 * boards (Phenom, most bespoke sites) keep the whole job body in script data,
 * so WebFetch sees a page shell and the worker stops with "Needs review" on a
 * posting that is live. fetch-jd.mjs reads those sources (ATS API, then the
 * page's JSON-LD JobPosting) behind the egress guard, so the platform runs it
 * first and hands the text to the worker.
 *
 * A miss is the normal case for plain boards WebFetch reads fine. It returns
 * null and the worker falls back to WebFetch exactly as before.
 */

// A stub is not a posting. Same intent as MIN_JD_TEXT_CHARS in browser-extract.mjs.
export const MIN_PREFETCH_JD_CHARS = 400;

/** The posting URL when `input` is one; null for report numbers and local refs. */
export function postingUrlFrom(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try { new URL(value); } catch { return null; }
  return value;
}

/**
 * @param {unknown} input - the run input (a posting URL for evaluate runs)
 * @param {(script: string, args: string[]) => Promise<{code: number, stdout: string, timedOut?: boolean, spawnFailed?: boolean}>} run
 * @returns {Promise<string|null>} JD text, or null when the worker should WebFetch
 */
export async function prefetchJd(input, run) {
  const url = postingUrlFrom(input);
  if (!url) return null;
  try {
    const result = await run("fetch-jd", [url]);
    if (result.code !== 0 || result.timedOut || result.spawnFailed) return null;
    const text = String(result.stdout ?? "").trim();
    return text.length >= MIN_PREFETCH_JD_CHARS ? text : null;
  } catch {
    return null;
  }
}
