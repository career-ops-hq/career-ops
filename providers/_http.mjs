// HTTP transport helpers shared across providers.
// Files prefixed with _ are never loaded as providers by scan.mjs.

import './_dns-cache.mjs'; // memoize dns.lookup process-wide (see that file)
import { isIP } from 'node:net';
import {
  DEFAULT_USER_AGENT,
  BROWSER_LIKE_USER_AGENT,
  MACOS_BROWSER_LIKE_USER_AGENT,
} from '../user-agent.mjs';
import { providerFetchContext, isBlockedAddress, blockedAddressError } from './_ip-guard.mjs';
import { currentConnectionScope, currentAbortSignal } from './_connection-scope.mjs';
import { normalizeUrl, aggregatorPostingId } from '../url-key.mjs';

/** @typedef {import('./_types.js').Context} Context */
/** @typedef {import('./_types.js').FetchOptions} FetchOptions */
/**
 * An `Error` carrying the HTTP response metadata this module attaches on a
 * non-2xx: `status`, the raw `body`, the `Retry-After` value, and (only under
 * `redirect: 'manual'`) the `Location` it would have followed. `attempts` is
 * added by the retry loop — the real request count, not the `retries + 1`
 * ceiling.
 *
 * @typedef {Error & { status?: number, body?: string, retryAfter?: (string | null), location?: (string | null), attempts?: number }} HttpError
 */

export { BROWSER_LIKE_USER_AGENT, MACOS_BROWSER_LIKE_USER_AGENT };

const MAX_TIMER_MS = 2_147_483_647; // setTimeout rewrites anything above this to 1ms

/**
 * Resolve the default per-request timeout from the environment.
 *
 * 10s suits almost every board, but a provider that returns its whole catalogue
 * in one response can legitimately need longer, and when it does the abort
 * surfaces as an unreachable portal rather than as a timeout — so the board
 * reads as broken instead of slow. Raising the budget is a deployment concern
 * rather than a code change, so it is read from the environment.
 *
 * Unusable values fall back to the default rather than failing a scan at
 * request time: a typo in an env var should not take the scanner down.
 *
 * "Unusable" includes anything outside setTimeout's honored range, not just
 * values that fail to parse. A delay below 1ms or above 2_147_483_647ms is
 * silently rewritten to 1ms, so accepting one would abort every request almost
 * immediately — the failure this variable exists to prevent, arrived at by a
 * typo instead of a slow board. Falling back is the quieter outcome: a scan at
 * the 10s default beats a scan where every portal reads as unreachable.
 *
 * @param {unknown} raw - Raw env value (CAREER_OPS_HTTP_TIMEOUT_MS).
 * @param {number} [fallback=10_000] - Value used when `raw` is unusable.
 * @returns {number} Milliseconds.
 */
export function resolveDefaultTimeoutMs(raw, fallback = 10_000) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_TIMER_MS) return fallback;
  return parsed;
}

const DEFAULT_TIMEOUT_MS = resolveDefaultTimeoutMs(process.env.CAREER_OPS_HTTP_TIMEOUT_MS);
let proxyAgent;
let proxySignature;

async function proxyFor(url) {
  if (process.env.CAREER_OPS_TRUST_PROXY_EGRESS !== '1') return { dispatcher: undefined, proxyHost: undefined };
  const target = new URL(url);
  const httpProxy = process.env.http_proxy || process.env.HTTP_PROXY || '';
  const httpsProxy = process.env.https_proxy || process.env.HTTPS_PROXY || httpProxy;
  const noProxy = process.env.no_proxy || process.env.NO_PROXY || '';
  const proxyUrl = target.protocol === 'https:' ? httpsProxy : httpProxy;
  if (!proxyUrl) return { dispatcher: undefined, proxyHost: undefined };
  for (const configuredProxy of [httpProxy, httpsProxy]) {
    if (!configuredProxy) continue;
    const parsed = new URL(configuredProxy);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const isLoopback = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
    if ((parsed.username || parsed.password) && parsed.protocol !== 'https:' && !isLoopback) {
      throw new Error('Proxy URLs containing credentials must use HTTPS to protect proxy authentication.');
    }
  }
  const proxyHost = new URL(proxyUrl).hostname.replace(/^\[|\]$/g, '');
  // The agent honours NO_PROXY and is scoped to this one provider request.
  // Unrelated fetches keep their normal dispatcher. A direct NO_PROXY request
  // still resolves its destination under the provider DNS guard.
  const signature = [process.env.http_proxy, process.env.HTTP_PROXY, process.env.https_proxy,
    process.env.HTTPS_PROXY, process.env.no_proxy, process.env.NO_PROXY].join('\0');
  // Existing installations can keep direct transport without installing undici.
  // Resolve the optional transport only after both the trust flag and proxy URL.
  const { EnvHttpProxyAgent, fetch: undiciFetch } = await import('undici').catch((cause) => {
    throw new Error('Trusted proxy egress requires undici; run npm install in the career-ops directory, then retry.', { cause });
  });
  if (signature !== proxySignature) {
    // proxyTunnel: true keeps every request, http:// included, on a CONNECT
    // tunnel through the proxy. That is the default in undici 6 and 7. From
    // undici 8 an http:// target is forwarded as an absolute-form request
    // instead, which is what turned tests/providers/proxy-egress.test.mjs red.
    proxyAgent = new EnvHttpProxyAgent({ httpProxy, httpsProxy, noProxy, proxyTunnel: true });
    proxySignature = signature;
  }
  return { dispatcher: proxyAgent, proxyHost, fetchImpl: undiciFetch };
}

