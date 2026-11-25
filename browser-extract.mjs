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
 * Workday (`*.myworkdayjobs.com`) is read through its public CXS JSON endpoint
 * instead of the rendered page: Workday hydrates the JD into a virtualized DOM
 * that readDom() below cannot see, so scraping it returned a well-formed result
 * with an EMPTY `text` — indistinguishable, to a caller, from a posting that
 * genuinely has no content. Same API family scan.mjs already uses for Workday
 * boards (providers/workday.mjs); the per-job URL derivation is reused from
 * liveness-api.mjs so the two cannot drift.
 *
 * Output: compact JSON to stdout. Exit 0 on success; exit 1 on a hard error,
 * printing `{ "error": "...", "code": "..." }` (so a caller/mode can fall back
 * to the MCP path silently). An empty/near-empty jd-mode extraction is one of
 * those hard errors (`code: "empty_text"`) rather than a successful-looking
 * empty JD — the documented silent fallback only fires if the tool actually
 * reports failure. So is a Cloudflare challenge or block page served in place
 * of the posting (`code: "bot_challenge"`). Reuses liveness-browser.mjs's SSRF host guard and
 * realistic-UA context so it isn't instantly bot-walled.
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadYaml } from './lib/yaml-document.mjs';
import { LIVENESS_CONTEXT_OPTIONS, rejectPrivateOrInvalid } from './liveness-browser.mjs';
import { getCareerOpsRoot, getProfilePath } from './path-resolver.mjs';
import { fetchJdFromPage, fetchJdViaKnownApi, jdHtmlToText, compactText, JD_TEXT_CAP, WORKDAY_TIMEOUT_MS } from './fetch-jd.mjs';
import { classifyLiveness } from './liveness-core.mjs';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { browserLaunchOptions } from './lib/browser-launch.mjs';

const CAREER_OPS = getCareerOpsRoot();

const DEFAULT_TIMEOUT_MS = 15_000;
const HYDRATION_WAIT_MS = 2_000;
const DEFAULT_LISTING_MAX = 200;

// Floor below which a jd-mode extraction is treated as failure, not content.
// A posting page whose main text is a couple of sentences is a render we
// missed (SPA shell, consent wall, bot interstitial), never a real JD; the
// cost of being wrong is one silent fallback to the MCP path, whereas the
// cost of NOT failing is an empty JD evaluated as if it were the posting.
// Only jd mode gets this guard: an empty `listing` result is legitimate — a
// company with no open roles.
const MIN_JD_TEXT_CHARS = 200;

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
export function resolveExtractorMode(profilePath = getProfilePath()) {
  try {
    if (!existsSync(profilePath)) return 'mcp';
    const raw = loadYaml(readFileSync(profilePath, 'utf-8')) || {};
    const v = raw?.scan?.extractor;
    return v === 'cli' ? 'cli' : 'mcp';
  } catch {
    return 'mcp';
  }
}


/**
 * Shape a JD-mode result from the raw DOM read. Pure — exported for tests.
 * @param {{ title?: string, text?: string }} raw
 * @param {string} finalUrl
 */
export function normalizeJd(raw, finalUrl, textCap = JD_TEXT_CAP) {
  // A schema.org JobPosting, when the page ships one, beats the rendered DOM:
  // it is the posting body as the employer published it, not as their template
  // happened to lay it out. On Phenom boards (careers.roche.com) the rendered
  // <main> holds title, location and Apply chrome only — ~300 characters — while
  // the body never becomes visible text at all, so the DOM path emitted a JD
  // with no requirements in it and reported success. Same shape on other
  // template-driven corporate boards, which is why this keys off the standard
  // rather than off a host.
  //
  // Longer wins rather than JSON-LD always winning: plenty of pages carry a
  // stub JobPosting (a one-line summary, or just the title) alongside a fully
  // rendered body, and preferring the stub there would break the common case to
  // fix the rare one.
  const ldText = jdHtmlToText(raw?.jsonLdDescription || '');
  // Normalized length, not raw length: raw DOM text on a chrome-heavy page is
  // mostly repeated newlines ("Apply now\n\n\n\n\n\nSave job\n\n\n\n\n\n..."), which
  // can out-length a shorter-in-raw-HTML but substantive JSON-LD description
  // before either side is compacted. Comparing pre-collapse defeats the whole
  // point of "longer wins". No cap here (Infinity) — only the comparison needs
  // normalizing; the real textCap is still applied below.
  const domText = compactText(String(raw?.text || ''), Infinity);
  const text = ldText.length > domText.length ? ldText : domText;

  return {
    url: finalUrl,
    title: compactText(raw?.title || raw?.jsonLdTitle || '', 300),
    text: compactText(text, textCap),
    // For the liveness check in jdFailure() only. `text` has had nav/header/footer
    // stripped, and an expired-posting banner often sits in one of them. Never
    // emitted on the success path.
    bodyText: compactText(raw?.bodyText || '', 4100),
  };
}

