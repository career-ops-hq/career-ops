/**
 * robots-check.mjs — may the headed liveness retry fetch this URL? (#5776)
 *
 * When the headless liveness check meets an anti-bot wall,
 * checkUrlLivenessWithFallback (liveness-browser.mjs) retries the same URL in
 * a headed Chromium. That retry exists only to get past a bot wall, so it is
 * the most aggressive fetch career-ops makes, and it runs against any posting
 * URL a user pastes or a scan finds, including hosts no maintainer reviewed.
 * This module reads the site's published robots.txt first, and the retry runs
 * only when that file permits the path. The first headless request is not
 * gated, and this is not a claim that career-ops is "robots.txt-compliant".
 *
 * Rules (RFC 9309), deliberately on the cautious side:
 *   - the group naming career-ops's own product token (the one in
 *     DEFAULT_USER_AGENT) is used when it holds a rule, otherwise `*`;
 *   - longest match wins, and an equal-length Allow/Disallow tie goes to
 *     Disallow (Google resolves ties to Allow; this does not);
 *   - `*` matches any run of characters and a trailing `$` anchors the end;
 *     a `$` anywhere else is literal;
 *   - patterns and the request path are both percent-decoded before matching;
 *   - blank lines inside a record do not end it, and one leading UTF-8 byte
 *     order mark is skipped (both fail open in Python's robotparser).
 *
 * Fail-closed. Only three outcomes allow the retry: a robots.txt whose rules
 * permit the path, a 404 or 410 (no published policy), and an empty body.
 * Everything short of confirmed permission skips it, each with its own
 * `code`: 401/403, 429 and every other status, 5xx, a timeout, a host that
 * does not resolve or resolves into private space, a 200 that is not a
 * robots.txt (an HTML error page parses to zero rules, which would read as
 * allow-all), a rule line holding a byte that is not valid UTF-8, a body over
 * the RFC's 500 KiB parse floor, and too many redirects. Skipping the retry
 * never drops a posting: the headless `uncertain` verdict is kept, and
 * `uncertain` is never recorded as expired.
 *
 * Egress. robots.txt is fetched with DEFAULT_USER_AGENT through
 * providers/_http.mjs fetchResponse, the transport every provider uses: it
 * carries the shared timeout, the body cap, the literal-IP check and the
 * lookup-time `isBlockedAddress` guard that also closes DNS rebinding. Before
 * each hop this module also resolves the host itself and refuses a non-public
 * address, so a blocked host gets a distinct code and tests can inject a
 * resolver. Redirects are followed by hand (RFC 9309 asks for at least five),
 * http(s) only, and every hop is guarded again.
 *
 * Ported from tools/robots_check.py in MadsLorentzen/ai-job-search
 * (https://github.com/MadsLorentzen/ai-job-search), under the MIT License:
 *
 *   Copyright (c) 2026 Mads Lorentzen
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit
 *   persons to whom the Software is furnished to do so, subject to the
 *   following conditions:
 *
 *   The above copyright notice and this permission notice shall be included
 *   in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 *   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 *   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
 *   NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 *   USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * What the port changes: the matcher, grouping, soft-200 and U+FFFD checks
 * are carried over as they are. The transport is not: the original shells out
 * to curl and retries a refused robots.txt with a browser User-Agent, while
 * this reads it once, as career-ops, through the provider transport. The
 * original also checks the `*` group in addition to its own agent's; this
 * follows RFC 9309 group selection, as #5776 specifies.
 */

import { isIP } from 'node:net';
import { DEFAULT_USER_AGENT } from './user-agent.mjs';
import { isBlockedAddress } from './providers/_ip-guard.mjs';

/**
 * The product token career-ops sends, read out of DEFAULT_USER_AGENT
 * (`Mozilla/5.0 (compatible; career-ops/1.0; ...)`) so the two cannot drift.
 */
