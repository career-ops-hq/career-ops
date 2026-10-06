#!/usr/bin/env node
/**
 * utils/url-resolver.mjs — zero-token redirect-chain resolver.
 *
 * Job boards hand out tracking URLs (an internal redirector, a shared-link
 * shortener, a click wrapper with `utm_*` / `gh_src` / `fbclid` glued on). The
 * posting actually lives one or more 3xx hops away, on Greenhouse, Lever,
 * Ashby or Workday. Answering "where does this really point?" is a header
 * question, not a rendering question: a 301/302 carries its destination in the
 * `location` header, so following it costs one round trip per hop and no
 * browser at all. This module is the zero-token, zero-Playwright path for
 * callers that only need the destination string.
 *
 * WHAT IT IS NOT
 *   - Not a liveness check. `check-liveness.mjs` / `liveness-core.mjs` decide
 *     whether a posting is still open; this only resolves where a URL points.
 *     A resolved URL can be a dead posting.
 *   - Not a content extractor. No HTML is read, no body is parsed. The final
 *     response body is cancelled rather than consumed, precisely because the
 *     caller asked for a URL and not for the page.
 *
 * WHY `redirect: 'manual'`
 *   Node's fetch would otherwise follow the chain invisibly (default
 *   `redirect: 'follow'`) and hand back only the endpoint, losing every hop.
 *   Under `redirect: 'manual'` a 3xx arrives as a NON-OK response with the
 *   `location` header still readable — the same shape providers/_http.mjs
 *   relies on (see its `err.location`) — so each hop can be inspected, counted,
 *   loop-checked and logged before the next request is issued.
 *
 * RELATIVE `location`
 *   Servers are allowed to send `location: /jobs/123` or `location: next.cgi`.
 *   Resolving against the REQUEST url (not the original input) is what makes a
 *   multi-hop chain across hosts work.
 *
 * TRACKING PARAMS
 *   Stripped from the returned URL only, never from the request. Reusing
 *   url-key.mjs's denylist is deliberate: that list is the repository's one
 *   definition of "identifies a click, not the posting" and it is deliberately
 *   narrow — generic names (`ref`, `src`, `source`) are functional on some
 *   boards and are NOT stripped. A second copy of the list would drift from it
 *   the first time either was edited.
 *
 * SELF-TEST
 *   `node utils/url-resolver.mjs --self-test` runs a fully mocked chain. No
 *   network, no DNS, deterministic — safe to run offline and inside test-all.
 */

import { isMainModule } from '../lib/is-main-module.mjs';
import { TRACKING_PARAMS } from '../url-key.mjs';

/** Statuses that carry a destination we should follow. */
export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Hard cap on hops. A chain longer than this is a loop or a misconfiguration. */
export const MAX_HOPS = 10;

/** Default per-hop budget. Public careers pages answer well inside this. */
export const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Strip tracking parameters from a URL string, preserving everything else.
 *
 * Unlike url-key.mjs's `normalizeUrl` — which produces a comparison KEY and so
 * forces https, sorts the query and drops fragments — this returns a URL meant
 * to be visited. Scheme, host casing, path, fragment and query order survive.
 *
 * @param {string} href - Absolute http(s) URL.
 * @returns {string} The same URL with denylisted tracking params removed.
 */
export function stripTrackingParams(href) {
  const u = new URL(href);
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  return u.toString();
}

/**
 * Release a response body without reading it.
 *
 * The caller wants a URL, not the page. Leaving the body unconsumed keeps the
 * socket checked out of the agent's free pool until it is GC'd, which is the
 * classic way a long-lived resolver process leaks connections.
 *
 * @param {Response} res
 */
async function releaseBody(res) {
  try {
    const body = res?.body;
    if (body && typeof body.cancel === 'function') await body.cancel();
  } catch {
    // Already consumed, already cancelled, or a mock without a body.
  }
}

/**
 * Resolve a tracking/board URL to the clean corporate destination URL.
 *
 * Follows 301/302/303/307/308 by hand under `redirect: 'manual'`, then strips
 * tracking parameters from the final URL and returns it.
 *
 * @param {string} trackingUrl - The URL to resolve. Must parse as http(s).
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] - Injectable fetch (self-test / DI).
 * @param {number} [options.maxHops] - Hop ceiling, default MAX_HOPS.
 * @param {number} [options.timeoutMs] - Per-request timeout, default 15000.
 * @param {Record<string,string>} [options.headers] - Extra request headers.
 * @returns {Promise<string>} The clean destination URL.
 * @throws {TypeError} When `trackingUrl` is not an absolute http(s) URL.
 * @throws {Error} On a redirect loop, a hop ceiling breach, a 3xx with no
 *   `location`, a non-redirect failure, or a network error.
 */