/**
 * Run a fetch under an `AbortController` timeout, inside the provider-fetch
 * async context so the patched DNS lookup validates the addresses it resolves.
 * `consume` reads the body while the timer is still armed.
 *
 * @param {string} url
 * @param {FetchOptions} [opts]
 * @param {(res: Response) => Promise<any>} consume
 * @param {boolean} [allowManualRedirectResponse]
 * @returns {Promise<any>}
 */
async function fetchWithTimeout(url, opts = {}, consume, allowManualRedirectResponse = false) {
  const targetHost = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const { dispatcher, proxyHost, fetchImpl } = await proxyFor(url);
  // A literal IP host never reaches dns.lookup, so the lookup-time guard in
  // _ip-guard.mjs never sees it: http://127.0.0.1/, http://[::ffff:127.0.0.1]/
  // and http://2130706433/ were all dialled on the direct path while
  // http://localhost/ was refused. Check the literal here, on every path, not
  // only behind a proxy. `new URL()` has already normalised the integer, octal
  // and hex spellings of IPv4 to a dotted quad, and isBlockedAddress unwraps
  // the IPv4-mapped IPv6 form.
  if (isIP(targetHost) && isBlockedAddress(targetHost)) throw blockedAddressError(targetHost, targetHost);
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
  return providerFetchContext.run({ url: String(url), targetHost, proxyHost },
    () => fetchInContext(url, opts, consume, dispatcher, allowManualRedirectResponse, fetchImpl));
}

// redirect defaults to 'error': a provider fetch must never follow a 3xx, or a
// server-side redirect could point the request at a private address after the
// ip guard already passed the original host (#4079). Callers that really need
// to follow redirects opt in explicitly.
/**
 * @param {string} url
 * @param {FetchOptions} [opts]
 * @param {(res: Response) => Promise<any>} consume
 * @param {import('undici').Dispatcher} [dispatcher]
 * @param {boolean} [allowManualRedirectResponse]
 * @param {typeof fetch} [fetchImpl] undici's fetch when a proxy dispatcher is used; global fetch otherwise.
 * @returns {Promise<any>}
 */