export const ROBOTS_PRODUCT_TOKEN = (/compatible;\s*([A-Za-z_-]+)\//.exec(DEFAULT_USER_AGENT)?.[1] ?? 'career-ops').toLowerCase();

/** RFC 9309 section 2.5: a parser must read at least 500 KiB. Larger is refused, not truncated. */
export const ROBOTS_MAX_BYTES = 500 * 1024;
export const ROBOTS_TIMEOUT_MS = 10_000;
/** RFC 9309 section 2.3.1.2: follow at least five consecutive redirects. */
export const ROBOTS_MAX_REDIRECTS = 5;

const DIRECTIVES = new Set(['user-agent', 'allow', 'disallow', 'sitemap', 'crawl-delay', 'host']);
const RULE_FIELDS = new Set(['user-agent', 'allow', 'disallow']);

const stripBom = (text) => (String(text ?? '').startsWith('﻿') ? String(text).slice(1) : String(text ?? ''));
const lines = (text) => stripBom(text).split(/\r\n|\r|\n/);
const uncomment = (line) => {
  const hash = line.indexOf('#');
  return hash === -1 ? line : line.slice(0, hash);
};

/**
 * Percent-decode like Python's urllib.parse.unquote: valid UTF-8 escape runs
 * are decoded, and a malformed or partial escape (`%`, `%zz`, `%E0%A4`) is
 * left as written. decodeURIComponent throws on those instead, and a throw at
 * this point would end in a crash or a skipped rule.
 *
 * @param {string} value
 * @returns {string}
 */
export function percentDecode(value) {
  return String(value).replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      // Decode what can be decoded one escape at a time; an escape that does
      // not form valid UTF-8 with its neighbours stays as text.
      let out = '';
      const bytes = run.match(/%[0-9A-Fa-f]{2}/g);
      let i = 0;
      while (i < bytes.length) {
        let decoded = null;
        // A UTF-8 sequence is at most four bytes: try the longest first.
        for (let n = Math.min(4, bytes.length - i); n >= 1; n--) {
          try {
            decoded = decodeURIComponent(bytes.slice(i, i + n).join(''));
            i += n;
            break;
          } catch {
            decoded = null;
          }
        }
        if (decoded === null) {
          out += bytes[i];
          i += 1;
        } else {
          out += decoded;
        }
      }
      return out;
    }
  });
}

/**
 * Does this body actually look like a robots.txt?
 *
 * A misconfigured host can answer /robots.txt with 200 and an HTML error page.
 * That body parses to zero rules, and zero rules read as "allowed", so a
 * soft-200 would grant permission that was never given. An empty or
 * whitespace-only body IS a valid allow-all under RFC 9309; a non-empty body
 * with no recognised directive is unreadable.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isRobotsBody(text) {
  const body = stripBom(text);
  if (!body.trim()) return true;
  for (const raw of lines(body)) {
    const line = uncomment(raw).trim().toLowerCase();
    const colon = line.indexOf(':');
    if (colon !== -1 && DIRECTIVES.has(line.slice(0, colon).trim())) return true;
  }
  return false;
}

/**
 * Does a User-agent, Allow or Disallow line hold U+FFFD?
 *
 * U+FFFD stands in for a byte that did not decode as UTF-8. A robots.txt
 * saved in a legacy code page with raw non-ASCII bytes in a rule yields a
 * pattern that can never match, so the rule would be skipped and the path
 * read as allowed. Such a body is unreadable, not permissive. The field is
 * named with U+FFFD removed, so a stray byte before "Disallow" cannot hide
 * the line. U+FFFD in a comment or another field decides nothing.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasUndecodableRule(text) {
  for (const raw of lines(text)) {
    const line = uncomment(raw);
    const colon = line.indexOf(':');
    if (!line.includes('�') || colon === -1) continue;
    const field = line.slice(0, colon).replaceAll('�', '').trim().toLowerCase();
    if (RULE_FIELDS.has(field)) return true;
  }
  return false;
}

/**
 * The RFC 9309 product-token part of a User-agent value: `career-ops/1.0`
 * names the `career-ops` group. A value with no token characters (`*`, or a
 * garbled one) is kept whole, lower-cased.
 */
function agentKey(value) {
  const v = value.trim().toLowerCase();
  if (v === '*') return '*';
  const token = /^[a-z_-]+/.exec(v)?.[0];
  return token ?? v;
}

/**
 * user-agent -> [{ allow, pattern }], tolerating blank lines inside a record.
 * Several groups naming the same agent are merged, as RFC 9309 asks.
 *
 * @param {string} text
 * @returns {Map<string, {allow: boolean, pattern: string}[]>}
 */
export function parseRobotsGroups(text) {
  const groups = new Map();
  let agents = [];
  let expectingAgents = true;
  for (const raw of lines(text)) {
    const line = uncomment(raw).trim();
    const colon = line.indexOf(':');
    if (!line || colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!expectingAgents) {
        agents = [];
        expectingAgents = true;
      }
      const key = agentKey(value);
      agents.push(key);
      if (!groups.has(key)) groups.set(key, []);
    } else if ((field === 'allow' || field === 'disallow') && agents.length > 0) {
      expectingAgents = false;
      for (const agent of agents) groups.get(agent).push({ allow: field === 'allow', pattern: value });
    }
  }
  return groups;
}

