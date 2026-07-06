// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Browser scraper provider — uses Playwright to extract job listings from
// JS-rendered careers pages (Oracle HCM, custom React/Next.js sites, etc.).
//
// Usage in portals.yml:
//   - name: Honeywell
//     careers_url: https://careers.honeywell.com/en/sites/Honeywell/jobs
//     scan_method: browser
//     browser_selectors:
//       jobContainer: '[data-testid="job-card"]'   # or any CSS selector
//       title: '.job-title'
//       location: '.job-location'
//       link: 'a'
//     notes: "Oracle HCM — needs browser rendering"
//     enabled: true
//
// If no selectors are provided, the provider falls back to heuristics:
//   1. Look for links containing "/job/" in the href
//   2. Look for elements with "job" in class/data-testid
//   3. Extract text content as title

import { chromium } from 'playwright';

const DEFAULT_TIMEOUT_MS = 30_000;
const NAVIGATION_WAIT_UNTIL = 'networkidle';
const POST_LOAD_DELAY_MS = 3_000;

/** Extract jobs from a JS-rendered page using heuristics. */
async function extractJobsWithHeuristics(page, companyName, careersUrl) {
  const jobs = [];
  const seenUrls = new Set();

  // Strategy 1: Look for job links with "/job/" in the path
  const jobLinks = await page.$$eval('a[href*="/job/"], a[href*="/jobs/"]', links =>
    links.map(a => ({
      href: a.href,
      text: a.textContent.trim(),
    })).filter(l => l.text.length > 0 && l.text.length < 200)
  );

  for (const link of jobLinks) {
    if (seenUrls.has(link.href)) continue;
    seenUrls.add(link.href);
    jobs.push({
      title: link.text,
      url: link.href,
      company: companyName,
      location: '',
    });
  }

  // Strategy 2: If no job links found, look for elements with "job" in class or data attributes
  if (jobs.length === 0) {
    const selectors = [
      '[class*="job"]',
      '[class*="Job"]',
      '[data-testid*="job"]',
      '[data-testid*="Job"]',
      '[role="listitem"]',
    ];

    for (const sel of selectors) {
      const elements = await page.locator(sel).all();
      for (const el of elements) {
        const text = await el.textContent().catch(() => '');
        const link = await el.locator('a').first();
        const href = await link.getAttribute('href').catch(() => '');

        if (!text || text.length < 3 || text.length > 200) continue;

        const fullUrl = href ? new URL(href, careersUrl).href : careersUrl;
        if (seenUrls.has(fullUrl)) continue;
        seenUrls.add(fullUrl);

        jobs.push({
          title: text.split('\n')[0].trim(),
          url: fullUrl,
          company: companyName,
          location: '',
        });
      }

      if (jobs.length > 0) break; // Stop once we find jobs with one selector
    }
  }

  return jobs;
}

/** Extract jobs using user-provided selectors. */
async function extractJobsWithSelectors(page, selectors, companyName, careersUrl) {
  const jobs = [];
  const seenUrls = new Set();
  const containers = await page.locator(selectors.jobContainer || 'body').all();

  for (const container of containers) {
    const title = await container.locator(selectors.title || 'a').first().textContent().catch(() => '');
    const link = await container.locator(selectors.link || 'a').first().getAttribute('href').catch(() => '');
    const location = selectors.location
      ? await container.locator(selectors.location).first().textContent().catch(() => '')
      : '';

    if (!title || title.length < 3) continue;

    const fullUrl = link ? new URL(link, careersUrl).href : careersUrl;
    if (seenUrls.has(fullUrl)) continue;
    seenUrls.add(fullUrl);

    jobs.push({
      title: title.trim(),
      url: fullUrl,
      company: companyName,
      location: location.trim(),
    });
  }

  return jobs;
}

/** @type {Provider} */
export default {
  id: 'browser-scraper',

  detect(entry) {
    // Only activate when explicitly requested via scan_method: browser
    if (entry.scan_method === 'browser' || entry.provider === 'browser-scraper') {
      return { url: entry.careers_url || '' };
    }
    return null;
  },

  async fetch(entry, ctx) {
    const url = entry.careers_url || '';
    if (!url.startsWith('http')) {
      throw new Error('browser-scraper: careers_url must be an HTTP(S) URL');
    }

    const companyName = entry.name || 'Unknown';
    const selectors = entry.browser_selectors || {};

    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ignoreHTTPSErrors: true,
      });
      const page = await context.newPage();

      await page.goto(url, {
        waitUntil: NAVIGATION_WAIT_UNTIL,
        timeout: DEFAULT_TIMEOUT_MS,
      });

      // Wait for dynamic content to load
      await page.waitForTimeout(POST_LOAD_DELAY_MS);

      // Try scrolling to trigger lazy loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1_000);

      const jobs = selectors.jobContainer
        ? await extractJobsWithSelectors(page, selectors, companyName, url)
        : await extractJobsWithHeuristics(page, companyName, url);

      return jobs;
    } finally {
      if (browser) await browser.close();
    }
  },
};
