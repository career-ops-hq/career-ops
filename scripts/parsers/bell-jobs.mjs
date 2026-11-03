#!/usr/bin/env node
/**
 * bell-jobs.mjs — local parser for Bell Canada's career site (jobs.bell.ca).
 *
 * Why this exists: jobs.bell.ca runs on Phenom People's CareerConnect SPA.
 * Its search-results widget throws a genuine client-side error in a real
 * browser —
 *   SecurityError: Failed to set the 'domain' property on 'Document':
 *   'phenompro.com' is not a suffix of 'jobs.bell.ca'.
 * — alongside "Invalid widget id" and TypeError console errors, so the job
 * list never hydrates (confirmed via Playwright + DOM/console inspection,
 * 2026-11-03; reproducible, not an automation artifact). Playwright-based
 * Level 1 scraping of the search page is therefore unreliable for this site.
 *
 * The fix: jobs.bell.ca publishes a static XML sitemap
 * (https://jobs.bell.ca/ca/en/sitemap.xml, referenced from robots.txt) that
 * lists every live job posting URL with a lastmod date — a plain HTTP GET,
 * no browser, no JS execution required. Job titles are derived from the
 * URL slug (the sitemap carries no separate title field); this is an
 * approximation good enough for title-filter prefiltering — any posting
 * that survives the filter still gets read live (Playwright) during
 * evaluation, so a slightly mangled slug-derived title never reaches the
 * candidate as fact.
 *
 * Stdout contract: scripts/parsers/*.mjs — see docs/local-parser-cookbook.md.
 */

const SITEMAP_URL = 'https://jobs.bell.ca/ca/en/sitemap.xml';
const JOB_URL_RE = /<loc>(https:\/\/jobs\.bell\.ca\/ca\/en\/job\/\d+\/[^<]+)<\/loc>/g;

function titleFromSlug(url) {
  const slug = url.split('/').pop() || '';
  return slug
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const res = await fetch(SITEMAP_URL, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; career-ops local-parser)' },
  });
  if (!res.ok) {
    throw new Error(`bell-jobs: sitemap fetch failed with HTTP ${res.status}`);
  }
  const xml = await res.text();

  const jobs = [];
  const seen = new Set();
  for (const match of xml.matchAll(JOB_URL_RE)) {
    const url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    jobs.push({
      title: titleFromSlug(url),
      url,
      company: 'Bell',
      location: '',
    });
  }

  process.stdout.write(JSON.stringify(jobs));
}

main().catch(err => {
  process.stderr.write(`bell-jobs parser error: ${err.message}\n`);
  process.exit(1);
});
