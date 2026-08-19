/**
 * liveness-browser.mjs — Playwright-driven liveness check for a single URL.
 *
 * Shared by check-liveness.mjs (CLI tool) and scan.mjs (--verify flag).
 * Returns the same shape as classifyLiveness: { result, reason }.
 */

import { classifyLiveness } from './liveness-core.mjs';
import { BROWSER_LIKE_USER_AGENT } from './user-agent.mjs';

const NAVIGATE_TIMEOUT_MS = 15_000;
const HYDRATION_WAIT_MS = 2_000;
// Upper bound on the extra wait for a same-origin child frame to populate, and
// the poll interval inside it. Only spent when such a frame exists at all.
const FRAME_CONTENT_TIMEOUT_MS = 6_000;
const FRAME_CONTENT_POLL_MS = 500;

/**
 * Same-origin test used to decide whether a child frame is part of the posting
 * or somebody else's widget. Deliberately strict: about:blank, data: frames,
 * tag managers and ad iframes all fail it, so only the ATS's own embedded
 * document contributes text and apply controls.
 */
export function sameOrigin(frameUrl, pageUrl) {
  try {
    const a = new URL(frameUrl);
    const b = new URL(pageUrl);
    if (a.protocol !== 'http:' && a.protocol !== 'https:') return false;
    return a.origin === b.origin;
  } catch {
    return false;
  }
}

// The default Playwright headless UA contains "HeadlessChrome", which Cloudflare
// and similar WAFs flag — portals like pracuj.pl then serve a 403 challenge page
// instead of the posting. Presenting a normal desktop Chrome UA clears the wall
// headlessly (the scan parser scripts/parsers/pracuj-jobs.mjs relies on the same
// trick), so the common case never needs the slower headed-browser fallback.
export const LIVENESS_CONTEXT_OPTIONS = {
  userAgent: BROWSER_LIKE_USER_AGENT,
  locale: 'en-US',
};

// Open a page in a context that already presents a realistic UA. Both callers use
// this instead of browser.newPage() so headless checks aren't instantly bot-walled.
export async function newLivenessPage(browser) {
  const context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
  return context.newPage();
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Throttle delay with jitter: a value in [baseMs, 2*baseMs). Spacing requests out
// (and randomizing the gap) keeps a bulk run under rate-based WAF thresholds —
// pracuj.pl's Cloudflare flags the session after ~2 rapid hits, after which even
// headed retries are blocked. A randomized gap also avoids a fixed-cadence
// fingerprint. Returns 0 for a non-positive base (throttling disabled).
export function jitteredDelayMs(baseMs) {
  if (!baseMs || baseMs <= 0) return 0;
  return baseMs + Math.floor(Math.random() * baseMs);
}

// Defensive guards: URLs come from ATS feeds (mostly trusted) but a misconfigured
// portals.yml entry or a hijacked feed shouldn't be able to point Playwright at
// internal infrastructure. Only allow http(s) and reject loopback/private/link-local.
//
// The hostname coming out of `new URL(...)` needs normalization before the regex
// pass, because the WHATWG URL parser surfaces several encodings that bypass a
// naive match against `parsed.hostname`:
//   1. IPv6 hosts are serialized with brackets — `new URL('http://[::1]/').hostname`
//      is `'[::1]'`, so a regex like `/^::1$/` never fires unless brackets are stripped.
//   2. FQDN trailing dot is preserved — `localhost.` reaches the network as
//      localhost, but `/^localhost$/` doesn't match it.
//   3. IPv4-mapped IPv6 (`::ffff:127.0.0.1` or the hex form `::ffff:7f00:1`)
//      routes to the embedded IPv4 in Chromium, so the embedded address must
//      also be matched against the IPv4 block list.
// `0.0.0.0` and the all-zeros IPv6 `::` both reach loopback on Linux and need
// explicit entries; the original list omitted them.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/,
  /^localhost\.localdomain$/,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^::$/,
  /^fc[0-9a-f]{2}:/,
  /^fe80:/,
];

