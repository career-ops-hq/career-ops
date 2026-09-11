// HTTP transport helpers shared across providers.
// Files prefixed with _ are never loaded as providers by scan.mjs.

import './_dns-cache.mjs'; // memoize dns.lookup process-wide (see that file)
import {
  DEFAULT_USER_AGENT,
  BROWSER_LIKE_USER_AGENT,
  MACOS_BROWSER_LIKE_USER_AGENT,
} from '../user-agent.mjs';
import { providerFetchContext } from './_ip-guard.mjs';

export { BROWSER_LIKE_USER_AGENT, MACOS_BROWSER_LIKE_USER_AGENT };

const DEFAULT_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, opts = {}, consume) {
  // Mark this request as provider traffic for the whole of its async life, so
  // the patched dns.lookup validates the addresses it resolves (#3096). The
  // guard is scoped rather than global because _dns-cache.mjs patches
  // node:dns process-wide, and loopback has to keep working for everything
  // that is not a provider fetch — see providers/_ip-guard.mjs.
  //
  // AsyncLocalStorage.run wraps the ENTIRE fetch, not just the call that
  // starts it: the DNS lookup happens inside connect, well after the
  // synchronous part of fetch() has returned, and the context has to still be
  // entered when it does.
  return providerFetchContext.run({ url: String(url) }, () => fetchInContext(url, opts, consume));
}

