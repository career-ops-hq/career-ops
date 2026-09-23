// Shared Playwright listing scraper for job boards that block plain HTTP
// (Cloudflare, JS-rendered listings). Used by board-browser.mjs.
//
// Uses system Chrome when available (channel: 'chrome') plus the realistic UA
// from liveness-browser.mjs — the same combo that clears WAF walls headlessly.

import { LIVENESS_CONTEXT_OPTIONS, rejectPrivateOrInvalid, sleep } from '../liveness-browser.mjs';

export const DEFAULT_WAIT_MS = 5_000;
export const DEFAULT_MAX_JOBS = 100;
export const DEFAULT_MIN_TITLE_LENGTH = 3;
export const DEFAULT_NAV_TIMEOUT_MS = 20_000;

const NAV_LABEL_STOPWORDS = new Set([
  'home', 'about', 'about us', 'contact', 'contact us', 'login', 'log in', 'sign in',
  'sign up', 'register', 'privacy', 'privacy policy', 'terms', 'cookies', 'cookie policy',
  'careers', 'jobs', 'search', 'menu', 'back', 'next', 'previous', 'apply', 'apply now',
  'learn more', 'read more', 'faq', 'blog', 'news', 'help', 'support', 'english',
]);

function collapseWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function titleFromSlug(url) {
  try {
    const path = new URL(url).pathname;
    const slug = path.split('/').filter(Boolean).pop() || '';
    const decoded = decodeURIComponent(slug.replace(/[-_]+/g, ' '));
    const cleaned = collapseWhitespace(decoded.replace(/\b(job|jobs)\b/gi, ''));
    return cleaned.length >= DEFAULT_MIN_TITLE_LENGTH ? cleaned : '';
  } catch {
    return '';
  }
}

function splitCompanyFromLabel(label) {
  const text = collapseWhitespace(label);
  const at = text.match(/^(.+?)\s+at\s+(.+)$/i);
  if (at) return { title: at[1].trim(), company: at[2].trim() };
  const dash = text.match(/^(.+?)\s+[-–—|]\s+(.+)$/);
  if (dash) return { title: dash[1].trim(), company: dash[2].trim() };
  return { title: text, company: '' };
}

function defaultCompanyFromEntry(entry) {
  const name = collapseWhitespace(entry?.name || '');
  if (!name) return '';
  const dash = name.indexOf(' — ');
  return dash > 0 ? name.slice(0, dash).trim() : name;
}

/**
 * Filter visible anchors into normalized job rows. Pure — exported for tests.
 *
 * @param {Array<{ href?: string, label?: string }>} anchors
 * @param {string} pageUrl
 * @param {object} opts
 * @returns {Array<{ title: string, url: string, company: string, location: string }>}
 */
export function extractBoardJobs(anchors, pageUrl, opts = {}) {
  const {
    linkMatch,
    excludeMatch = '',
    maxJobs = DEFAULT_MAX_JOBS,
    minTitleLength = DEFAULT_MIN_TITLE_LENGTH,
    defaultCompany = '',
  } = opts;

  if (!linkMatch) throw new Error('board-browser: link_match is required');
  const linkRe = new RegExp(linkMatch, 'i');
  const excludeRe = excludeMatch ? new RegExp(excludeMatch, 'i') : null;

  const jobs = [];
  const seen = new Set();

  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    let url;
    try {
      url = new URL(String(anchor?.href ?? ''), pageUrl).href;
    } catch {
      continue;
    }
    if (!/^https?:$/.test(new URL(url).protocol)) continue;
    if (!linkRe.test(url)) continue;
    if (excludeRe && excludeRe.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const label = collapseWhitespace(anchor?.label);
    if (label && label.length < minTitleLength) continue;
    if (label && NAV_LABEL_STOPWORDS.has(label.toLowerCase())) continue;

    const parsed = splitCompanyFromLabel(label);
    let title = parsed.title;
    let company = parsed.company || defaultCompany;

    if (!title || title.length < minTitleLength) {
      title = titleFromSlug(url);
    }
    if (!title || title.length < minTitleLength) continue;

    jobs.push({
      title,
      url,
      company,
      location: '',
    });
    if (jobs.length >= maxJobs) break;
  }

  return jobs;
}

async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (err) {
    throw new Error(`board-browser: Playwright not installed (${err.message})`);
  }

  const launchOpts = { headless: true };
  try {
    return await chromium.launch({ ...launchOpts, channel: 'chrome' });
  } catch {
    return await chromium.launch(launchOpts);
  }
}

/**
 * Navigate to a board listing page and extract job links.
 *
 * @param {string} url
 * @param {object} opts
 * @returns {Promise<Array<{ title: string, url: string, company: string, location: string }>>}
 */
export async function scrapeBoardPage(url, opts = {}) {
  const guard = rejectPrivateOrInvalid(url);
  if (guard) throw new Error(`board-browser: ${guard.reason}`);

  const waitMs = Number(opts.waitMs ?? DEFAULT_WAIT_MS);
  const timeoutMs = Number(opts.timeoutMs ?? DEFAULT_NAV_TIMEOUT_MS);
  const scrollSteps = Number(opts.scrollSteps ?? 0);

  const browser = await launchBrowser();
  try {
    const context = await browser.newContext(LIVENESS_CONTEXT_OPTIONS);
    await context.route('**/*', (route) => {
      if (rejectPrivateOrInvalid(route.request().url())) return route.abort('blockedbyclient');
      return route.continue();
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    if (waitMs > 0) await sleep(waitMs);

    for (let i = 0; i < scrollSteps; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(500);
    }

    const finalGuard = rejectPrivateOrInvalid(page.url());
    if (finalGuard) throw new Error(`board-browser: blocked final URL: ${finalGuard.reason}`);

    const anchors = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .filter((el) => {
          if (el.closest('nav, header, footer')) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          return el.getClientRects().length > 0;
        })
        .map((el) => ({
          href: el.getAttribute('href') || '',
          label: (el.innerText || el.textContent || '').trim(),
        }));
    });

    return extractBoardJobs(anchors, page.url(), opts);
  } finally {
    await browser.close().catch(() => {});
  }
}

export { defaultCompanyFromEntry };
