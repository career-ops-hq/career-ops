#!/usr/bin/env node

/**
 * scan-custom-pages.mjs — Playwright fallback scanner for custom careers pages
 *
 * Companies without a recognized ATS (Greenhouse / Ashby / Lever / Workable /
 * Getro / Onchainhires) get scraped here. Each company has a CONFIG entry that
 * specifies the URL, optional iframe to drill into, and CSS selectors / heuristics
 * for extracting job titles and URLs.
 *
 * Output: appends new candidates to data/pipeline.md and scan-history.tsv with
 * source tag `{company-slug}-playwright`, deduped against existing entries.
 *
 * Usage:
 *   node scan-custom-pages.mjs                    # scan all configured companies
 *   node scan-custom-pages.mjs --dry-run          # preview without writing files
 *   node scan-custom-pages.mjs --company ottersec # scan a single company
 *
 * Per-company strategies:
 * - OtterSec: simple link extraction from osec.io/careers (direct /careers/{slug} hrefs).
 * - Chainlink Labs: navigates the Ashby iframe at chainlinklabs.com/open-roles,
 *   waits for posting list to render, extracts visible job links.
 * - StarkWare: starkware.co/careers loads via Comeet ATS. Comeet uses /careers
 *   with javascript-rendered list; extract links to /careers/co/{...}.
 * - Scroll: scroll.io/join-us links to a Greenhouse board (currently stale 404)
 *   - falls back to extracting role mentions from scroll.io/join-us prose.
 * - Ethereum Foundation: ethereum.org/about/#open-jobs renders job cards inside
 *   the page; extract by job-card heading + link.
 *
 * Each company has a `mode` indicating how to extract:
 *   - 'direct-links': all anchors matching a selector are jobs
 *   - 'iframe': drill into specified iframe src and run direct-links there
 *   - 'heading-scan': find headings + their following links/text as job titles
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';

const PIPELINE_PATH = 'data/pipeline.md';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const FETCH_TIMEOUT_MS = 30_000;
const NAV_TIMEOUT_MS = 20_000;

mkdirSync('data', { recursive: true });

// Per-company config. Each entry's `extract` function runs inside the browser
// page context and returns an array of `{title, url}` records.
const COMPANIES = [
  {
    name: 'OtterSec',
    slug: 'ottersec',
    url: 'https://osec.io/careers',
    mode: 'direct-links',
    waitMs: 1000,
    extract: () => {
      // OtterSec's careers page lists each role as <a href="/careers/{role}">.
      const links = Array.from(document.querySelectorAll('a[href^="/careers/"]'));
      return links
        .filter(a => a.getAttribute('href') !== '/careers' && a.getAttribute('href') !== '/careers/')
        .map(a => {
          const text = (a.textContent || '').trim();
          // Title is the first meaningful chunk before "Full-Time" / "Part-Time".
          const title = text.split(/\s+(Full-Time|Part-Time|Contract|Remote)/i)[0].trim();
          return {
            title: title || 'unknown role',
            url: new URL(a.getAttribute('href'), location.origin).href,
          };
        });
    },
  },
  {
    name: 'Chainlink Labs',
    slug: 'chainlink-labs',
    url: 'https://chainlinklabs.com/open-roles',
    mode: 'iframe',
    iframeSrcContains: 'ashbyhq.com/chainlink-labs',
    waitMs: 4000,
    extract: () => {
      // Inside the Ashby iframe each posting renders as a clickable card.
      // Ashby's posting list links look like /chainlink-labs/{uuid}.
      const links = Array.from(document.querySelectorAll('a[href*="/chainlink-labs/"]'));
      return links
        .map(a => {
          const title = (a.textContent || '').trim().split('\n')[0].trim();
          return { title, url: a.href };
        })
        .filter(j => j.title && j.title.length > 3 && j.title.length < 200);
    },
  },
  {
    name: 'StarkWare',
    slug: 'starkware',
    url: 'https://starkware.co/careers/',
    mode: 'direct-links',
    waitMs: 4000,
    extract: () => {
      // StarkWare uses Comeet — postings appear as <a href="https://www.comeet.com/..."> or
      // sometimes embedded into starkware.co/careers/co/{path}. Best-effort: find any
      // link whose text is a senior-ish role title.
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      return allLinks
        .map(a => ({ title: (a.textContent || '').trim(), url: a.href }))
        .filter(j => {
          const t = j.title.toLowerCase();
          return (
            j.title.length > 8 &&
            j.title.length < 120 &&
            /\b(engineer|developer|researcher|architect|scientist|designer|manager|lead|head|cto|director)\b/i.test(j.title) &&
            !/cookie|consent|details|show|hide|menu|navigation|policy/i.test(t) &&
            !j.url.endsWith('#')
          );
        });
    },
  },
  {
    name: 'Scroll',
    slug: 'scroll',
    url: 'https://scroll.io/join-us',
    mode: 'direct-links',
    waitMs: 2500,
    extract: () => {
      // Scroll links to a Greenhouse board (currently stale 404), but the page itself
      // sometimes lists job titles in body prose. Best-effort: any "View open positions"
      // CTA + any role keyword in the page.
      const allLinks = Array.from(document.querySelectorAll('a[href]'));
      return allLinks
        .map(a => ({ title: (a.textContent || '').trim(), url: a.href }))
        .filter(j => {
          if (j.url.includes('greenhouse.io') || j.url.includes('ashby') || j.url.includes('lever.co')) return true;
          return false;
        });
    },
  },
  {
    name: 'Ethereum Foundation',
    slug: 'ethereum-foundation',
    url: 'https://ethereum.org/about/',
    mode: 'heading-scan',
    waitMs: 3500,
    extract: () => {
      // The #open-jobs section renders job cards. STRICT extraction: only links
      // that (a) have a role keyword in the visible text AND (b) point to an
      // external careers domain or /careers / /job paths. Anchor links to
      // other sections of ethereum.org are nav, not jobs.
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
      const openJobsHeading = headings.find(h => /open jobs/i.test(h.textContent || ''));
      if (!openJobsHeading) return [];
      let section = openJobsHeading.parentElement;
      for (let i = 0; i < 3 && section && section.tagName !== 'SECTION' && section.tagName !== 'MAIN'; i++) {
        section = section.parentElement;
      }
      if (!section) return [];
      const ROLE_KEYWORDS = /\b(engineer|developer|researcher|architect|scientist|designer|manager|lead|head|director|coordinator|specialist|advocate|strategist)\b/i;
      const jobLinks = Array.from(section.querySelectorAll('a[href]'));
      return jobLinks
        .map(a => ({ title: (a.textContent || '').trim(), url: a.href, raw: a }))
        .filter(j => {
          if (!j.title || j.title.length < 8 || j.title.length > 140) return false;
          if (!ROLE_KEYWORDS.test(j.title)) return false;
          // Reject pure anchor links (same-page navigation).
          const u = new URL(j.url, location.origin);
          if (u.hostname === 'ethereum.org' && u.pathname === '/about/' && u.hash) return false;
          // Reject community / about links the heading-scan also matches.
          if (/^\/(community|about|foundation|what-is-ethereum|governance|core-principles)/i.test(u.pathname)) return false;
          return true;
        })
        .map(j => ({ title: j.title, url: j.url }));
    },
  },
];

// ── Title filter and dedup (mirror scan.mjs) ─────────────────────────

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());
  return title => {
    const lower = (title || '').toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

function loadSeenUrls() {
  const seen = new Set();
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    }
  }
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) seen.add(match[1]);
  }
  return seen;
}

function appendToScanHistory(offers, date) {
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }
  const lines = offers
    .map(o => `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`)
    .join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  let text = readFileSync(PIPELINE_PATH, 'utf-8');
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o => `- [ ] ${o.url} | ${o.company} | ${o.title}`).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    const block = '\n' + offers.map(o => `- [ ] ${o.url} | ${o.company} | ${o.title}`).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }
  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

// ── Per-company scrape ──────────────────────────────────────────────

async function scrapeOne(browser, company, titleFilter, seenUrls) {
  const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (career-ops scan-custom-pages)' });
  const page = await context.newPage();
  page.setDefaultTimeout(NAV_TIMEOUT_MS);
  const results = {
    company: company.name,
    slug: company.slug,
    raw: [],
    filtered: [],
    new: [],
    error: null,
  };
  try {
    await page.goto(company.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(company.waitMs || 2000);

    let target = page;
    if (company.mode === 'iframe') {
      const frame = page.frames().find(f => f.url().includes(company.iframeSrcContains));
      if (frame) {
        await frame.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForTimeout(2500);
        target = frame;
      } else {
        results.error = `iframe matching "${company.iframeSrcContains}" not found`;
      }
    }

    const extracted = await target.evaluate(company.extract).catch(err => {
      results.error = `extract eval failed: ${err.message}`;
      return [];
    });
    // Dedup within this company's results (keep first occurrence per URL).
    const seenInRun = new Set();
    for (const e of extracted) {
      if (!e?.url || seenInRun.has(e.url)) continue;
      seenInRun.add(e.url);
      results.raw.push({ title: e.title || '(no title)', url: e.url });
    }

    for (const r of results.raw) {
      if (!titleFilter(r.title)) continue;
      results.filtered.push(r);
      if (seenUrls.has(r.url)) continue;
      results.new.push({
        title: r.title,
        url: r.url,
        company: company.name,
        source: `${company.slug}-playwright`,
        location: '',
      });
    }
  } catch (err) {
    results.error = err.message;
  } finally {
    await context.close();
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;

  // Load title filter from portals.yml (same filter as scan.mjs).
  const yamlMod = await import('js-yaml');
  const parseYaml = yamlMod.default.load;
  const config = parseYaml(readFileSync('portals.yml', 'utf-8'));
  const titleFilter = buildTitleFilter(config.title_filter);

  const targets = COMPANIES.filter(c => !filterCompany || c.slug.includes(filterCompany) || c.name.toLowerCase().includes(filterCompany));
  console.log(`Scraping ${targets.length} custom-page companies via Playwright`);
  if (dryRun) console.log('(dry run — no files will be written)\n');

  const seenUrls = loadSeenUrls();
  const date = new Date().toISOString().slice(0, 10);
  const allNew = [];
  const summary = [];

  const browser = await chromium.launch({ headless: true });
  try {
    for (const c of targets) {
      process.stdout.write(`  → ${c.name}... `);
      const r = await scrapeOne(browser, c, titleFilter, seenUrls);
      summary.push(r);
      if (r.error) {
        console.log(`error: ${r.error}`);
      } else {
        console.log(`${r.raw.length} raw, ${r.filtered.length} pass filter, ${r.new.length} new`);
      }
      allNew.push(...r.new);
      // Mark these URLs as seen so cross-company dedup works within one run.
      for (const n of r.new) seenUrls.add(n.url);
    }
  } finally {
    await browser.close();
  }

  if (!dryRun && allNew.length > 0) {
    appendToPipeline(allNew);
    appendToScanHistory(allNew, date);
  }

  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Custom-Page Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scraped:    ${targets.length}`);
  console.log(`Raw jobs found:       ${summary.reduce((s, r) => s + r.raw.length, 0)}`);
  console.log(`Pass title filter:    ${summary.reduce((s, r) => s + r.filtered.length, 0)}`);
  console.log(`New offers added:     ${allNew.length}`);

  const errored = summary.filter(r => r.error);
  if (errored.length > 0) {
    console.log(`\nErrors (${errored.length}):`);
    for (const r of errored) console.log(`  ✗ ${r.company}: ${r.error}`);
  }

  if (allNew.length > 0) {
    console.log('\nNew offers:');
    for (const n of allNew) console.log(`  + ${n.company} | ${n.title} | ${n.url}`);
    console.log(dryRun ? '\n(dry run — re-run without --dry-run to save)' : `\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
