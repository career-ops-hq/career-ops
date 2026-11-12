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

/** Does a prefetched JD carry the cut notice from lib/jd-page-fetch.mjs? Such text is not the whole posting. */
export function isTruncatedJd(text) {
  return typeof text === "string" && /\[Job description truncated here:/.test(text);
}

/** The posting URL when `input` is one; null for report numbers and local refs. */
export function postingUrlFrom(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!/^https?:\/\//i.test(value)) return null;
  try { new URL(value); } catch { return null; }
  return value;
}

/**
 * @typedef {{text: string|null, closedEvidence: string|null}} Prefetch
 */

/**
 * @param {unknown} input - the run input (a posting URL for evaluate runs)
 * @param {(script: string, args: string[], opts?: {signal?: AbortSignal}) => Promise<{code: number, stdout: string, timedOut?: boolean, spawnFailed?: boolean}>} run
 * @param {AbortSignal} [signal] the request's abort signal; an abort kills the child and is a miss
 * @returns {Promise<Prefetch>} `text` is the JD, or null when the worker should
 *   WebFetch; `closedEvidence` is set when the page's own data says the posting
 *   closed (fetch-jd exit 3), which the worker must not score past.
 */
export async function prefetchJd(input, run, signal) {
  const miss = { text: null, closedEvidence: null };
  const url = postingUrlFrom(input);
  if (!url || signal?.aborted) return miss;
  try {
    const result = await run("fetch-jd", [url], { signal });
    if (result.timedOut || result.spawnFailed) return miss;
    const out = String(result.stdout ?? "").trim();
    if (result.code === 3) {
      const m = /^CLOSED_POSTING ([\s\S]{1,200})$/.exec(out);
      return m ? { text: null, closedEvidence: m[1] } : miss;
    }
    if (result.code !== 0) return miss;
    return { text: out.length >= MIN_PREFETCH_JD_CHARS ? out : null, closedEvidence: null };
  } catch {
    return miss;
  }
}