async function fetchInContext(url, { timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, method = 'GET', body = null, redirect = 'error', onResponse } = {}, consume, dispatcher, allowManualRedirectResponse = false, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Defaults go through Headers so a caller's override wins whatever its
    // capitalization. An object spread only replaces an identical key: a caller's
    // 'User-Agent' sat beside the default 'user-agent', and fetch JOINED the two
    // into one comma-separated value instead of replacing it.
    const requestHeaders = new Headers(headers);
    if (!requestHeaders.has('user-agent')) requestHeaders.set('user-agent', DEFAULT_USER_AGENT);
    // accept-encoding is pinned to the codecs undici decodes correctly.
    // Left unset, Node negotiates zstd, and amazon.jobs' zstd response comes
    // back TRUNCATED AT 1024 BYTES with a 200 status — so the failure surfaces
    // as an unrelated-looking "Unterminated string in JSON at position 1024"
    // rather than a transport error. curl on the same URL returns the full
    // ~900KB. Callers can still override via `headers`.
    if (!requestHeaders.has('accept-encoding')) requestHeaders.set('accept-encoding', 'gzip, deflate, br');
    // A sweep runs each board inside withConnectionScope() so its sockets are
    // released when the board is done (see _connection-scope.mjs). The scope
    // brings its own fetch: undici's Agent is only safe with undici's fetch.
    // A trusted-proxy dispatcher, when configured, still takes precedence,
    // together with the fetchImpl proxyFor() paired it with.
    const scope = dispatcher ? undefined : currentConnectionScope();
    // A sweep's per-company watchdog aborts the board's signal when it times
    // out; fold it into this request's own timeout so an abandoned board stops
    // mid-flight instead of running on in the background (#5570). Read straight
    // from the store so it also applies on the trusted-proxy path, where the
    // pool `scope` is left undefined.
    const boardSignal = currentAbortSignal();
    const requestSignal = boardSignal
      ? AbortSignal.any([controller.signal, boardSignal])
      : controller.signal;
    let res;
    try {
      res = await (scope?.fetch ?? fetchImpl)(url, {
        method,
        headers: requestHeaders,
        body,
        redirect,
        signal: requestSignal,
        dispatcher: dispatcher ?? scope?.agent,
      });
    } catch (err) {
      if (!dispatcher && ['ENOTFOUND', 'EAI_AGAIN'].includes(err?.cause?.code)
        && (process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY)) {
        err.message += ' (proxy variables are set but provider requests use direct fetch; set CAREER_OPS_TRUST_PROXY_EGRESS=1 only if your proxy blocks private destination addresses)';
      }
      throw err;
    }
    onResponse?.(res);
    const isInspectableManualRedirect = allowManualRedirectResponse
      && redirect === 'manual'
      && res.status >= 300
      && res.status < 400;
    if (!res.ok && !isInspectableManualRedirect) {
      // The error body is diagnostic text, so it is read UNDER A CAP instead of
      // being buffered whole: a broken or hostile endpoint can serve a huge
      // (or endless) error page, and the abort timer limits the DURATION of
      // that read, not the number of bytes it buffers. Truncated at the cap,
      // never thrown over: the HTTP error is the one the caller must see.
      const responseText = await readBodyCapped(res, MAX_ERROR_BODY_BYTES, { truncate: true }).catch(() => '');
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

/**
 * Default ceiling for a full response body, applied by fetchJson/fetchText.
 *
 * Real board JSON is legitimately megabyte-sized (a 500-job Greenhouse board
 * runs into single-digit MBs), so the default is generous; the point is that
 * one hostile or broken endpoint can no longer pin the scanner's memory with
 * a single endless response. Per-call override: `opts.maxBytes`. The head
 * reader below keeps its own small default — it never wanted the whole body.
 */
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Ceiling for the body attached to a non-2xx error.
 *
 * An error body is diagnostic text — a WAF interstitial, a maintenance page,
 * an API error payload — never the data the caller asked for. It is capped
 * well below the default body ceiling so a sweep that meets a dozen failing
 * boards cannot turn their error pages into a memory problem. Every consumer
 * of `err.body` in this repo treats it as a snippet: providers/glints.mjs
 * parses it and falls back to its first 200 characters, providers/workday.mjs
 * looks for a marker inside it.
 */
export const MAX_ERROR_BODY_BYTES = 256 * 1024;

function bodyTooLarge(size, maxBytes) {
  const err = new Error(`HTTP body exceeded maxBytes of ${maxBytes}${size != null ? ` (content-length ${size})` : ''}`);
  err.code = 'response_too_large';
  err.maxBytes = maxBytes;
  return err;
}

/**
 * Resolve the body ceiling for one call.
 *
 * An explicit `maxBytes` must be a positive finite number. A NaN, a
 * negative value or a non-numeric string would silently DISABLE the cap
 * (`total > NaN` is never true), which is exactly the hole the cap exists to
 * close — so a bad value is refused rather than ignored.
 *
 * @param {number|undefined|null} value - The caller's ceiling, if any.
 * @returns {number} The ceiling in bytes.
 */
function resolveMaxBytes(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_BODY_BYTES;
  const bytes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(bytes)) {
    throw new TypeError(`maxBytes must be a positive finite number, got ${JSON.stringify(value)}`);
  }
  // The floor is the value that actually applies, so THAT is what has to be
  // positive: 0.5 would floor to a zero-byte cap, and every non-empty body
  // would then be refused with a size error nobody asked for.
  const floored = Math.floor(bytes);
  if (floored <= 0) {
    throw new TypeError(`maxBytes must be a positive finite number, got ${JSON.stringify(value)}`);
  }
  return floored;
}

/**
 * Read a response body as text, refusing to buffer more than `maxBytes`.
 *
 * Same streaming shape as fetchTextHead's cap (read, count, cancel), but this
 * THROWS instead of truncating: a cut-off JSON document or half-rendered HTML
 * must never masquerade as the board's answer. A declared content-length over
 * the cap is refused before a single body byte is read. Stays inside the
 * caller's timer window, like every other body consumption here.
 *
 * `truncate` flips that one decision for the error path, where the HTTP
 * status is the answer the caller needs and the body is only a snippet: the
 * read stops at the cap and returns what it has instead of throwing. The body
 * is cancelled either way, so the connection is released.
 *
 * @param {Response} res
 * @param {number} maxBytes
 * @param {{truncate?: boolean}} [opts]
 * @returns {Promise<string>} The body, decoded as UTF-8.
 */
async function readBodyCapped(res, maxBytes, { truncate = false } = {}) {
  const declared = Number(res.headers.get('content-length'));
  if (!truncate && Number.isFinite(declared) && declared > maxBytes) {
    // Cancel before refusing: an unread body keeps its socket alive, and a
    // provider sweep holds many of them at once. The size error is the one
    // that matters, so a failed cancel must not replace it.
    try {
      await res.body?.cancel?.();
    } catch {
      /* preserve the size error when cancellation fails */
    }
    throw bodyTooLarge(declared, maxBytes);
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    // No stream to count (a mocked or exotic response): the whole body is
    // already in memory here, so the cap can only shorten what is kept.
    const text = await res.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      if (!truncate) throw bodyTooLarge(bytes, maxBytes);
      return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
    }
    return text;
  }
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        if (!truncate) throw bodyTooLarge(null, maxBytes);
        // Keep the part of this chunk that still fits: a diagnostic marker
        // (providers/workday.mjs looks for one) can sit right at the ceiling,
        // and dropping the whole chunk would throw it away.
        const keep = maxBytes - (total - value.length);
        if (keep > 0) chunks.push(Buffer.from(value).subarray(0, keep));
        break; // the finally cancels the body
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* body already closed */
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch and parse a JSON response, with the shared timeout and non-2xx guard.
 *
 * The body is read through the capped reader (see DEFAULT_MAX_BODY_BYTES); JSON
 * here is board data, always UTF-8, so a text decode + parse is equivalent to
 * res.json() for every board this repo talks to.
 *
 * @param {string} url
 * @param {FetchOptions} [opts]
 * @returns {Promise<any>} Parsed JSON.
 * @throws {HttpError} On a non-2xx response.
 * @throws {Error} `code: 'response_too_large'` when the body exceeds `opts.maxBytes` (default DEFAULT_MAX_BODY_BYTES).
 */
export async function fetchJson(url, opts = {}) {
  const maxBytes = resolveMaxBytes(opts.maxBytes);
  return fetchWithTimeout(url, opts, async (res) => {
    // res.json() stripped a leading UTF-8 BOM (the spec's UTF-8 decode does);
    // decoding the body as text and parsing it by hand does not, so a
    // BOM-prefixed board answer would stop parsing here.
    const text = await readBodyCapped(res, maxBytes);
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  });
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
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<string>} The first maxBytes of the body, decoded as UTF-8.
 * @throws {HttpError} On a non-2xx response.
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

/**
 * Fetch a response body as text, with the shared timeout and non-2xx guard.
 *
 * The body is read through the capped reader (see DEFAULT_MAX_BODY_BYTES).
 *
 * @param {string} url
 * @param {FetchOptions} [opts]
 * @returns {Promise<string>}
 * @throws {HttpError} On a non-2xx response.
 * @throws {Error} `code: 'response_too_large'` when the body exceeds `opts.maxBytes` (default DEFAULT_MAX_BODY_BYTES).
 */
export async function fetchText(url, opts = {}) {
  const maxBytes = resolveMaxBytes(opts.maxBytes);
  return fetchWithTimeout(url, opts, async (res) => readBodyCapped(res, maxBytes));
}

// Returns a Response (after the timeout + non-2xx guard) so providers that need
// response headers — csod.mjs reads Set-Cookie to prime the session its search
// API requires — can route through ctx instead of re-implementing fetch. Pass
// redirect:'error' is the default here like everywhere else, so a 3xx can't be
// followed to a private IP.
//
// The body is read here, inside the timer window, and handed back as an
// equivalent Response. Under redirect:'manual', a 3xx is also returned so a
// stateful provider can inspect and validate Location before following it;
// fetchText/fetchJson retain their existing structured-error contract. Two
// reasons the response is reconstructed: returning the live Response would let a
// server that stalls its body hang the caller forever with the abort timer
// already cleared (the failure fetchWithTimeout documents above), and this
// function previously omitted the `consume` argument entirely, so it threw
// "consume is not a function" on every call — it had no working callers to
// preserve bug-compatibility with. Header identity, including repeated
// Set-Cookie (getSetCookie()), survives the reconstruction.
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
/**
 * Like {@link fetchJson} / {@link fetchText}, but resolves to a reconstructed
 * `Response` (body already read inside the timeout window) so a provider can
 * read response headers — csod.mjs reads Set-Cookie to prime its session. Pass
 * `redirect: 'error'` like every other provider call.
 *
 * @param {string} url
 * @param {FetchOptions} [opts]
 * @returns {Promise<Response>}
 * @throws {HttpError} On a non-2xx response.
 */
export async function fetchResponse(url, opts = {}) {
  const maxBytes = resolveMaxBytes(opts.maxBytes);
  return await fetchWithTimeout(url, opts, async (res) => {
    // Read under the same ceiling as the other fetchers: this is the last
    // unbounded body read in the transport, and a provider that only wanted a
    // header should not be handed a whole hostile page.
    let body;
    try {
      body = NULL_BODY_STATUSES.has(res.status) ? null : await readBodyCapped(res, maxBytes);
    } catch (err) {
      // The headers are the point of this call — csod.mjs reads Set-Cookie,
      // peoplesoft.mjs reads Set-Cookie and Location — so a body that was too
      // big must not take them away with it. They travel on the error, and the
      // caller can still read them.
      if (err?.code === 'response_too_large') err.headers = res.headers;
      throw err;
    }
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  }, true);
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

/**
 * Awaitable sleep that honours a ctx-supplied clock, so tests never wall-clock
 * wait. `ctx` is the SECOND argument — a swapped `sleep(ctx, ms)` hands an
 * object to `setTimeout` and resolves on the next tick instead of pacing.
 *
 * @param {number} ms - Delay in milliseconds.
 * @param {{ sleep?: (ms: number) => Promise<void> }} [ctx] - Transport context; a
 *   `sleep` clock on it (tests supply one) is awaited instead of `setTimeout`.
 * @returns {Promise<void>}
 */
export function sleep(ms, ctx) {
  if (typeof ctx?.sleep === 'function') return ctx.sleep(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * sleep(), but resolves at once if `signal` aborts partway — a retry backoff
 * must not keep a board the watchdog has already given up on pending for its
 * full delay (#5570).
 *
 * @param {number} ms
 * @param {{ sleep?: (ms: number) => Promise<void> }} [ctx]
 * @param {AbortSignal | null} [signal]
 * @returns {Promise<void>}
 */
export function abortableSleep(ms, ctx, signal) {
  if (!signal) return sleep(ms, ctx);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); resolve(); };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    // Settle with the sleep's own result so a rejecting clock propagates
    // instead of hanging the promise and surfacing as an unhandled rejection.
    Promise.resolve(sleep(ms, ctx)).then(
      (value) => { cleanup(); resolve(value); },
      (err) => { cleanup(); reject(err); },
    );
  });
}

/**
 * Milliseconds from a Retry-After header, in either permitted form (delta
 * seconds or an HTTP-date). Null when absent or unparseable.
 *
 * @param {(string | null | undefined)} value - Raw `Retry-After` header value.
 * @returns {(number | null)}
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
 *
 * @param {any} err - A thrown value: an Error with an optional `.status`, or anything else.
 * @returns {boolean}
 */
export function isRetryableError(err) {
  const status = err?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (isRefusedRedirectError(err)) return false;
  // A body over the cap is not a transient failure: the same response would be
  // refused again, so retrying only downloads the oversize body a second and
  // third time. The size error carries no status, so without this it would
  // fall through to the network-error case below.
  if (err?.code === 'response_too_large') return false;
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
 * @param {{ sleep?: (ms: number) => Promise<void> }} ctx - Transport context (may supply a test clock).
 * @param {{ retries?: number, baseDelayMs?: number, maxDelayMs?: number }} [policy]
 * @returns {Promise<any>} Whatever `request` resolves to on its first success.
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
      // A board whose watchdog has already fired must not keep retrying: that is
      // the 4-attempts-per-slice storm a timed-out Workday board left running in
      // the background (#5570). The abort is terminal, not a transient failure.
      if (attempt === retries || !isRetryableError(err) || currentAbortSignal()?.aborted) throw err;
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
      // Interruptible: if the board's watchdog fires during the backoff, stop
      // waiting and give up rather than sleeping out the delay and then issuing
      // a doomed attempt (#5570).
      await abortableSleep(delayMs, ctx, currentAbortSignal());
      if (currentAbortSignal()?.aborted) throw lastErr;
    }
  }
  throw lastErr;
}