/**
 * RFC 9309 wildcard match. Returns the match length (the pattern's length,
 * which is what "longest match" compares) or -1.
 *
 * A table walk in O(len(pattern) * len(path)), never a regex: turning each
 * `*` into `.*` lets a non-matching rule with repeated wildcard segments
 * (`/*a*a*a...*b$`) send a backtracking engine into exponential time, on a
 * file the site controls (GHSA-xhqf-8q8x-4jwm upstream). Consecutive `*`
 * match as one.
 *
 * @param {string} rawPattern - The rule value as written.
 * @param {string} path - The percent-decoded request path (plus `?query`).
 * @returns {number}
 */
export function matchLength(rawPattern, path) {
  if (rawPattern === '') return -1;
  const pattern = percentDecode(rawPattern);
  const endAnchor = pattern.endsWith('$');
  const pat = Array.from((endAnchor ? pattern.slice(0, -1) : pattern).replace(/\*{2,}/g, '*'));
  const chars = Array.from(path);
  // reach[j]: the first j pattern characters match the path consumed so far.
  let reach = new Array(pat.length + 1).fill(false);
  reach[0] = true;
  for (let j = 1; j <= pat.length && pat[j - 1] === '*'; j++) reach[j] = true;
  if (reach[pat.length] && !endAnchor) return pattern.length;
  for (const ch of chars) {
    const step = new Array(pat.length + 1).fill(false);
    for (let j = 1; j <= pat.length; j++) {
      const c = pat[j - 1];
      if (c === '*') step[j] = step[j - 1] || reach[j];
      else if (c === ch) step[j] = reach[j - 1];
    }
    reach = step;
    // Without `$`, matching a prefix of the path is enough.
    if (reach[pat.length] && !endAnchor) return pattern.length;
  }
  return reach[pat.length] ? pattern.length : -1;
}

/**
 * Is `path` allowed for `agent` under this robots.txt body?
 *
 * The agent's own group is used when it holds a rule, otherwise `*`. A named
 * group with no rule lines falls back to `*` rather than reading as an
 * allow-all, the cautious reading the upstream port makes.
 *
 * @param {string} text - The robots.txt body.
 * @param {string} agent - Product token, e.g. ROBOTS_PRODUCT_TOKEN.
 * @param {string} path - Percent-decoded path (plus `?query`).
 * @returns {boolean}
 */
export function isPathAllowed(text, agent, path) {
  const groups = parseRobotsGroups(text);
  const own = groups.get(agentKey(agent));
  const rules = own?.length ? own : (groups.get('*') ?? []);
  let bestLength = -1;
  let bestAllow = true;
  for (const { allow, pattern } of rules) {
    const n = matchLength(pattern, path);
    if (n > bestLength || (n === bestLength && n >= 0 && !allow)) {
      bestLength = n;
      bestAllow = allow;
    }
  }
  return bestLength < 0 ? true : bestAllow;
}

/**
 * The Crawl-delay, in seconds, that robots.txt states for `agent`: its own
 * group's value, else the `*` group's, else null. Crawl-delay is not part of
 * RFC 9309, but the Source Indexing Policy (CONTRIBUTING.md, rule 6) asks a
 * reader to honour one a source states. Groups are formed the way
 * parseRobotsGroups forms them; the first value a group states wins, and a
 * value that is not a non-negative number is ignored.
 *
 * @param {string} text - The robots.txt body.
 * @param {string} agent - Product token, e.g. ROBOTS_PRODUCT_TOKEN.
 * @returns {number|null}
 */
export function crawlDelaySeconds(text, agent) {
  const delays = new Map();
  let agents = [];
  let expectingAgents = true;
  for (const raw of lines(text)) {
    const line = uncomment(raw).trim();
    const colon = line.indexOf(':');
    if (!line || colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!expectingAgents) {
        agents = [];
        expectingAgents = true;
      }
      agents.push(agentKey(value));
    } else if ((field === 'allow' || field === 'disallow') && agents.length > 0) {
      expectingAgents = false;
    } else if (field === 'crawl-delay' && agents.length > 0 && /^\d+(?:\.\d+)?$/.test(value)) {
      for (const a of agents) if (!delays.has(a)) delays.set(a, Number(value));
    }
  }
  const own = delays.get(agentKey(agent));
  return own !== undefined ? own : (delays.get('*') ?? null);
}

