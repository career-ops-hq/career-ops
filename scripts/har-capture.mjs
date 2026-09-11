#!/usr/bin/env node
// har-capture.mjs — one-shot Playwright HAR recorder for browser-gated job boards.
//
// Usage:
//   node scripts/har-capture.mjs <board> [url]
//
// Boards with a baked-in search URL (keywords/location come from portals.yml
// values, hard-coded here to keep this a single dependency-free script):
//   civilservicejobs, findajob, totaljobs, jobsite, indeed, reed
// Or pass any URL explicitly:
//   node scripts/har-capture.mjs custom "https://example.com/jobs?q=python"
//
// Output: data/har/<board>.har — replayed offline by the matching provider.
// Re-run when a board's listing goes stale (they hold a snapshot, not a feed).

import { mkdirSync } from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const KEYWORDS = ['python software engineer', 'machine learning engineer', 'data engineer'];
const LOCATION = 'london';

const BOARDS = {
  civilservicejobs: 'https://www.civilservicejobs.service.gov.uk/csr/index.cgi',
  findajob: 'https://findajob.dwp.gov.uk/search?q=python&location=London',
  totaljobs: `https://www.totaljobs.com/jobs/${encodeURIComponent(KEYWORDS[0])}-jobs-in-${LOCATION}`,
  jobsite: `https://www.jobsite.co.uk/jobs/${encodeURIComponent(KEYWORDS[0])}-jobs-in-${LOCATION}`,
  indeed: `https://uk.indeed.com/jobs?q=${encodeURIComponent(KEYWORDS[0])}&l=${LOCATION}`,
  reed: `https://www.reed.co.uk/jobs/${encodeURIComponent(KEYWORDS[0])}-jobs-in-${LOCATION}`,
};

const board = process.argv[2];
if (!board) {
  console.error('Usage: node scripts/har-capture.mjs <board|custom> [url]\nKnown boards: ' + Object.keys(BOARDS).join(', '));
  process.exit(1);
}

const url = process.argv[3] || BOARDS[board];
if (!url) {
  console.error(`Unknown board "${board}". Pass a URL: node scripts/har-capture.mjs ${board} "https://..."`);
  process.exit(1);
}

const outDir = path.join(getCareerOpsRoot(), 'data', 'har');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${board}.har`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ recordHar: { path: outFile } });
const page = await context.newPage();

console.log(`Capturing ${url} ...`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
// Cloudflare interstitials and result hydration need a beat; job rows
// rendering is the real signal we waited for.
await page.waitForTimeout(8000);

const title = await page.title();
console.log(`Page: ${title}`);
console.log(`HAR written: ${outFile}`);

await context.close();   // closing the context flushes the HAR
await browser.close();