function isJobicyPosting(url) {
  const parsed = new URL(url); // jd mode has already validated the URL.
  return parsed.protocol === 'https:' && !parsed.port && !parsed.username && !parsed.password
    && /^(?:www\.)?jobicy\.com$/.test(parsed.hostname) && /^\/jobs\/[a-z0-9-]+\/?$/.test(parsed.pathname);
}


/**
 * Write a jd-mode result to stdout, or fail with `empty_text` when the
 * extraction came back empty enough to be useless.
 *
 * A `--max-chars` below the floor is honored rather than made unsatisfiable: a
 * caller who asks for 50 chars gets 50, not a guaranteed failure.
 */
/**
 * Why a jd-mode result cannot be emitted, or null when it can. Pure — exported
 * for tests.
 *
 * A page whose cleaned text is below the floor is either unreadable (a client-
 * rendered shell: `empty_text`, worth another attempt) or gone (the posting
 * was taken down: `unavailable`, terminal). Both produce the same empty text,
 * because the "no longer available" banner usually sits in a header or footer
 * that readDom() strips — so the unstripped body is checked too. A result at or
 * above the floor is never reclassified: a full JD may quote such a phrase.
 */
export function jdFailure(result, maxChars) {
  const floor = Math.min(MIN_JD_TEXT_CHARS, maxChars);
  if (result.text.length >= floor) return null;
  // The shared liveness classifier, not a second phrase list. Only its
  // posting-specific expiry verdicts count: `insufficient_content` is what a
  // page that has not rendered yet looks like (liveness-browser treats it the
  // same way), so it stays empty_text and remains worth retrying.
  const verdict = classifyLiveness({
    requestedUrl: result.url,
    finalUrl: result.url,
    bodyText: `${result.text}\n${result.bodyText || ''}`,
  });
  if (verdict.result === 'expired' && (verdict.code === 'expired_body' || verdict.code === 'expired_body_soft')) {
    return { error: `posting is no longer available (${verdict.reason})`, code: 'unavailable', url: result.url };
  }
  return {
    error: `extracted ${result.text.length} chars of JD text (minimum ${floor}) — the page most likely renders its content client-side`,
    code: 'empty_text',
    url: result.url,
    body_text: String(result.bodyText || '').slice(0, 4000),
  };
}