/** The path a URL's rules are matched against: decoded pathname plus `?query`. */
function requestPath(parsed) {
  const path = percentDecode(parsed.pathname) || '/';
  return parsed.search ? `${path}?${percentDecode(parsed.search.slice(1))}` : path;
}

const verdict = (allowed, code, reason) => ({ allowed, code, reason });
const deny = (code, reason) => verdict(false, code, reason);

const RESOLVE_FAILURE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA', 'EAI_NONAME', 'ENODATA', 'ESERVFAIL', 'ENONAME']);

async function resolveViaDns(hostname) {
  const { lookup } = await import('node:dns/promises');
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

/**
 * Default transport: providers/_http.mjs fetchResponse, imported only when no
 * fetchImpl is injected (it patches dns.lookup process-wide on import). It
 * throws on a non-2xx, non-3xx status; that is turned back into a response
 * here so the status mapping below sees every answer the same way.
 */
async function providerTransport(url, { headers, timeoutMs, maxBytes }) {
  const { fetchResponse } = await import('./providers/_http.mjs');
  try {
    return await fetchResponse(url, { headers, redirect: 'manual', timeoutMs, maxBytes });
  } catch (err) {
    if (Number.isInteger(err?.status)) {
      return new Response(err.body ?? '', { status: err.status, headers: err.location ? { location: err.location } : {} });
    }
    throw err;
  }
}

/** Is this hostname safe to dial? Returns null, or a deny verdict. */
async function guardHost(hostname, resolver) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isBlockedAddress(host) ? deny('robots_blocked_address', `host ${host} is not a public address`) : null;
  }
  let addresses;
  try {
    addresses = await resolver(host);
  } catch (err) {
    const code = err?.code ?? err?.cause?.code;
    if (RESOLVE_FAILURE_CODES.has(code)) return deny('robots_unresolvable', `host ${host} did not resolve (${code})`);
    return deny('robots_unresolvable', `host ${host} could not be resolved (${String(err?.message ?? err).split('\n')[0]})`);
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return deny('robots_unresolvable', `host ${host} resolved to no addresses`);
  }
  const blocked = addresses.find((address) => isBlockedAddress(address));
  if (blocked) return deny('robots_blocked_address', `host ${host} resolves to non-public address ${blocked}`);
  return null;
}

function classifyFetchError(err, timeoutMs) {
  const code = err?.code ?? err?.cause?.code;
  if (err?.timedOut || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return deny('robots_timeout', `fetch timed out after ${timeoutMs}ms`);
  }
  if (code === 'ECAREEROPS_BLOCKED_ADDRESS') return deny('robots_blocked_address', String(err.message ?? err).split('\n')[0]);
  if (code === 'response_too_large') return deny('robots_too_large', `body is larger than ${ROBOTS_MAX_BYTES} bytes`);
  if (RESOLVE_FAILURE_CODES.has(code)) return deny('robots_unresolvable', `host did not resolve (${code})`);
  return deny('robots_fetch_error', `fetch failed (${String(err?.message ?? err).split('\n')[0]})`);
}

/** Race a promise against the timeout, so a transport that ignores its signal still ends. */
function withTimeout(run, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error(`timed out after ${timeoutMs}ms`);
      err.timedOut = true;
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([run(controller.signal), expired]).finally(() => clearTimeout(timer));
}

/**
 * Fetch one origin's robots.txt and reduce it to a policy: either the body to
 * match paths against, or a verdict that holds for every path on the origin.
 */