export async function resolveDirectCompanyAtsUrl(
  trackingUrl,
  { fetchImpl = globalThis.fetch, maxHops = MAX_HOPS, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {} } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('resolveDirectCompanyAtsUrl needs a fetch implementation (globalThis.fetch is absent)');
  }

  let current;
  try {
    current = new URL(trackingUrl);
  } catch {
    throw new TypeError(`resolveDirectCompanyAtsUrl: not a parseable absolute URL: ${String(trackingUrl)}`);
  }
  if (current.protocol !== 'http:' && current.protocol !== 'https:') {
    throw new TypeError(`resolveDirectCompanyAtsUrl: only http(s) URLs can be resolved, got "${current.protocol}" (input: ${trackingUrl})`);
  }

  const seen = new Set();

  for (let hop = 0; hop <= maxHops; hop++) {
    const href = current.href;
    if (seen.has(href)) {
      throw new Error(`resolveDirectCompanyAtsUrl: redirect loop at hop ${hop}: ${href}`);
    }
    seen.add(href);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(href, {
        redirect: 'manual',
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err?.name === 'AbortError'
        ? `timed out after ${timeoutMs}ms`
        : (err?.cause?.message || err?.message || String(err));
      throw new Error(`resolveDirectCompanyAtsUrl: request failed at hop ${hop} (${href}): ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (!REDIRECT_STATUSES.has(res.status)) {
      // Terminal response (200/404/…). Not a redirect to follow; the status is
      // the caller's business, this module only answers "where does it point".
      await releaseBody(res);
      if (res.status >= 400) {
        throw new Error(`resolveDirectCompanyAtsUrl: HTTP ${res.status} at hop ${hop} (${href})`);
      }
      return stripTrackingParams(href);
    }

    const location = res.headers?.get?.('location');
    if (!location) {
      await releaseBody(res);
      throw new Error(`resolveDirectCompanyAtsUrl: ${res.status} response carried no location header at hop ${hop} (${href})`);
    }
    await releaseBody(res);

    try {
      // Resolved against the REQUEST url — a relative `location` on hop 3 is
      // relative to hop 3's url, not to the original input.
      current = new URL(location, href);
    } catch {
      throw new Error(`resolveDirectCompanyAtsUrl: unparseable location "${location}" at hop ${hop} (${href})`);
    }
    if (current.protocol !== 'http:' && current.protocol !== 'https:') {
      throw new Error(`resolveDirectCompanyAtsUrl: refusing non-http(s) redirect to "${location}" at hop ${hop}`);
    }
  }

  throw new Error(`resolveDirectCompanyAtsUrl: exceeded ${maxHops} redirect hops starting from ${trackingUrl}`);
}

// ── Self-test ────────────────────────────────────────────────────────────────
//
// Runs only when this file is the process entry. It never touches the network:
// `fetchImpl` is a mock, so the assertions are deterministic and the suite is
// safe to run offline. Conventions here follow the rest of the repository —
// `isMainModule(import.meta.url)`, never a raw `process.argv[1]` comparison,
// which `tests/main-guard-convention.test.mjs` rejects outright because it
// breaks through symlinks (#3170).

/**
 * Build a mock fetch from a table of `url -> {status, location}`.
 *
 * A URL absent from the table is terminal (200). Requests are recorded so the
 * self-test can assert WHICH urls were fetched, not only what came back.
 *
 * @param {Record<string, {status: number, location?: string}>} table
 * @returns {{fetchImpl: typeof fetch, calls: string[]}}
 */
function mockFetch(table) {
  const calls = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    calls.push(href);
    const hit = table[href];
    if (!hit) return { status: 200, headers: new Headers(), body: null };
    return {
      status: hit.status,
      headers: new Headers(hit.location === undefined ? {} : { location: hit.location }),
      body: null,
    };
  };
  return { fetchImpl, calls };
}

async function runSelfTest() {
  const cases = [];
  const check = (name, fn) => cases.push({ name, fn });

  // 1. A three-hop chain: wrapper -> relative hop -> cross-host ATS.
  check('follows a cross-host chain to the ATS and strips tracking params', async () => {
    const { fetchImpl, calls } = mockFetch({
      'https://track.example/click?utm_source=board&utm_campaign=launch&id=7': {
        status: 302, location: '/hop2?fbclid=abc123',
      },
      'https://track.example/hop2?fbclid=abc123': {
        status: 301, location: 'https://jobs.greenhouse.io/acme/12345?gh_src=ref1&src=direct&gh_jid=99',
      },
      'https://jobs.greenhouse.io/acme/12345?gh_src=ref1&src=direct&gh_jid=99': { status: 200 },
    });
    const out = await resolveDirectCompanyAtsUrl(
      'https://track.example/click?utm_source=board&utm_campaign=launch&id=7',
      { fetchImpl },
    );
    if (out !== 'https://jobs.greenhouse.io/acme/12345?src=direct&gh_jid=99') {
      throw new Error(`expected clean ATS url, got ${out}`);
    }
    if (calls.length !== 3) throw new Error(`expected 3 fetches, made ${calls.length}`);
    if (calls[1] !== 'https://track.example/hop2?fbclid=abc123') {
      throw new Error(`relative location not resolved against the request url: ${calls[1]}`);
    }
  });

  // 2. Functional params must survive — the denylist is narrow on purpose.
  check('keeps functional params (gh_jid, src, ref) on the destination', async () => {
    const { fetchImpl } = mockFetch({
      'https://go.example/r?utm_source=x': { status: 302, location: 'https://boards.lever.co/acme/abc?ref=keepme&gh_jid=42' },
      'https://boards.lever.co/acme/abc?ref=keepme&gh_jid=42': { status: 200 },
    });
    const out = await resolveDirectCompanyAtsUrl('https://go.example/r?utm_source=x', { fetchImpl });
    if (out !== 'https://boards.lever.co/acme/abc?ref=keepme&gh_jid=42') {
      throw new Error(`functional params were altered: ${out}`);
    }
  });

  // 3. A terminal 200 on the first request still gets its tracking stripped.
  check('returns a cleaned URL when there is no redirect at all', async () => {
    const { fetchImpl, calls } = mockFetch({});
    const out = await resolveDirectCompanyAtsUrl('https://jobvite.example/jobs/1?utm_source=mail&ref=x', { fetchImpl });
    if (out !== 'https://jobvite.example/jobs/1?ref=x') throw new Error(out);
    if (calls.length !== 1) throw new Error(`expected 1 fetch, made ${calls.length}`);
  });

  // 4. 307/308 are redirects too.
  check('follows 307 and 308', async () => {
    const { fetchImpl } = mockFetch({
      'https://a.example/1': { status: 307, location: 'https://a.example/2' },
      'https://a.example/2': { status: 308, location: 'https://ashbyhq.example/j/55' },
      'https://ashbyhq.example/j/55': { status: 200 },
    });
    const out = await resolveDirectCompanyAtsUrl('https://a.example/1', { fetchImpl });
    if (out !== 'https://ashbyhq.example/j/55') throw new Error(out);
  });

  // 5. A cycle must fail loudly rather than spin.
  check('detects a redirect loop instead of spinning', async () => {
    const { fetchImpl } = mockFetch({
      'https://loop.example/a': { status: 302, location: 'https://loop.example/b' },
      'https://loop.example/b': { status: 302, location: 'https://loop.example/a' },
    });
    await assertRejects(
      resolveDirectCompanyAtsUrl('https://loop.example/a', { fetchImpl }),
      /redirect loop/,
      'loop not detected',
    );
  });

  // 6. An acyclic chain longer than maxHops must stop at the ceiling.
  check('enforces the hop ceiling', async () => {
    const table = {};
    for (let i = 0; i < 20; i++) table[`https://long.example/${i}`] = { status: 302, location: `https://long.example/${i + 1}` };
    await assertRejects(
      resolveDirectCompanyAtsUrl('https://long.example/0', { fetchImpl: mockFetch(table).fetchImpl, maxHops: 5 }),
      /exceeded 5 redirect hops/,
      'hop ceiling not enforced',
    );
  });

  // 7. Bad input fails loudly, with the offending value named.
  check('rejects a non-http(s) input', async () => {
    await assertRejects(resolveDirectCompanyAtsUrl('mailto:a@b.c', { fetchImpl: mockFetch({}).fetchImpl }), /only http\(s\)/, 'mailto accepted');
    await assertRejects(resolveDirectCompanyAtsUrl('not a url', { fetchImpl: mockFetch({}).fetchImpl }), /not a parseable/, 'garbage accepted');
  });

  // 8. A 3xx with no location is a protocol violation, not a silent stop.
  check('rejects a 3xx that carries no location header', async () => {
    const { fetchImpl } = mockFetch({ 'https://noloc.example/': { status: 302 } });
    await assertRejects(resolveDirectCompanyAtsUrl('https://noloc.example/', { fetchImpl }), /no location header/, 'accepted a locationless 3xx');
  });

  // 9. The original input must not be mutated in place.
  check('does not mutate the input string', async () => {
    const input = 'https://x.example/j/1?utm_source=a';
    const { fetchImpl } = mockFetch({});
    await resolveDirectCompanyAtsUrl(input, { fetchImpl });
    if (input !== 'https://x.example/j/1?utm_source=a') throw new Error(`input mutated: ${input}`);
  });

  let failed = 0;
  for (const { name, fn } of cases) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}\n      ${err.message}`);
    }
  }

  console.log(failed === 0
    ? `\n✓ url-resolver self-test — ${cases.length} invariants passed`
    : `\n✗ url-resolver self-test — ${failed}/${cases.length} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

/**
 * assert.rejects without importing node:assert, so the module stays
 * dependency-light and the self-test is the only thing that can fail it.
 *
 * @param {Promise<unknown>} promise
 * @param {RegExp} pattern
 * @param {string} message - Reported when the promise RESOLVES.
 */
async function assertRejects(promise, pattern, message) {
  try {
    await promise;
  } catch (err) {
    if (!pattern.test(String(err?.message || err))) {
      throw new Error(`rejected with the wrong error (expected ${pattern}): ${err?.message || err}`);
    }
    return;
  }
  throw new Error(message);
}

if (isMainModule(import.meta.url)) {
  const wantSelfTest = process.argv.includes('--self-test');
  if (wantSelfTest || process.argv.length <= 2) {
    await runSelfTest();
  } else {
    console.log('Usage: node utils/url-resolver.mjs --self-test');
    process.exitCode = 2;
  }
}
