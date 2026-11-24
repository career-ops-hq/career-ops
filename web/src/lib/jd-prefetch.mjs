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

// The browser read (browser-extract.mjs --mode jd): the last server-side reader, for pages that need a
// real browser (Dayforce) or whose host challenges Node's fetch but not a browser (Workday, #7182).
const BROWSER_TEXT_CAP = 20_000;
const BROWSER_TIMEOUT_MS = 20_000;
const MIN_BROWSER_JD_WORDS = 80;
// Same wording lib/jd-page-fetch.mjs appends to a cut text, so isTruncatedJd() recognises it and
// the route refuses to score a partial posting.
const browserTruncationNotice = (cap) =>
  `[Job description truncated here: the posting is longer than ${cap} characters. This text is NOT the complete job description.]`;

// A Chromium per evaluation would exhaust memory on a batch: at most this many browser reads at once.
const MAX_BROWSER_READS = 2;
let activeBrowserReads = 0;
const browserQueue = [];

/**
 * Run `fn` holding one of the browser slots. A queued caller whose request is aborted leaves the
 * queue without ever running (null). A freed slot passes straight to the next waiter, so the
 * count never dips below the number of reads actually running.
 */
async function withBrowserSlot(signal, fn) {
  if (signal?.aborted) return null;
  if (activeBrowserReads < MAX_BROWSER_READS) {
    activeBrowserReads++;
  } else {
    const granted = await new Promise((resolve) => {
      const onAbort = () => {
        const i = browserQueue.indexOf(waiter);
        if (i !== -1) browserQueue.splice(i, 1);
        resolve(false);
      };
      const waiter = () => { signal?.removeEventListener("abort", onAbort); resolve(true); };
      browserQueue.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    if (!granted) return null;
  }
  try {
    return signal?.aborted ? null : await fn();
  } finally {
    const next = browserQueue.shift();
    if (next) next(); else activeBrowserReads--;
  }
}

/** Same page? Host without `www.` and path without a trailing slash, query and fragment ignored. */
function samePage(requested, final) {
  try {
    const norm = (u) => { const x = new URL(u); return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "").toLowerCase()}`; };
    return norm(requested) === norm(final);
  } catch { return false; }
}

/** The posting text from a browser-extract result, or null when it is not a posting-sized read. */
function browserJdText(result, requestedUrl) {
  if (result.timedOut || result.spawnFailed || result.code !== 0) return null;
  let data;
  try { data = JSON.parse(String(result.stdout ?? "")); } catch { return null; }
  // A job link that redirected to a search or listing page is not the posting that was asked for.
  if (typeof data?.url === "string" && !samePage(requestedUrl, data.url)) return null;
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (text.length < MIN_PREFETCH_JD_CHARS || text.split(/\s+/).length < MIN_BROWSER_JD_WORDS) return null;
  return text.length > BROWSER_TEXT_CAP ? `${text}\n\n${browserTruncationNotice(BROWSER_TEXT_CAP)}` : text;
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
    // --visible only adds a last tier after the ATS API and the page's structured data miss,
    // so one run covers every reader. The worker's WebFetch is the next reader after a miss,
    // but a hook (context-mode) can intercept it and leave the worker with no way to read the
    // page (#7507), so read the visible text here. One run, not a plain run plus a retry: the
    // run has a single 30s budget, and a second full fetch of a slow or rate-limiting page
    // would time out and send the worker to the blocked WebFetch.
    const result = await run("fetch-jd", [url, "--visible"], { signal });
    if (result.timedOut || result.spawnFailed) return miss;
    const out = String(result.stdout ?? "").trim();
    if (result.code === 3) {
      const m = /^CLOSED_POSTING ([\s\S]{1,200})$/.exec(out);
      return m ? { text: null, closedEvidence: m[1] } : miss;
    }
    if (result.code === 1 && !signal?.aborted) {
      // A plain miss: no ATS API, no structured data, no readable page text. Read it in a browser
      // here, before the worker starts, because the worker's own WebFetch may be blocked (#7507).
      const browser = await withBrowserSlot(signal, () => run("browser-extract", [url, "--mode", "jd", "--max-chars", String(BROWSER_TEXT_CAP), "--timeout", String(BROWSER_TIMEOUT_MS)], { signal }));
      return { text: browser ? browserJdText(browser, url) : null, closedEvidence: null };
    }
    if (result.code !== 0) return miss;
    return { text: out.length >= MIN_PREFETCH_JD_CHARS ? out : null, closedEvidence: null };
  } catch {
    return miss;
  }
}