async function loadPolicy(origin, { fetchImpl, resolver, timeoutMs, userAgent, maxRedirects }) {
  let target = `${origin}/robots.txt`;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return deny('robots_redirect_refused', `redirected to unsupported protocol ${parsed.protocol}`);
    }
    const guarded = await guardHost(parsed.hostname, resolver);
    if (guarded) return guarded;

    let status;
    let location;
    let body;
    try {
      ({ status, location, body } = await withTimeout(async (signal) => {
        const res = await fetchImpl(target, {
          headers: { 'user-agent': userAgent, accept: 'text/plain,*/*' },
          redirect: 'manual',
          signal,
          timeoutMs,
          maxBytes: ROBOTS_MAX_BYTES,
        });
        const s = Number(res?.status ?? 0);
        const loc = typeof res?.headers?.get === 'function' ? res.headers.get('location') : null;
        // Only a 2xx body is read; it is the only one that decides anything.
        const text = s >= 200 && s < 300 && typeof res?.text === 'function' ? await res.text() : '';
        return { status: s, location: loc, body: text };
      }, timeoutMs));
    } catch (err) {
      return classifyFetchError(err, timeoutMs);
    }

    if (status >= 300 && status < 400) {
      if (!location) return deny('robots_http_error', `answered HTTP ${status} with no Location`);
      try {
        target = new URL(location, target).href;
      } catch {
        return deny('robots_redirect_refused', `redirected to an invalid URL`);
      }
      continue;
    }
    if (status === 404 || status === 410) return verdict(true, 'robots_absent', `is not published (HTTP ${status})`);
    if (status === 401 || status === 403) return deny('robots_forbidden', `refused with HTTP ${status}`);
    if (status >= 500) return deny('robots_server_error', `answered HTTP ${status}`);
    if (status < 200 || status >= 300) return deny('robots_http_error', `answered HTTP ${status}`);

    if (Buffer.byteLength(body, 'utf8') > ROBOTS_MAX_BYTES) {
      return deny('robots_too_large', `body is larger than ${ROBOTS_MAX_BYTES} bytes`);
    }
    if (!stripBom(body).trim()) return verdict(true, 'robots_empty', 'is empty');
    if (!isRobotsBody(body)) return deny('robots_not_robots_txt', `answered HTTP ${status} with a page that is not a robots.txt`);
    if (hasUndecodableRule(body)) return deny('robots_undecodable', 'has a User-agent/Allow/Disallow line that is not valid UTF-8');
    return { body };
  }
  return deny('robots_too_many_redirects', `redirected more than ${maxRedirects} times`);
}

const defaultCache = new Map();

/** Forget every cached robots.txt policy (the default per-process cache). */
export function clearRobotsCache() {
  defaultCache.clear();
}

/**
 * May the headed liveness retry fetch `url`?
 *
 * @param {string} url - The posting URL the retry would load.
 * @param {object} [opts]
 * @param {(url: string, init: object) => Promise<{status: number, headers?: {get(name: string): string|null}, text?: () => Promise<string>}>} [opts.fetchImpl]
 *   fetch-like transport; defaults to providers/_http.mjs fetchResponse.
 *   Called with `redirect: 'manual'` and must hand a 3xx back, not follow it.
 * @param {(hostname: string) => Promise<string[]>} [opts.resolver] - Host to
 *   addresses; defaults to dns.lookup. Every address is checked.
 * @param {Map<string, Promise<object>>} [opts.cache] - Per-origin policy
 *   cache; defaults to one shared by the whole process.
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.userAgent] - Sent on the robots.txt request.
 * @param {string} [opts.productToken] - The robots.txt group to obey.
 * @param {number} [opts.maxRedirects]
 * @returns {Promise<{allowed: boolean, code: string, reason: string, crawlDelay?: number|null}>}
 *   `reason` reads after "robots.txt ", e.g. "answered HTTP 503". When a
 *   published robots.txt permits the path, `crawlDelay` is the Crawl-delay it
 *   states for the product token (crawlDelaySeconds), or null.
 */
export async function robotsAllows(url, opts = {}) {
  const {
    fetchImpl = providerTransport,
    resolver = resolveViaDns,
    cache = defaultCache,
    timeoutMs = ROBOTS_TIMEOUT_MS,
    userAgent = DEFAULT_USER_AGENT,
    productToken = ROBOTS_PRODUCT_TOKEN,
    maxRedirects = ROBOTS_MAX_REDIRECTS,
  } = opts;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return deny('robots_invalid_url', 'was not checked: invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return deny('robots_invalid_url', `was not checked: unsupported protocol ${parsed.protocol}`);
  }
  if (!parsed.hostname) return deny('robots_invalid_url', 'was not checked: no host in the URL');

  // One fetch per origin per process: scan --verify over many postings on one
  // host reads robots.txt once. The promise is cached, so concurrent callers
  // share the request too.
  const origin = parsed.origin;
  let pending = cache.get(origin);
  if (!pending) {
    pending = loadPolicy(origin, { fetchImpl, resolver, timeoutMs, userAgent, maxRedirects })
      .catch((err) => deny('robots_fetch_error', `check failed (${String(err?.message ?? err).split('\n')[0]})`));
    cache.set(origin, pending);
  }
  const policy = await pending;
  if (!('body' in policy)) return policy;

  const path = requestPath(parsed);
  return isPathAllowed(policy.body, productToken, path)
    ? { ...verdict(true, 'robots_allowed', `permits ${path} for ${productToken}`), crawlDelay: crawlDelaySeconds(policy.body, productToken) }
    : deny('robots_disallowed', `disallows ${path} for ${productToken}`);
}
