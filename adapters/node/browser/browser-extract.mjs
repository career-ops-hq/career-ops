#!/usr/bin/env node
/**
 * browser-extract.mjs — headless Playwright reader for the scan / JD-extraction
 * path (the opt-in alternative to the browser MCP; see #1449).
 *
 * The token cost of the MCP path is `browser_snapshot` streaming a page's whole
 * accessibility tree back to the model on every navigate. This helper renders
 * the same page headlessly and returns COMPACT JSON — just the fields the agent
 * needs — so the model processes a small result instead of a full snapshot.
 *
 * STRICTLY READ-ONLY: it navigates and reads the DOM. No clicks, typing, or form
 * fills — that boundary is exactly what keeps this separate from `apply`.
 *
 * Usage:
 *   node browser-extract.mjs <url> [--mode jd|listing] [--max N] [--max-chars N] [--timeout MS]
 *
 * `--max-chars` overrides the jd-mode text cap (default 12000) — raise it when a
 * long JD would otherwise be truncated at the tail, at the cost of more tokens.
 *
 * Modes:
 *   jd (default) — one posting page → { url, title, text }. `text` is the main
 *                  visible text, whitespace-collapsed and length-capped. For the
 *                  pipeline / oferta / auto-pipeline JD-extraction step.
 *   listing      — a careers/board page → { url, jobs: [{ title, url }] }. Visible
 *                  anchors that look like individual postings, deduped. For scan
 *                  Level 1 (reading a company's open roles).
 *
 * Output: compact JSON to stdout. Exit 0 on success; exit 1 on a hard error,
 * printing `{ "error": "...", "code": "..." }` (so a caller/mode can fall back
 * to the MCP path silently). Reuses liveness-browser.mjs's SSRF host guard and
 * realistic-UA context so it isn't instantly bot-walled.
 */

import { fileURLToPath, pathToFileURL } from 'url';
import { LIVENESS_CONTEXT_OPTIONS, rejectPrivateOrInvalid, validateUrlSecurity } from './liveness-browser.mjs';
import { flagValue, hasFlag, validateFlags } from '../shared/cli-flags.mjs';


const DEFAULT_TIMEOUT_MS = 15_000;
const HYDRATION_WAIT_MS = 2_000;
const JD_TEXT_CAP = 12_000;     // plenty for a JD; a fraction of a full snapshot
const DEFAULT_LISTING_MAX = 200;

// Anchor labels that are navigation chrome, not job postings. Kept small and
// lowercase; matched against the trimmed label.
const NAV_LABEL_STOPWORDS = new Set([
  'home', 'about', 'about us', 'contact', 'contact us', 'login', 'log in', 'sign in',
  'sign up', 'register', 'privacy', 'privacy policy', 'terms', 'cookies', 'cookie policy',
  'careers', 'jobs', 'search', 'menu', 'back', 'next', 'previous', 'apply', 'apply now',
  'learn more', 'read more', 'faq', 'blog', 'news', 'help', 'support', 'english',
]);

