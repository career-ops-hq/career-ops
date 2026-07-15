#!/usr/bin/env node

/**
 * scan-interamt.mjs — Interamt.de scanner via Playwright
 *
 * Interamt uses Apache Wicket (stateful Java framework) — no REST API exists.
 * Playwright maintains a browser session so the wicket-crypt token and cookies
 * are handled transparently.
 *
 * Reads `interamt_searches` from portals.yml. Falls back to a default set of
 * GIS/geospatial keywords if the section is absent.
 *
 * Usage:
 *   node scan-interamt.mjs
 *   node scan-interamt.mjs --dry-run
 *   node scan-interamt.mjs --all            # skip date filter (use for first scan)
 *   node scan-interamt.mjs --keyword "Geoinformatik"
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';

// ── Config ───────────────────────────────────────────────────────────

const PORTALS_PATH    = 'portals.yml';
const SCAN_HISTORY    = 'data/scan-history.tsv';
const PIPELINE_PATH   = 'data/pipeline.md';
const APPLICATIONS    = 'data/applications.md';
const INTERAMT_HOME   = 'https://interamt.de/koop/app/';
// Direct offer URL — constructed from StellenangebotId.
// Wicket adds a session version number (?28&id=...) during live navigation,
// but the bookmarkable form (?id=...) works without a session.
// If a specific offer fails to load from pipeline, open Interamt manually
// and navigate to it — Wicket will assign a valid version for that session.
const OFFER_BASE_URL  = 'https://interamt.de/koop/app/stelle?id=';

// Generic fallback — configure interamt_searches in portals.yml for your target roles
const DEFAULT_KEYWORDS = [
  'Informatiker',
  'Softwareentwickler',
  'IT-Spezialist',
  'Datenwissenschaftler',
  'Systemadministrator',
  'Datenanalyst',
];

// ── Args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const DEBUG      = args.includes('--debug');
const NO_DATE_FILTER = args.includes('--all');
const kwIdx = args.indexOf('--keyword');
const SINGLE_KEYWORD = kwIdx !== -1 ? args[kwIdx + 1] : null;

// ── Load portals.yml ─────────────────────────────────────────────────

let config = {};
if (existsSync(PORTALS_PATH)) {
  config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8')) || {};
}

const interamtSearches = config.interamt_searches || DEFAULT_KEYWORDS.map(k => ({ was: k }));
const keywords = SINGLE_KEYWORD
  ? [SINGLE_KEYWORD]
  : interamtSearches.map(s => s.was).filter(Boolean);

// ── Filters ──────────────────────────────────────────────────────────

const titleFilter = config.title_filter || {};
const positiveKw = (titleFilter.positive || []).map(k => k.toLowerCase());
const negativeKw = (titleFilter.negative || []).map(k => k.toLowerCase());

function matchesTitle(title) {
  const lower = title.toLowerCase();
  if (negativeKw.some(k => lower.includes(k))) return false;
  if (positiveKw.length === 0) return true;
  return positiveKw.some(k => lower.includes(k));
}

const locFilter = config.location_filter || {};
const locAllow = (locFilter.allow || []).map(k => k.toLowerCase());
const locBlock = (locFilter.block || []).map(k => k.toLowerCase());

function matchesLocation(loc) {
  if (!loc) return true;
  const lower = loc.toLowerCase();
  if (locBlock.some(k => lower.includes(k))) return false;
  if (locAllow.length === 0) return true;
  return locAllow.some(k => lower.includes(k));
}

// ── Date helpers ─────────────────────────────────────────────────────

// Parse Interamt date format DD.MM.YYYY → Date (midnight UTC)
function parseDE(str) {
  if (!str) return null;
  const [d, m, y] = str.trim().split('.');
  if (!d || !m || !y) return null;
  return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T00:00:00Z`);
}

// Returns the most recent first_seen date for 'interamt' portal entries, or null
function loadLastScanDate() {
  if (!existsSync(SCAN_HISTORY)) return null;
  let latest = null;
  readFileSync(SCAN_HISTORY, 'utf-8').split('\n').slice(1).forEach(line => {
    const parts = line.split('\t');
    if (parts[2] !== 'interamt') return;
    const d = new Date((parts[1] || '') + 'T00:00:00Z');
    if (!isNaN(d) && (!latest || d > latest)) latest = d;
  });
  return latest;
}

// ── Dedup ────────────────────────────────────────────────────────────

function loadSeen() {
  const seen = new Set();
  if (existsSync(SCAN_HISTORY)) {
    readFileSync(SCAN_HISTORY, 'utf-8').split('\n').slice(1).forEach(line => {
      const url = line.split('\t')[0];
      if (url) seen.add(url);
    });
  }
  if (existsSync(PIPELINE_PATH)) {
    for (const m of readFileSync(PIPELINE_PATH, 'utf-8').matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(m[1]);
    }
  }
  if (existsSync(APPLICATIONS)) {
    for (const m of readFileSync(APPLICATIONS, 'utf-8').matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(m[0]);
    }
  }
  return seen;
}

// ── Writers ──────────────────────────────────────────────────────────

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  let text = existsSync(PIPELINE_PATH)
    ? readFileSync(PIPELINE_PATH, 'utf-8')
    : '# Pipeline\n\n## Pendientes\n\n';

  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  const block = '\n' + offers.map(o => {
    const parts = [o.url, o.company, o.title];
    if (o.city)     parts.push(o.city);
    if (o.modality) parts.push(o.modality);
    if (o.deadline) parts.push(`Frist: ${o.deadline}`);
    return `- [ ] ${parts.join(' | ')}`;
  }).join('\n') + '\n';

  if (idx === -1) {
    text += `\n${marker}\n${block}`;
  } else {
    const after = idx + marker.length;
    const next = text.indexOf('\n## ', after);
    const insertAt = next === -1 ? text.length : next;
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }
  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  if (!existsSync(SCAN_HISTORY)) {
    writeFileSync(SCAN_HISTORY, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tcity\tpublished_date\tdeadline\n', 'utf-8');
  }
  const lines = offers.map(o =>
    [o.url, date, 'interamt', o.title, o.company, 'added',
     `${o.modality || ''} ${o.city || ''}`.trim(),
     o.city || '', o.publishedDate || '', o.deadline || ''].join('\t')
  ).join('\n') + '\n';
  appendFileSync(SCAN_HISTORY, lines, 'utf-8');
}

// ── Stable selectors (Wicket name attributes don't change between sessions) ──

const SEL_EDIT_BTN    = 'a.ia-e-link--icon:has-text("Suchkriterien ändern"), a:has-text("Suchkriterien ändern")';
const SEL_NEXT_INPUT  = 'input[name="stellensucheFilterAttributes.suchtextContainer:stellensucheFilterAttributes.suchText"]';
const SEL_NEXT_SUBMIT = 'button.ia-e-button--primary:has-text("Detailsuche")';

// ── Scraper ──────────────────────────────────────────────────────────

async function extractRows(page) {
  return page.$$eval('tr.ia-e-table__row', rows =>
    rows.map(row => {
      const cell = field => row.querySelector(`td[data-field="${field}"]`)?.textContent?.trim() || '';

      const title        = cell('Stellenbezeichnung');
      const id           = row.querySelector('td[data-field="StellenangebotId"] span')?.textContent?.trim() || '';
      const company      = cell('Behoerde') || 'Interamt';
      const modality     = cell('Dienstort');
      const city         = cell('PLZOrte');
      const publishedDate = cell('Von');
      const deadline     = cell('Bewerbungsfrist');

      return { title, id, company, modality, city, publishedDate, deadline };
    }).filter(r => r.title && r.id)
  );
}

async function searchInteramt(page, keyword, isFirst) {
  const found = [];

  if (isFirst) {
    // Initial search: navigate to homepage and use the landing form
    await page.goto(INTERAMT_HOME, { waitUntil: 'networkidle', timeout: 30000 });

    // Dismiss cookie modal — it has a backdrop overlay that blocks all clicks
    const cookieModal = page.locator('#ia-m-cookie-modal');
    const isModalVisible = await cookieModal.isVisible().catch(() => false);
    if (isModalVisible) {
      await page.locator('#ia-m-cookie-modal .ia-m-modal__close').click();
      await cookieModal.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => null);
    }

    await page.waitForSelector('#idOrSuchtext', { state: 'visible', timeout: 15000 });
    await page.fill('#idOrSuchtext', keyword);

    // #ida is Wicket auto-generated; fallback to class selector if ID changes
    const submitBtn = page.locator('#ida, button.ia-e-button--primary.ia-e-button--icon').first();
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await submitBtn.click();
  } else {
    // Subsequent search: use "Suchkriterien ändern" to reuse the Wicket session.
    // Fall back to a fresh homepage load if the button isn't found (e.g. after an error).
    const editBtn = page.locator(SEL_EDIT_BTN).first();
    const editVisible = await editBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (editVisible) {
      // Dismiss any modal/backdrop that Wicket may have raised during the previous search
      const anyModal = page.locator('.ia-m-modal__close').first();
      if (await anyModal.isVisible({ timeout: 2000 }).catch(() => false)) {
        await anyModal.evaluate(el => el.click());
        await page.locator('.ia-m-modal__container').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => null);
      }
      await page.locator('.ia-e-backdrop').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => null);
      await editBtn.evaluate(el => el.click());
      await page.waitForSelector(SEL_NEXT_INPUT, { state: 'visible', timeout: 15000 });
      await page.fill(SEL_NEXT_INPUT, keyword);
      const submitBtn = page.locator(SEL_NEXT_SUBMIT);
      await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
      await submitBtn.click();
    } else {
      // Fallback: reload homepage (no cookie modal on subsequent loads)
      await page.goto(INTERAMT_HOME, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForSelector('#idOrSuchtext', { state: 'visible', timeout: 15000 });
      await page.fill('#idOrSuchtext', keyword);
      const submitBtn = page.locator('#ida, button.ia-e-button--primary.ia-e-button--icon').first();
      await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
      await submitBtn.click();
    }
  }

  // Wait for results table or "no results" message
  await Promise.race([
    page.waitForSelector('tr.ia-e-table__row', { timeout: 20000 }),
    page.waitForSelector('.ia-e-no-results, .ia-no-results, [class*="no-result"]', { timeout: 20000 }),
  ]).catch(() => null);

  if (DEBUG) {
    await page.screenshot({ path: 'output/debug-interamt.png', fullPage: true });
    const { writeFileSync: wf } = await import('fs');
    wf('output/debug-interamt.html', await page.content());
    console.log('  [debug] screenshot → output/debug-interamt.png');
    console.log('  [debug] html       → output/debug-interamt.html');
    console.log('  [debug] url:', page.url());
    const rowCount = await page.$$eval('tr', rows => rows.length);
    console.log(`  [debug] total <tr> on page: ${rowCount}`);
  }

  // Wait for Wicket AJAX to fully settle — networkidle ensures no pending requests
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);

  // "mehr laden" appends rows to the same page — click until gone, then extract all at once
  const loadMoreBtn = page.locator('button.ia-m-searchresults__btn-load').first();
  let pageNum = 1;
  while (pageNum <= 50) {
    const visible = await loadMoreBtn.isVisible().catch(() => false);
    if (!visible) break;
    const beforeCount = await page.$$eval('tr.ia-e-table__row', rows => rows.length);
    await loadMoreBtn.evaluate(el => el.click());
    // Wait for backdrop to clear, then for new rows to appear
    await page.locator('.ia-e-backdrop').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => null);
    await page.waitForFunction(
      n => document.querySelectorAll('tr.ia-e-table__row').length > n,
      beforeCount,
      { timeout: 15000 }
    ).catch(() => null);
    pageNum++;
  }

  const rows = await extractRows(page);
  for (const row of rows) {
    found.push({
      title:         row.title,
      url:           `${OFFER_BASE_URL}${row.id}`,
      company:       row.company,
      modality:      row.modality,
      city:          row.city,
      publishedDate: row.publishedDate,
      deadline:      row.deadline,
    });
  }

  return found;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  mkdirSync('data', { recursive: true });

  const seen = loadSeen();
  const date = new Date().toISOString().slice(0, 10);

  const lastScanDate = NO_DATE_FILTER ? null : loadLastScanDate();
  if (NO_DATE_FILTER) {
    console.log(`  --all: date filter disabled — fetching all available offers`);
  } else if (lastScanDate) {
    console.log(`  Last Interamt scan: ${lastScanDate.toISOString().slice(0,10)} — skipping older offers`);
  }

  let totalFound = 0;
  let filteredTitle = 0;
  let filteredLocation = 0;
  let filteredDate = 0;
  let dupes = 0;
  const newOffers = [];
  const errors = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();

  try {
    for (let i = 0; i < keywords.length; i++) {
      const kw = keywords[i];
      process.stdout.write(`  Searching "${kw}"... `);
      try {
        const found = await searchInteramt(page, kw, i === 0);
        totalFound += found.length;
        process.stdout.write(`${found.length} found\n`);

        for (const offer of found) {
          if (!matchesTitle(offer.title)) { filteredTitle++; continue; }
          const loc = `${offer.modality || ''} ${offer.city || ''}`.trim();
          if (!matchesLocation(loc)) { filteredLocation++; continue; }
          if (lastScanDate) {
            const pub = parseDE(offer.publishedDate);
            if (pub && pub <= lastScanDate) { filteredDate++; continue; }
          }
          if (seen.has(offer.url)) { dupes++; continue; }
          seen.add(offer.url);
          newOffers.push(offer);
        }
      } catch (err) {
        process.stdout.write(`ERROR\n`);
        errors.push({ keyword: kw, error: err.message });
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!DRY_RUN && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // Summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Interamt Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Keywords searched:  ${keywords.length}`);
  console.log(`Total found:        ${totalFound}`);
  console.log(`Filtered by title:  ${filteredTitle}`);
  console.log(`Filtered location:  ${filteredLocation}`);
  console.log(`Filtered by date:   ${filteredDate}`);
  console.log(`Duplicates:         ${dupes}`);
  console.log(`New offers:         ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ "${e.keyword}": ${e.error}`);
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${[o.city, o.modality].filter(Boolean).join(' ') || 'N/A'}`);
    }
    if (DRY_RUN) {
      console.log('\n(dry run — not saved)');
    } else {
      console.log(`\nSaved to ${PIPELINE_PATH}`);
    }
  }

  console.log('\n→ Run /career-ops pipeline to evaluate new offers.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