/**
 * Fetch JSON with bounded retry on transient failures.
 *
 * @param {{ fetchJson: (url: string, opts?: FetchOptions) => Promise<any>, sleep?: (ms: number) => Promise<void> }} ctx - Transport context.
 * @param {string} url - Absolute URL.
 * @param {FetchOptions} [opts] - Passed through to ctx.fetchJson.
 * @param {{ retries?: number, baseDelayMs?: number, maxDelayMs?: number }} [policy]
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
 * @param {{ fetchText: (url: string, opts?: FetchOptions) => Promise<string>, sleep?: (ms: number) => Promise<void> }} ctx - Transport context.
 * @param {string} url - Absolute URL.
 * @param {FetchOptions} [opts] - Passed through to ctx.fetchText.
 * @param {{ retries?: number, baseDelayMs?: number, maxDelayMs?: number }} [policy]
 * @returns {Promise<string>} Response body.
 */
export async function fetchTextWithRetry(ctx, url, opts = {}, policy = {}) {
  return withRetry(() => ctx.fetchText(url, opts), ctx, policy);
}

/**
 * Fetch a raw Response (headers included — e.g. Set-Cookie) with bounded
 * retry on transient failures. Same policy as fetchJsonWithRetry /
 * fetchTextWithRetry; exists for providers that need response headers on a
 * retried request (a stateful multi-hop scrape carrying a session cookie
 * across GET/POST steps, e.g. peoplesoft.mjs) instead of just the body.
 *
 * @param {{fetchResponse: Function, sleep?: Function}} ctx - Transport context.
 * @param {string} url - Absolute URL.
 * @param {object} [opts] - Passed through to ctx.fetchResponse.
 * @param {{retries?: number, baseDelayMs?: number, maxDelayMs?: number}} [policy]
 * @returns {Promise<Response>}
 */
