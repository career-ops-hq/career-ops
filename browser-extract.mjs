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

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { LIVENESS_CONTEXT_OPTIONS, rejectPrivateOrInvalid } from './liveness-browser.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));

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

/**
 * Resolve the configured scan extractor: `cli` (this helper) or `mcp` (default).
 * Reads `scan.extractor` from config/profile.yml; anything unrecognized — or a
 * missing/unreadable file — yields `mcp` so behavior never breaks. Exported so
 * doctor.mjs reports the same value.
 * @param {string} [profilePath]
 * @returns {'cli'|'mcp'}
 */
export function resolveExtractorMode(profilePath = join(CAREER_OPS, 'config/profile.yml')) {
  try {
    if (!existsSync(profilePath)) return 'mcp';
    const raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    const v = raw?.scan?.extractor;
    return v === 'cli' ? 'cli' : 'mcp';
  } catch {
    return 'mcp';
  }
}

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

/**
 * Parse CLI args into { url, mode, max, timeout }. Index-based so a flag value
 * (e.g. the `listing` in `--mode listing`) is never mistaken for the URL, and an
 * explicit `0` is honored instead of being silently replaced by the default.
 * Exported for tests.
 * @param {string[]} argv - process.argv.slice(2)
 */
export function parseArgs(argv) {
  const FLAGS = new Set(['--mode', '--max', '--max-chars', '--timeout']);
  let url;
  let mode = 'jd';
  let max = DEFAULT_LISTING_MAX;
  let maxChars = JD_TEXT_CAP;
  let timeout = DEFAULT_TIMEOUT_MS;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (FLAGS.has(tok)) {
      const val = argv[++i]; // consume the next token as this flag's value
      const n = Number(val);
      if (tok === '--mode' && val != null) mode = val;
      else if (tok === '--max' && Number.isInteger(n) && n >= 0) max = n;
      else if (tok === '--max-chars' && Number.isInteger(n) && n > 0) maxChars = n;
      else if (tok === '--timeout' && Number.isInteger(n) && n > 0) timeout = n;
    } else if (!tok.startsWith('--') && url === undefined) {
      url = tok;
    }
  }
  return { url, mode, max, maxChars, timeout };
}

// Read the raw DOM inside the page: title, main visible text, and visible
// anchors. Runs in the browser context; returns plain data only.
async function readDom(page) {
  return page.evaluate(() => {
    const title = (document.querySelector('h1')?.innerText || document.title || '').trim();

    // Main text: prefer <main>/[role=main]/<article>, else body; strip nav chrome.
    const root =
      document.querySelector('main, [role="main"], article') || document.body;
    let text = '';
    if (root) {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script, style, nav, header, footer, noscript').forEach((el) => el.remove());
      text = clone.innerText || '';
    }

    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((el) => {
        if (el.closest('nav, header, footer')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
      })
      .map((el) => ({ href: el.getAttribute('href') || '', label: (el.innerText || '').trim() }));

    return { title, text, anchors };
  });
}

async function main() {
  const { url, mode, max, maxChars, timeout } = parseArgs(process.argv.slice(2));

  if (!url) {
    console.error(JSON.stringify({ error: 'usage: browser-extract.mjs <url> [--mode jd|listing] [--max N] [--max-chars N]', code: 'no_url' }));
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
    const context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
    // Block every request (main navigation, redirect hop, or subresource) to a
    // private/loopback/link-local or non-http(s) host. Guarding only the initial
    // URL isn't enough once we return page CONTENT: a server-side redirect could
    // otherwise steer the browser at internal infrastructure (SSRF).
    await context.route('**/*', (route) => {
      if (rejectPrivateOrInvalid(route.request().url())) return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForTimeout(HYDRATION_WAIT_MS); // let SPAs hydrate

    // Belt-and-suspenders: never emit content read from a private final URL.
    const finalUrl = page.url();
    const finalGuard = rejectPrivateOrInvalid(finalUrl);
    if (finalGuard) {
      console.error(JSON.stringify({ error: `blocked final URL: ${finalGuard.reason}`, code: finalGuard.code }));
      process.exitCode = 1;
      return;
    }
    const raw = await readDom(page);

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