async function fetchInContext(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body = null, redirect = 'follow' } = {}, consume) {
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
      // Only ever populated under redirect:'manual', where the 3xx arrives as a
      // non-ok response instead of being followed or thrown. Attached so a
      // caller can tell WHICH redirect it hit without gaining the ability to
      // follow it: jobvite distinguishes a feed pointing at NoJobs.htm (an
      // empty board) from a board pointing at search.jobvite.com?invalid=1 (a
      // retired tenant), and those two need opposite handling. Relative, as the
      // server wrote it — resolve against the request URL before matching.
      err.location = res.headers.get('location');
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

/**
 * Fetch only the head of a text response.
 *
 * Board landing pages carry the owner's name in <title>, but the page itself can
 * be a megabyte of embedded job JSON (jobs.lever.co ships ~950KB and ignores a
 * Range request). Reading the whole thing to learn one string would be exactly the
 * "slow and rude to the careers site" behavior the probe path avoids elsewhere, so
 * this stops at maxBytes and cancels the body.
 *
 * @param {string} url
 * @param {{maxBytes?: number}} [opts]
 * @returns {Promise<string>} The first maxBytes of the body, decoded as UTF-8.
 */
export async function fetchTextHead(url, opts = {}) {
  const maxBytes = opts.maxBytes ?? 8192;
  return fetchWithTimeout(url, opts, async (res) => {
    const reader = res.body?.getReader?.();
    if (!reader) return String(await res.text()).slice(0, maxBytes);
    const chunks = [];
    let total = 0;
    try {
      while (total < maxBytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        total += value.length;
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* body already closed */
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  });
}

export async function fetchText(url, opts = {}) {
  return fetchWithTimeout(url, opts, (res) => res.text());
}

// Returns a Response (after the timeout + non-2xx guard) so providers that need
// response headers — csod.mjs reads Set-Cookie to prime the session its search
// API requires — can route through ctx instead of re-implementing fetch. Pass
// redirect:'error' like every other provider call so a 3xx can't be followed to
// a private IP.
//
// The body is read here, inside the timer window, and handed back as an
// equivalent Response. Two reasons: returning the live Response would let a
// server that stalls its body hang the caller forever with the abort timer
// already cleared (the failure fetchWithTimeout documents above), and this
// function previously omitted the `consume` argument entirely, so it threw
// "consume is not a function" on every call — it had no working callers to
// preserve bug-compatibility with. Header identity, including repeated
// Set-Cookie (getSetCookie()), survives the reconstruction.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
export async function fetchResponse(url, opts = {}) {
  return await fetchWithTimeout(url, opts, async (res) => {
    const body = NULL_BODY_STATUSES.has(res.status) ? null : await res.text();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
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
export function sleep(ms, ctx) {
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
 * Whether a failure is a redirect refused by the mandatory SSRF guard —
 * `redirect:'error'` meeting a 3xx (#1440). It arrives as a bare TypeError
 * with no `.status`, indistinguishable by shape from a timeout or a DNS
 * failure, and only `err.cause.message` tells them apart.
 *
 * Exported because the verdict has two consumers, not one. isRetryableError()
 * below needs it to stop retrying; discover-ats.mjs needs it to stop telling a
 * human to re-run. Before it was shared, those two disagreed about the same
 * error object: the retry layer called it deterministic while the CLI reported
 * "board status unknown — re-run", and 48 of one user's 62 companies were
 * BambooHR answering "no such tenant" with a 302 (#3788).
 *
 * @param {any} err
 * @returns {boolean}
 */
export function isRefusedRedirectError(err) {
  return err?.status === undefined
    && err instanceof TypeError
    && err?.cause?.message === REDIRECT_REFUSAL_CAUSE_MESSAGE;
}

/**
 * Whether a failed request is worth retrying: 429, any 5xx, or a transport
 * error (no status — timeout/abort/DNS). A 4xx other than 429 is the server
 * telling us the request itself is wrong, and retrying it just burns time.
 *
 * A refused redirect (redirect:'error' meeting a 3xx) surfaces as a bare
 * TypeError with no .status — the same shape as a transient network error —
 * but it's deterministic and will never succeed on retry. See
 * isRefusedRedirectError() above for how it's distinguished.
 */
export function isRetryableError(err) {
  const status = err?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (isRefusedRedirectError(err)) return false;
  return status === undefined; // network error / timeout / abort — no status set
}

/**
 * Bounded retry on transient failures, around any request.
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
 * Nothing in the loop ever inspected the response body, so it is parameterised
 * by the request rather than duplicated per content type: `fetchJsonWithRetry`
 * and `fetchTextWithRetry` are the same policy over a different transport call.
 * Splitting them into two copies is how the entity decoders drifted (#1555,
 * #1639).
 *
 * @param {() => Promise<any>} request - Performs one attempt.
 * @param {{sleep?: Function}} ctx - Transport context (may supply a test clock).
 * @param {{retries?: number, baseDelayMs?: number, maxDelayMs?: number}} [policy]
 */
async function withRetry(request, ctx, policy = {}) {
  const { retries, baseDelayMs, maxDelayMs } = { ...RETRY_DEFAULTS, ...policy };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await request();
    } catch (err) {
      lastErr = err;
      // A rejection isn't guaranteed to be an object — assigning a property to
      // a primitive (a string, a number) throws in strict mode (ESM always is),
      // which would replace the real rejection with an unrelated TypeError
      // right here in the catch, before any caller sees it.
      if (err !== null && (typeof err === 'object' || typeof err === 'function')) err.attempts = attempt + 1;
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

/**
 * Fetch JSON with bounded retry on transient failures.
 *
 * @param {{fetchJson: Function, sleep?: Function}} ctx - Transport context.
 * @param {string} url - Absolute URL.
 * @param {object} [opts] - Passed through to ctx.fetchJson.
 * @param {{retries?: number, baseDelayMs?: number, maxDelayMs?: number}} [policy]
 * @returns {Promise<any>} Parsed JSON.
 */
export async function fetchJsonWithRetry(ctx, url, opts = {}, policy = {}) {
  return withRetry(() => ctx.fetchJson(url, opts), ctx, policy);
}

/**
 * Fetch text with bounded retry on transient failures.
 *
 * Same policy as the JSON form; exists because rate limiting is not a property
 * of the content type. jobvite's XML feed answers `429 Retry-After: 30` from
 * the second request onward — reliably enough that scanning two tenants
 * back-to-back trips it — and a scraped HTML board is just as capable of a
 * transient 5xx as a JSON API. Also used by providers that resolve config
 * (e.g. a board id) from a one-shot page fetch before pagination even starts
 * — that single request used to have no retry at all, so a single
 * DNS/TLS/connection blip on it failed the whole provider before a single
 * page was ever fetched.
 *
 * @param {{fetchText: Function, sleep?: Function}} ctx - Transport context.
 * @param {string} url - Absolute URL.
 * @param {object} [opts] - Passed through to ctx.fetchText.
 * @param {{retries?: number, baseDelayMs?: number, maxDelayMs?: number}} [policy]
 * @returns {Promise<string>} Response body.
 */
export async function fetchTextWithRetry(ctx, url, opts = {}, policy = {}) {
  return withRetry(() => ctx.fetchText(url, opts), ctx, policy);
}

export function makeHttpCtx() {
  return {
    transport: 'http',
    fetchJson,
    fetchText,
    fetchResponse,
  };
}