export async function fetchResponseWithRetry(ctx, url, opts = {}, policy = {}) {
  return withRetry(() => ctx.fetchResponse(url, opts), ctx, policy);
}

/**
 * Build the default HTTP transport context passed to `provider.fetch()` when
 * no test stub is injected.
 *
 * @param {{ onRequest?: () => void, onResponse?: (status: number) => void }} [observer]
 * @returns {Context}
 */
export function makeHttpCtx(observer) {
  const ctx = {
    transport: 'http',
    fetchJson,
    fetchText,
    fetchResponse,
    // The canonical posting-URL key, so a provider can deduplicate its own
    // results the way the tracker and scanner do. Handing it over through ctx
    // is what keeps the behaviour identical: `url-key.mjs` is dependency-free,
    // so a standalone provider receives the same function the core calls rather
    // than importing the file or copying its body (#4218).
    normalizePostingUrl: normalizeUrl,
    // The requisition id an aggregator URL carries, for the same reason: a
    // provider that reads LinkedIn or Indeed links gets the extractor the
    // tracker's merge uses, not a regex of its own that drifts from it.
    aggregatorPostingId,
  };
  if (!observer) return ctx;
  for (const method of ['fetchJson', 'fetchText', 'fetchResponse']) {
    const original = ctx[method];
    ctx[method] = (url, opts = {}) => {
      observer.onRequest?.();
      return original(url, {
        ...opts,
        onResponse: response => {
          opts.onResponse?.(response);
          observer.onResponse?.(response.status);
        },
      });
    };
  }
  return ctx;
}