// Lowercase, strip IPv6 brackets, strip FQDN trailing dot. The `hostname`
// returned by `new URL(...)` is already percent-decoded and IDNA-normalized,
// but it preserves brackets around IPv6 hosts and trailing dots on FQDNs.
function normalizeHost(rawHostname) {
  if (!rawHostname) return '';
  let h = String(rawHostname).toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

// IPv4-mapped IPv6 (RFC 4291 §2.5.5.2): `::ffff:0:0/96` routes to the embedded
// IPv4 address. Two textual forms — dotted (`::ffff:127.0.0.1`) and pure-hex
// (`::ffff:7f00:1`). Return the embedded IPv4 in dotted-decimal form, or null
// if `host` is not an IPv4-mapped IPv6.
function extractMappedIPv4(host) {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
  }
  return null;
}

// Returns null when the URL is safe to fetch, otherwise a structured guard
// result with a stable `code` (used for routing in scan.mjs) plus a human
// `reason`. Stable codes — not regex on reason strings — drive downstream
// dispatch so the wording can change freely without breaking callers.
//
// Exported for unit tests; the main entry point is checkUrlLiveness.
export function rejectPrivateOrInvalid(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { code: 'invalid_url', reason: 'invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { code: 'unsupported_protocol', reason: `unsupported protocol ${parsed.protocol}` };
  }
  const host = normalizeHost(parsed.hostname);
  const mappedIPv4 = extractMappedIPv4(host);
  const candidates = mappedIPv4 ? [host, mappedIPv4] : [host];
  for (const candidate of candidates) {
    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(candidate))) {
      return { code: 'blocked_host', reason: `blocked host ${parsed.hostname}` };
    }
  }
  return null;
}

const dnsCache = new Map();

// Real DNS: resolve4 + resolve6 + lookup, each tolerant of its own failure, so a
// host that only answers on one of the three still yields an address list.
async function resolveViaDns(hostname) {
  const dns = await import('dns/promises');
  const [ipv4, ipv6, lookupList] = await Promise.all([
    dns.resolve4(hostname).catch(() => []),
    dns.resolve6(hostname).catch(() => []),
    dns.lookup(hostname, { all: true }).catch(() => [])
  ]);
  return Array.from(new Set([
    ...ipv4,
    ...ipv6,
    ...lookupList.map(item => item.address)
  ]));
}

let hostResolver = resolveViaDns;

/**
 * Swap the resolver the egress guard uses, returning a restore function.
 *
 * `dns/promises` is imported dynamically and the guard calls the ESM namespace
 * bindings, which are immutable — monkey-patching the module object has no
 * effect on them (#2386). Without this seam a test can only ever reach the
 * "host resolved to nothing" branch: the real resolver returns an empty list
 * for the synthetic hostname, the guard blocks on that, and the loopback
 * rejection the test exists to cover never runs. The memo cache is cleared on
 * every swap, in both directions, so a verdict computed under one resolver can
 * never be served to the next.
 *
 * @param {((hostname: string) => Promise<string[]>)|null} resolver - Resolver to
 *   install, or null to restore the real DNS one.
 * @returns {() => void} Restores the resolver in place before this call.
 */
export function setHostResolver(resolver) {
  const previous = hostResolver;
  hostResolver = resolver ?? resolveViaDns;
  dnsCache.clear();
  return () => {
    hostResolver = previous;
    dnsCache.clear();
  };
}

async function resolveDnsCached(hostname) {
  if (dnsCache.has(hostname)) {
    const cached = dnsCache.get(hostname);
    if (cached instanceof Error) throw cached;
    return cached;
  }
  try {
    const addresses = await hostResolver(hostname);
    if (addresses.length === 0) {
      throw new Error(`DNS resolution returned no addresses for ${hostname}`);
    }
    dnsCache.set(hostname, addresses);
    return addresses;
  } catch (err) {
    dnsCache.set(hostname, err);
    throw err;
  }
}

// Second layer of the egress guard: `rejectPrivateOrInvalid` only sees the
// literal host, so a public hostname that *resolves* to private space still
// gets through it. Resolve and re-check every address before the request is
// allowed out. Exported so other Playwright callers (archive-posting.mjs) wire
// up the same two-layer guard instead of growing a second implementation.
export async function validateUrlSecurity(urlString) {
  const url = new URL(urlString.endsWith('.') ? urlString.slice(0, -1) : urlString);
  const hostname = url.hostname;
  const host = normalizeHost(hostname);
  const addresses = await resolveDnsCached(host);
  for (const ip of addresses) {
    const norm = normalizeHost(ip);
    const mapped = extractMappedIPv4(norm);
    const candidates = mapped ? [norm, mapped] : [norm];
    for (const candidate of candidates) {
      if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(candidate))) {
        throw new Error(`Access denied: Egress guard blocked private target IP ${ip}`);
      }
    }
  }
}