// Collapse runs of whitespace and cap length so the JD text stays compact.
export function compactText(s, cap = JD_TEXT_CAP) {
  const text = String(s ?? '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * Shape a JD-mode result from the raw DOM read. Pure — exported for tests.
 * @param {{ title?: string, text?: string }} raw
 * @param {string} finalUrl
 */
export function normalizeJd(raw, finalUrl, textCap = JD_TEXT_CAP) {
  return {
    url: finalUrl,
    title: compactText(raw?.title || '', 300),
    text: compactText(raw?.text || '', textCap),
  };
}

/** Read only a JobPosting whose canonical URL matches the requested posting. */
export function microsoftStructuredJd(scripts, expectedUrl) {
  for (const source of scripts) {
    try {
      const posting = JSON.parse(source);
      if (posting?.['@type'] !== 'JobPosting' || new URL(posting.url).href !== expectedUrl
          || typeof posting.title !== 'string' || typeof posting.description !== 'string'
          || posting.description.trim().length < 200) continue;
      return { title: posting.title, text: posting.description, anchors: [] };
    } catch {}
  }
  return null;
}

/**
 * Shape a listing-mode result: keep visible anchors that look like individual
 * job postings, deduped by resolved URL, capped at `max`. Pure — exported for
 * tests. Anchors are dropped when the label is empty/too short or a nav
 * stopword, or the href isn't a resolvable http(s) URL.
 * @param {Array<{ href?: string, label?: string }>} anchors
 * @param {string} finalUrl - the page URL, used as the base to resolve relatives
 * @param {number} [max]
 */
export function normalizeListing(anchors, finalUrl, max = DEFAULT_LISTING_MAX) {
  const jobs = [];
  const seen = new Set();
  for (const a of Array.isArray(anchors) ? anchors : []) {
    const label = String(a?.label ?? '').replace(/\s+/g, ' ').trim();
    if (label.length < 3 || NAV_LABEL_STOPWORDS.has(label.toLowerCase())) continue;

    let url;
    try {
      url = new URL(String(a?.href ?? ''), finalUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:$/.test(new URL(url).protocol)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    jobs.push({ title: label, url });
    if (jobs.length >= max) break;
  }
  return { url: finalUrl, jobs };
}

const VALUE_FLAGS = ['--mode', '--max', '--max-chars', '--timeout'];
const KNOWN_FLAGS = [...VALUE_FLAGS, '--help', '-h'];

// One synopsis, used by both --help and the no_url error, so the two cannot
// drift apart: the error's own copy already omitted --timeout.
const USAGE_SYNOPSIS = 'browser-extract.mjs <url> [--mode jd|listing] [--max N] [--max-chars N] [--timeout MS]';

const USAGE = `Usage:
  node ${USAGE_SYNOPSIS}

  --mode jd|listing   jd (default) returns { url, title, text }; listing returns { url, jobs }
  --max N             listing: maximum postings to return (default ${DEFAULT_LISTING_MAX})
  --max-chars N       jd: text cap (default ${JD_TEXT_CAP}); raise it for a long JD
  --timeout MS        navigation and content-readiness budget (default ${DEFAULT_TIMEOUT_MS})
  --help, -h          Show this help`;

/**
 * Parse CLI args into { url, mode, max, maxChars, timeout }.
 *
 * Value reads go through lib/cli-flags.mjs so BOTH accepted forms reach the
 * extractor. The hand-rolled loop this replaces matched tokens exactly against
 * its own `FLAGS` set, so `--max-chars=50000` was never recognized as a flag:
 * it fell to the `!tok.startsWith('--')` branch, was not the URL either, and
 * the run silently proceeded at the 12000 default — a JD truncated at the tail
 * for a caller who explicitly asked for more. Same silent-wrong-answer shape as
 * the `--from=…` class in #2401/#2402 that lib/cli-flags.mjs exists to end.
 *
 * The URL is still found positionally, and an explicit `0` is still honored
 * rather than silently replaced by the default.
 *
 * @param {string[]} argv - process.argv.slice(2)
 */
export function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];

  // A value token consumed by a space-separated flag is not the URL. Mirrors
  // validateFlags' own adjacency rule: only a token that does not itself start
  // with `--` is treated as a value, so `--mode --max 5` leaves `--max` to be
  // reported rather than swallowed as the mode.
  const consumed = new Set();
  args.forEach((a, i) => {
    if (VALUE_FLAGS.includes(a) && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
      consumed.add(i + 1);
    }
  });

  let url;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i];
    if (typeof tok !== 'string' || consumed.has(i)) continue;
    if (!tok.startsWith('-') && url === undefined) url = tok;
  }

  // Each numeric read keeps its own range rule: `--max` admits 0 (a listing
  // capped at nothing is a meaningful request), the other two do not.
  const num = (flag, ok, fallback) => {
    if (!hasFlag(args, flag)) return fallback;
    const n = Number(flagValue(args, flag));
    return Number.isInteger(n) && ok(n) ? n : fallback;
  };

  const modeVal = hasFlag(args, '--mode') ? flagValue(args, '--mode') : undefined;

  return {
    url,
    mode: modeVal == null ? 'jd' : modeVal,
    max: num('--max', (n) => n >= 0, DEFAULT_LISTING_MAX),
    maxChars: num('--max-chars', (n) => n > 0, JD_TEXT_CAP),
    timeout: num('--timeout', (n) => n > 0, DEFAULT_TIMEOUT_MS),
  };
}

