// HTTP transport helpers shared across providers.
// Files prefixed with _ are never loaded as providers by scan.mjs.

import './_dns-cache.mjs'; // memoize dns.lookup process-wide (see that file)
import { DEFAULT_USER_AGENT, BROWSER_LIKE_USER_AGENT } from '../user-agent.mjs';

export { BROWSER_LIKE_USER_AGENT };

const DEFAULT_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body = null, redirect = 'follow' } = {}, consume) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': DEFAULT_USER_AGENT, ...headers },
      body,
      redirect,
      signal: controller.signal,
    });
    if (!res.ok) {
      const responseText = await res.text().catch(() => '');
      // WAF/CDN challenge pages (seen live: Workday 429s) carry no actionable
      // text — HTML markup or a generic interstitial message, not worth
      // parsing or displaying. The status code and its standard reason
      // phrase are what a log line needs; the raw body is still attached as
      // err.body for callers that want to inspect it.
      const err = new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
      err.status = res.status;
      err.body = responseText;
      err.retryAfter = res.headers.get('retry-after');
      throw err;
    }
    // Body consumption must stay inside the timer window: a server that sends
    // headers and then stalls the body otherwise hangs the caller forever
    // (this froze full-directory sweeps silently — 20 workers all stuck on
    // stalled reads with the abort timer already cleared).
    return await consume(res);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.json());
}

export async function fetchText(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.text());
}

// Returns the raw Response (after the timeout + non-2xx guard) so providers that
// need response headers — e.g. startup.ch reads Set-Cookie to prime a session —
// can route through ctx instead of re-implementing fetch. Pass redirect:'error'
// like every other provider call so a 3xx can't be followed to a private IP.
export async function fetchResponse(url, opts = {}) {
  return await fetchWithTimeout(url, opts);
}

/** Jitter added to a backoff so concurrent retries don't re-collide in lockstep. */
const JITTER_MS = 250;

/**
 * Retry policy shared by providers that paginate a large board.
 *
 * Two retries = three total attempts, matching what #2506 asked for. Not every
 * provider wants this exact cadence — workday.mjs and oraclecloud.mjs pass
 * `{ retries: 3 }` explicitly to keep their own tuning — which is why the
 * policy is a parameter rather than baked in.
 */
const RETRY_DEFAULTS = { retries: 2, baseDelayMs: 500, maxDelayMs: 8_000 };

/**
 * undici's `err.cause.message` for a `fetch(url, { redirect: 'error' })` that
 * met a 3xx — the shape every provider's mandatory SSRF guard (#1440) produces
 * on a refused redirect. Not documented anywhere; pinned here (and by the test
 * in tests/providers/_http.test.mjs) so a future Node/undici bump that changes
 * the wording fails loudly instead of silently reverting to over-retrying.
 * Present since Node 18.5; older Node reports `cause` as `undefined`, so this
 * check doesn't fire and isRetryableError() falls through to its old
 * (retryable) classification.
 */
const REDIRECT_REFUSAL_CAUSE_MESSAGE = 'unexpected redirect';

/** Awaitable sleep that honours a ctx-supplied clock, so tests never wall-clock wait. */
function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Milliseconds from a Retry-After header, in either permitted form (delta
 * seconds or an HTTP-date). Null when absent or unparseable.
 */
export function parseRetryAfterMs(value) {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null;
}

/**
 * Whether a failed request is worth retrying: 429, any 5xx, or a transport
 * error (no status — timeout/abort/DNS). A 4xx other than 429 is the server
 * telling us the request itself is wrong, and retrying it just burns time.
 *
 * A refused redirect (redirect:'error' meeting a 3xx) surfaces as a bare
 * TypeError with no .status — the same shape as a transient network error —
 * but it's deterministic and will never succeed on retry. See
 * REDIRECT_REFUSAL_CAUSE_MESSAGE above for how it's distinguished.
 */
export function isRetryableError(err) {
  const status = err?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (status === undefined && err instanceof TypeError && err?.cause?.message === REDIRECT_REFUSAL_CAUSE_MESSAGE) return false;
  return status === undefined; // network error / timeout / abort — no status set
}

/**
 * Fetch JSON with bounded retry on transient failures.
 *
 * Shared by every provider that retries a fetch (a16z-speedrun-talent.mjs,
 * workday.mjs, oraclecloud.mjs, each via its own `policy` override — see
 * RETRY_DEFAULTS above) so all of them get the same mature semantics —
 * exponential backoff, jitter, and a Retry-After that is honoured but
 * CLAMPED so a hostile or misconfigured `Retry-After: 86400` cannot stall a
 * sweep — instead of each one re-deriving them independently.
 *
 * Deliberately does NOT decide what happens when retries are exhausted: it
 * rethrows, and the caller chooses. That policy genuinely differs per provider
 * — workday truncates the tenant with a warning and keeps the pages it has,
 * while a16z must fail loudly rather than return a silent partial board. The
 * rethrown error carries `.attempts` (how many requests were actually made)
 * so a caller logging a summary doesn't have to assume the full `retries + 1`
 * — a non-retryable error can end the loop after just one.
 *
 * @param {{fetchJson: Function, sleep?: Function}} ctx - Transport context.
 * @param {string} url - Absolute URL.
 * @param {object} [opts] - Passed through to ctx.fetchJson.
 * @param {{retries?: number, baseDelayMs?: number, maxDelayMs?: number}} [policy]
 * @returns {Promise<any>} Parsed JSON.
 */
export async function fetchJsonWithRetry(ctx, url, opts = {}, policy = {}) {
  const { retries, baseDelayMs, maxDelayMs } = { ...RETRY_DEFAULTS, ...policy };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await ctx.fetchJson(url, opts);
    } catch (err) {
      lastErr = err;
      err.attempts = attempt + 1;
      if (attempt === retries || !isRetryableError(err)) throw err;
      // Cap the backoff at maxDelayMs MINUS the jitter, so the jittered total
      // still honours the policy limit. Clamping the sum instead would erase
      // the jitter exactly at the cap — where every retry has converged on the
      // same delay and de-synchronising them matters most.
      //
      // The jitter itself is clamped to maxDelayMs first: a caller passing a
      // maxDelayMs below JITTER_MS would otherwise drive the backoff negative
      // and hand ctx.sleep a negative delay.
      const jitterMs = Math.min(JITTER_MS, Math.max(0, maxDelayMs));
      const ceiling = Math.max(0, maxDelayMs - jitterMs);
      const backoff = Math.min(baseDelayMs * 2 ** attempt, ceiling);
      const retryAfterMs = parseRetryAfterMs(err?.retryAfter);
      const delayMs = retryAfterMs !== null
        ? Math.min(retryAfterMs, maxDelayMs * 4)
        : backoff + Math.random() * jitterMs;
      await sleep(delayMs, ctx);
    }
  }
  throw lastErr;
}

export function makeHttpCtx() {
  return {
    transport: 'http',
    fetchJson,
    fetchText,
    fetchResponse,
  };
}