function emitJd(result, maxChars) {
  const failure = jdFailure(result, maxChars);
  if (failure) {
    console.error(JSON.stringify(failure));
    process.exitCode = 1;
    return;
  }
  // bodyText exists only for jdFailure(); drop it so the documented success
  // shape `{ url, title, text }` is unchanged.
  const { bodyText: _bodyText, closed: _closed, evidence: _evidence, ...emitted } = result;
  process.stdout.write(JSON.stringify(emitted));
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
  --timeout MS        navigation timeout (default ${DEFAULT_TIMEOUT_MS})
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

// Read the raw DOM inside the page: title, main visible text, and visible
// anchors. Runs in the browser context; returns plain data only.
export async function readDom(page) {
  return page.evaluate(() => {
    const title = (document.querySelector('h1')?.innerText || document.title || '').trim();

    // Main text: prefer <main>/[role=main]/<article>, else body; strip nav chrome.
    // Keep the candidate with the most text left after stripping, not the first
    // match: a board can lead with a short <article> (a share widget) ahead of
    // the one holding the posting, and a <main> that is mostly menu would
    // otherwise outrank it.
    // Read innerText from the live element: on a detached clone it degrades to
    // textContent, so CSS-hidden text would count and could outrank the posting.
    // The chrome is hidden only for the read and its style attribute restored.
    // script/style/noscript are never rendered, so innerText already skips them.
    const strippedText = (el) => {
      if (el.getClientRects().length === 0 && getComputedStyle(el).display !== 'contents') return '';
      const chrome = Array.from(el.querySelectorAll('nav, header, footer'));
      const saved = chrome.map((n) => n.getAttribute('style'));
      // Attribute writes only: setting a property through n.style leaves style=""
      // behind after removeAttribute. The prefix is the browser's serialized
      // cssText, not the raw attribute, so an unterminated token in the original
      // (an open /* comment) cannot swallow the appended display:none.
      chrome.forEach((n) => n.setAttribute('style', `${n.style.cssText} display: none !important;`));
      try {
        return el.innerText || '';
      } finally {
        chrome.forEach((n, i) => (saved[i] == null ? n.removeAttribute('style') : n.setAttribute('style', saved[i])));
      }
    };
    const candidates = Array.from(document.querySelectorAll('main, [role="main"], article'));
    let text = '';
    for (const el of candidates) {
      const t = strippedText(el);
      if (t.length > text.length) text = t;
    }
    if (candidates.length === 0 && document.body) text = strippedText(document.body);

    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((el) => {
        if (el.closest('nav, header, footer')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.getClientRects().length > 0;
      })
      .map((el) => ({ href: el.getAttribute('href') || '', label: (el.innerText || '').trim() }));

    // schema.org JobPosting, if present. Returned as the raw description markup
    // so the shared jdHtmlToText() does the conversion, keeping one entity /
    // block-break implementation rather than a second one inside the page.
    let jsonLdDescription = '';
    let jsonLdTitle = '';
    for (const el of document.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try {
        parsed = JSON.parse(el.textContent || 'null');
      } catch {
        continue; // a malformed block must not cost us the well-formed one after it
      }
      // Publishers ship a bare object, an array, or an @graph wrapper.
      const candidates = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.['@graph'])
          ? parsed['@graph']
          : [parsed];
      // @type is the bare token in most feeds, but some publishers use the
      // absolute schema.org IRI instead — both forms occur in the wild.
      const isJobPostingType = (t) =>
        t === 'JobPosting' || t === 'http://schema.org/JobPosting' || t === 'https://schema.org/JobPosting';
      for (const node of candidates) {
        const type = node?.['@type'];
        const isJobPosting = Array.isArray(type) ? type.some(isJobPostingType) : isJobPostingType(type);
        if (!isJobPosting) continue;
        const desc = typeof node.description === 'string' ? node.description : '';
        if (desc.length > jsonLdDescription.length) {
          jsonLdDescription = desc;
          // Always reset, never carry over: a stub JobPosting's title must not
          // survive onto the description of a later, longer JobPosting node.
          jsonLdTitle = typeof node.title === 'string' ? node.title : '';
        }
      }
    }

    // The unstripped body: `text` above removes nav/header/footer, where an
    // expired-posting banner often lives.
    // Head and tail, so a banner in the footer is still in the sample when the
    // leading content fills the first 4000 characters.
    const fullBody = document.body?.innerText || '';
    const bodyText = fullBody.length > 4000 ? `${fullBody.slice(0, 2000)}\n…\n${fullBody.slice(-2000)}` : fullBody;

    // The document's own title, which `title` above passes over for an <h1>:
    // challengeFailure() reads it.
    return { title, text, anchors, jsonLdDescription, jsonLdTitle, bodyText, pageTitle: document.title || '' };
  });
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

  // Known-ATS API first: Workday, Ashby, Greenhouse, and Lever all ship the
  // full JD body in a public JSON endpoint (see fetchJdViaKnownApi), so a
  // browser is never needed for those hosts. Workday additionally hydrates its
  // JD into a virtualized DOM the readDom() below cannot see at all, so this
  // isn't just an optimization for it — it's the only path that works.
  // Inconclusive -> fall through to Playwright, unchanged.
  if (mode === 'jd') {
    const apiResult = await fetchJdViaKnownApi(url, maxChars, timeout);
    if (apiResult) {
      emitJd(apiResult, maxChars);
      return;
    }
    // Jobicy exposes its description as structured data on the posting page.
    if (isJobicyPosting(url)) {
      const result = await fetchJdFromPage(url, maxChars, timeout);
      if (result?.closed) {
        console.error(JSON.stringify({ error: result.evidence, code: 'unavailable', url }));
        process.exitCode = 1;
        return;
      }
      if (result) {
        emitJd({ url, title: result.title, text: result.text }, maxChars);
        return;
      }
    }
  }

  let chromium;
  try {
    ({ chromium } = await import('./lib/hardened-chromium.mjs'));
  } catch {
    console.error(JSON.stringify({ error: 'playwright not installed', code: 'no_playwright' }));
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch(browserLaunchOptions({ headless: true }));
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
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
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

    if (mode === 'listing') {
      process.stdout.write(JSON.stringify(normalizeListing(raw.anchors, finalUrl, max)));
    } else {
      const challenge = challengeFailure({ status: response?.status() ?? 0, pageTitle: raw.pageTitle, url: finalUrl });
      if (challenge) {
        console.error(JSON.stringify(challenge));
        process.exitCode = 1;
      } else {
        emitJd(normalizeJd(raw, finalUrl, maxChars), maxChars);
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ error: `navigation error: ${String(err.message).split('\n')[0]}`, code: 'navigation_error' }));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Only run main() when invoked directly, not when imported by tests.
if (isMainModule(import.meta.url)) {
  main();
}