/** Extract readable content and visible links without changing the live document. */
async function readDom(page) {
  return page.evaluate(() => {
    const title = (location.hostname === 'careers.ibm.com'
      ? document.title.replace(/ - \d+ - IBM$/, '')
      : (location.hostname.endsWith('.myworkdayjobs.com') ? document.title : '')
        || document.querySelector('h1')?.innerText || document.title || '').trim();

    const root = location.hostname === 'careers.ibm.com'
      ? document.body : document.querySelector('main, [role="main"], article') || document.body;
    let text = '';
    if (root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script, style, nav, header, footer, noscript').forEach((el) => el.remove());
      clone.querySelectorAll('p, div, section, li, h1, h2, h3, h4, br').forEach(el => el.append('\n'));
      text = clone.textContent || '';
    }

    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((el) => {
        if (el.closest('nav, header, footer')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
      })
      .map((el) => ({ href: el.getAttribute('href') || '', label: (el.innerText || '').trim() }));

    const postings = [];
    const visit = value => {
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (!value || typeof value !== 'object') return;
      if ([value['@type']].flat().includes('JobPosting')) {
        const description = document.createElement('div');
        description.innerHTML = typeof value.description === 'string' ? value.description : '';
        if (/<\/?(?:p|div|br|li|ul|strong|em)\b/i.test(description.textContent || '')) description.innerHTML = description.textContent;
        description.querySelectorAll('p, div, li, br').forEach(element => element.append('\n'));
        postings.push({ ...value, description: description.textContent || '' });
      }
      if (value['@graph']) visit(value['@graph']);
      if (value.mainEntity) visit(value.mainEntity);
    };
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { visit(JSON.parse(script.textContent)); } catch {}
    }
    const efinancialId = /\.id(\d+)$/.exec(location.pathname)?.[1];
    if (!postings.length && efinancialId && ['efinancialcareers.hk', 'www.efinancialcareers.hk'].includes(location.hostname)) {
      try {
        const state = JSON.parse(document.querySelector('script#ng-state')?.textContent || '{}');
        const response = state[`https://job-branding-facade.efinancialcareers.com/job/${efinancialId}`];
        const data = response?.body?.data;
        if (response?.status === 200 && data?.title === title) visit({
          '@type': 'JobPosting', url: location.href, title: data.title, description: data.description,
          hiringOrganization: { name: data.brand?.name }, datePosted: data.posted_date, validThrough: data.expiration_date,
          jobLocation: { address: { addressLocality: data.location?.city, addressRegion: data.location?.state,
            addressCountry: data.location?.country } },
        });
      } catch {}
    }
    return { title, text, anchors, postings };
  });
}