export async function checkUrlLiveness(page, url, { extraSettleMs = 0 } = {}) {
  const guardError = rejectPrivateOrInvalid(url);
  if (guardError) {
    return { result: 'uncertain', code: guardError.code, reason: guardError.reason };
  }
  if (page) {
    page._blockedByGuard = null;
  }
  if (page && typeof page.route === 'function' && !page._routeInterceptorRegistered) {
    page._routeInterceptorRegistered = true;
    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      const errGuard = rejectPrivateOrInvalid(requestUrl);
      if (errGuard) {
        console.warn(`Blocked request to restricted destination: ${requestUrl}`);
        page._blockedByGuard = errGuard;
        return route.abort('blockedbyclient');
      }
      try {
        await validateUrlSecurity(requestUrl);
        return route.continue();
      } catch (err) {
        console.warn(`Blocked request to restricted destination (DNS): ${requestUrl} - ${err.message}`);
        page._blockedByGuard = { code: 'blocked_host', reason: err.message };
        return route.abort('blockedbyclient');
      }
    });
  }
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAVIGATE_TIMEOUT_MS });
    const status = response?.status() ?? 0;

    // Give SPAs (Ashby, Lever, Workday) time to hydrate. extraSettleMs adds slack
    // for the headed retry, where a JS anti-bot interstitial needs a moment to clear.
    await page.waitForTimeout(HYDRATION_WAIT_MS + extraSettleMs);

    const finalUrl = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const extractApplyControls = () => {
      const candidates = Array.from(
        document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]')
      );

      return candidates
        .filter((element) => {
          if (element.closest('nav, header, footer')) return false;
          if (element.closest('[aria-hidden="true"]')) return false;

          const style = window.getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (!element.getClientRects().length) return false;

          return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
        })
        .map((element) => {
          const label = [
            element.innerText,
            element.value,
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

          return label;
        })
        .filter(Boolean);
    };

    let applyControls = await page.evaluate(extractApplyControls);
    let frameText = '';

    // Some ATS render the whole posting inside a same-origin iframe and leave the
    // top-level document as an empty shell. iCIMS is the reference case: measured
    // 2026-08-14, the outer document of a LIVE posting held 13 characters and no
    // apply control, so classifyLiveness reached `insufficient_content` and called
    // it expired. 92 live postings were closed that way in one sweep, and a false
    // `expired` is the expensive direction — it is written to scan-history as
    // skipped_expired and dedup-filters the job out of every later scan.
    //
    // Reading same-origin child frames cannot resurrect a dead posting: a removed
    // iCIMS job answers HTTP 410 at the top level (verified on two fabricated job
    // ids and one genuinely dead posting), so it short-circuits on status long
    // before any content check, and its error frame carries zero apply controls.
    // The frame ATTACHES fast but FILLS late. Measured on iCIMS 2026-08-14: the
    // same-origin child frame is present at 2000ms with 0 characters and only
    // populates between 3000 and 4000ms, so reading it at HYDRATION_WAIT_MS gets
    // an empty document and changes nothing. Poll until it has content, bounded.
    // The cost is only paid on pages that actually have a same-origin child
    // frame, so the ATS that render inline are unaffected.
    // Frame aggregation is an enhancement, never a requirement. Callers may pass
    // a lightweight page object that only implements goto/url/evaluate — the
    // test doubles in test-all.mjs do — and such a caller must keep getting the
    // top-level verdict rather than a navigation_error.
    const supportsFrames = typeof page?.frames === 'function' && typeof page?.mainFrame === 'function';

    const childFrames = () =>
      !supportsFrames
        ? []
        : page.frames().filter((frame) => {
            if (frame === page.mainFrame()) return false;
            try {
              return sameOrigin(frame.url() || '', finalUrl); // excludes about:blank, ads, tag managers
            } catch {
              return false;
            }
          });

    // A 404/410 is decided by the status line alone, so no amount of frame
    // content can change it. Without this, a dead posting whose error page also
    // renders into an iframe pays the poll while that error page fills, purely
    // to be told what the status already said. Measured on two dead iCIMS
    // postings: 5822ms and 3314ms end to end, the spread being poll iterations.
    //
    // The status rule is NOT restated here. classifyLiveness owns it, so this
    // asks it and keys off the code it returns; a duplicated `status === 410`
    // would be a second copy of that rule waiting to drift.
    const topLevelVerdict = classifyLiveness({ status, requestedUrl: url, finalUrl, bodyText, applyControls });
    if (topLevelVerdict.code === 'http_gone') {
      return topLevelVerdict;
    }

    if (childFrames().length > 0) {
      const deadline = Date.now() + FRAME_CONTENT_TIMEOUT_MS;
      // Wait for EVERY qualifying frame, not merely the first one to fill: with
      // two same-origin frames the posting could otherwise be read while still
      // empty. Measured across five iCIMS tenants there is exactly one
      // qualifying frame per page, so in practice this is the same loop.
      for (;;) {
        let anyEmpty = false;
        for (const frame of childFrames()) {
          try {
            const probe = await frame.evaluate(() => document.body?.innerText ?? '');
            if (!probe.trim()) anyEmpty = true;
          } catch {
            // detached mid-poll; try again on the next tick
          }
        }
        if (!anyEmpty || Date.now() >= deadline) break;
        await page.waitForTimeout(FRAME_CONTENT_POLL_MS);
      }
    }

    for (const frame of childFrames()) {
      try {
        const text = await frame.evaluate(() => document.body?.innerText ?? '');
        if (text && text.trim()) frameText += '\n' + text;
        applyControls = applyControls.concat(await frame.evaluate(extractApplyControls));
      } catch {
        // detached or cross-origin mid-read; the top-level reading still stands
      }
    }

    if (page && page._blockedByGuard) {
      return { result: 'uncertain', code: page._blockedByGuard.code, reason: page._blockedByGuard.reason };
    }

    return classifyLiveness({
      status,
      requestedUrl: url,
      finalUrl,
      bodyText: bodyText + frameText,
      applyControls,
    });
  } catch (err) {
    if (page && page._blockedByGuard) {
      return { result: 'uncertain', code: page._blockedByGuard.code, reason: page._blockedByGuard.reason };
    }
    // Transient failures (timeout, DNS, TLS, 5xx) shouldn't be treated as expired —
    // doing so would cause scan --verify to drop the URL and write it to scan-history,
    // permanently filtering it out on subsequent scans.
    return {
      result: 'uncertain',
      code: 'navigation_error',
      reason: `navigation error: ${err.message.split('\n')[0]}`,
    };
  }
}

// Anti-bot results that a headed browser may be able to get past. A real (headed)
// Chromium clears the JS/Cloudflare challenge that headless trips on (e.g. pracuj.pl).
const CHALLENGE_CODES = new Set(['bot_challenge', 'access_blocked']);

export function isChallengeResult(result) {
  return result?.result === 'uncertain' && CHALLENGE_CODES.has(result.code);
}

// Lazily owns a single headed browser/page, created only on first use and reused
// across URLs. Headed Chromium needs a display, so launch can fail in headless/CI
// environments — in that case get() returns null and callers degrade to the
// headless result (challenge stays uncertain, never falsely expired).
export function createHeadedPageProvider(chromium) {
  let browser = null;
  let page = null;
  let launchFailed = false;
  return {
    async get() {
      if (page) return page;
      if (launchFailed) return null;
      try {
        browser = await chromium.launch({ headless: false });
        const context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
        page = await context.newPage();
        return page;
      } catch {
        launchFailed = true;
        browser = null;
        page = null;
        return null;
      }
    },
    async close() {
      if (browser) {
        try {
          await browser.close();
        } catch {
          // best-effort teardown
        }
      }
      browser = null;
      page = null;
    },
  };
}

// Runs the headless check, then retries once in a headed browser if the page was
// blocked by an anti-bot wall. The headed result wins when it actually sees the
// page; if the retry is still blocked (or no headed page is available) the
// original uncertain result is kept — we never upgrade a block to expired.
export async function checkUrlLivenessWithFallback(page, url, { getHeadedPage } = {}) {
  const first = await checkUrlLiveness(page, url);
  if (!getHeadedPage || !isChallengeResult(first)) {
    return first;
  }
  const headedPage = await getHeadedPage();
  if (!headedPage) {
    return first;
  }
  const second = await checkUrlLiveness(headedPage, url, { extraSettleMs: 3_000 });
  if (isChallengeResult(second)) {
    return { ...second, reason: `${second.reason} (headed retry also blocked)` };
  }
  return second;
}