/** Workday renders its shell before the JD; wait for the description, not a fixed sleep. */
export async function readPage(page, { mode = 'jd', timeout = DEFAULT_TIMEOUT_MS } = {}) {
  const url = new URL(page.url());
  if (mode === 'jd' && url.hostname === 'apply.careers.microsoft.com' && /^\/careers\/job\/\d+$/.test(url.pathname)) {
    const posting = microsoftStructuredJd(
      await page.locator('script[type="application/ld+json"]').allTextContents(), url.href,
    );
    if (posting) return posting;
  }
  if (mode === 'jd' && url.hostname.endsWith('.myworkdayjobs.com')) {
    await page.waitForFunction(() => {
      const description = document.querySelector('[data-automation-id="jobPostingDescription"]');
      return Boolean(description?.innerText?.trim())
        || /job (?:is no longer available|has been removed|you are looking for.*(?:not|no longer))|position (?:has been filled|is no longer available)/i.test(document.body?.innerText ?? '');
    }, undefined, { timeout });
  } else if (mode === 'jd' && ['careers.qualcomm.com', 'apply.careers.microsoft.com'].includes(url.hostname)
             && /^\/careers\/job\/\d+$/.test(url.pathname)) {
    await page.waitForFunction(() => {
      const text = document.body?.innerText ?? '';
      return text.length > 500 && /Job ID\s*\d+/i.test(text);
    }, undefined, { timeout });
  } else if (mode === 'jd' && url.hostname === 'careers.ibm.com'
             && /^\/(?:[a-z]{2}_[A-Z]{2}\/)?careers\/JobDetail$/.test(url.pathname)
             && /^\d+$/.test(url.searchParams.get('jobId') || '')) {
    await page.waitForFunction(() => document.body?.innerText?.length > 1000
      && /IBM/.test(document.title), undefined, { timeout });
  } else await page.waitForTimeout(Math.min(HYDRATION_WAIT_MS, timeout));
  return readDom(page);
}

/** Open a reusable page whose navigation and subresources retain the reader's SSRF guard. */
export async function newExtractionPage(browser) {
  const context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (rejectPrivateOrInvalid(url)) return route.abort('blockedbyclient');
    try {
      await validateUrlSecurity(url);
      return route.continue();
    } catch { return route.abort('blockedbyclient'); }
  });
  return context.newPage();
}

async function main() {
  const args = process.argv.slice(2);

  // Before anything launches a browser, because each of these used to fail in a
  // way that named the wrong thing (measured on 764f20f8):
  //   `--max-char 5000 <url>`  the typo was skipped, `5000` became the URL and
  //                            the real one was discarded — reported as
  //                            `invalid URL`, which is not what was wrong.
  //   `<url> --bogus`          skipped entirely; the scan ran and exited 0.
  //   `--help`                 exit 1 with a `no_url` error, never usage.
  //   `-h`                     one dash, so it was read AS the URL: `invalid URL`.
  // requireOperand: this script has nothing more specific to say about a missing
  // operand than the shared message, and without it `--max-chars --help` prints
  // usage and exits 0 with the malformed flag never reported (the ordering
  // CodeRabbit caught on #2961).
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });

  const { url, mode, max, maxChars, timeout } = parseArgs(args);

  if (!url) {
    console.error(JSON.stringify({ error: `usage: ${USAGE_SYNOPSIS}`, code: 'no_url' }));
    process.exit(1);
  }
  if (mode !== 'jd' && mode !== 'listing') {
    console.error(JSON.stringify({ error: `unknown mode "${mode}" (expected jd|listing)`, code: 'bad_mode' }));
    process.exit(1);
  }

  const guard = rejectPrivateOrInvalid(url);
  if (guard) {
    console.error(JSON.stringify({ error: guard.reason, code: guard.code }));
    process.exit(1);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(JSON.stringify({ error: 'playwright not installed', code: 'no_playwright' }));
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await newExtractionPage(browser);
    const started = Date.now();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    const raw = await readPage(page, { mode, timeout: Math.max(1, timeout - (Date.now() - started)) });

    // Belt-and-suspenders: never emit content read from a private final URL.
    const finalUrl = page.url();
    const finalGuard = rejectPrivateOrInvalid(finalUrl);
    if (finalGuard) {
      console.error(JSON.stringify({ error: `blocked final URL: ${finalGuard.reason}`, code: finalGuard.code }));
      process.exitCode = 1;
      return;
    }
    const result = mode === 'listing'
      ? normalizeListing(raw.anchors, finalUrl, max)
      : normalizeJd(raw, finalUrl, maxChars);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    console.error(JSON.stringify({ error: `navigation error: ${String(err.message).split('\n')[0]}`, code: 'navigation_error' }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Only run main() when invoked directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
