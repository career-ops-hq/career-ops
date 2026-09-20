// tests/verify-portals-rejected-alternate.test.mjs — a live alternate board that
// the identity gate refuses must be REPORTED, not silently dropped (#4230).
//
// Before this, `discoverAlternates` discarded an unconfirmed candidate with a bare
// `continue`, so a company whose slug had migrated to another ATS looked exactly
// like one whose board was simply dead. The gate itself stays strict: nothing here
// is ever adopted, and `fix-slugs` still refuses to write it.
//
// Driven through `verifyCompanies`, the exported seam that accepts an injected
// fetchJson/fetchText — the same seam tests/verify-portals-job-boards.test.mjs uses.
// Ashby's owner check reads HTML (`ownerKind: 'html'`), so the fixture supplies a
// title, not JSON.
//
// Run:  node --test tests/verify-portals-rejected-alternate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { verifyCompanies, printResults } = await import(pathToFileURL(join(ROOT, 'verify-portals.mjs')).href);

/**
 * Exact hostname of a URL, for fixture routing.
 *
 * ``url.includes('host')`` matches anywhere in the string, so a crafted link could
 * satisfy it from the path or a subdomain and silently take the wrong branch.
 * CodeQL flags the pattern as incomplete URL substring sanitization; parsing the
 * host is both correct and what the lint asks for.
 */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

const GH_BOARD = 'https://job-boards.greenhouse.io/temporal';
const COMPANY = 'Temporal';
const ALT_SLUG = 'temporal';

const entry = () => ({ name: COMPANY, enabled: true, api: GH_BOARD });
const notFound = () => Object.assign(new Error('404'), { status: 404 });

/**
 * The probe pair. The configured Greenhouse slug 404s; an Ashby board answers at
 * the same slug, and its board page title is what decides identity.
 *
 * @param {{ boardTitle?: string, jobs?: any[] }} opts
 */
function fetchers({ boardTitle = 'Temporal Technologies', jobs = [{ id: 1, title: 'Engineer' }] } = {}) {
  const fetchJson = async (url) => {
    if (hostOf(url) === 'job-boards.greenhouse.io') throw notFound();
    if (url.includes('posting-api/job-board')) return { jobs };
    throw notFound();
  };
  // Ashby's owner endpoint is `https://jobs.ashbyhq.com/<slug>`, read as HTML.
  const fetchText = async (url) => (hostOf(url) === 'jobs.ashbyhq.com' ? `<title>${boardTitle}</title>` : '');
  return { fetchJson, fetchText };
}

/** Nothing answers anywhere. */
const deadFetchers = () => ({
  fetchJson: async () => { throw notFound(); },
  fetchText: async () => '',
});

const rowFor = (rows) => rows.find((r) => r.name === COMPANY);

/** Run the real printer and return what it wrote, so assertions are on output. */
function capturePrintResults(rows) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    printResults(rows);
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}


test('a live alternate the gate refuses is reported with its reason', async () => {
  const rows = await verifyCompanies([entry()], fetchers());
  const row = rowFor(rows);
  assert.ok(row, 'the entry must still produce a row');
  assert.equal(row.status, 'missing', 'a refused board is never live');

  const rejected = row.suggested?.rejectedAlternate;
  assert.ok(rejected, 'the refused live alternate must be reported');
  assert.equal(rejected.ats, 'ashby');
  assert.equal(rejected.slug, ALT_SLUG);
  assert.equal(rejected.ownerBoardName, 'Temporal Technologies');
  assert.ok(rejected.ownerReason, 'the refusal must carry a reason');
});

test('the refused alternate carries no adoptable target', async () => {
  // This is the half that protects the write path: `fix-slugs` keys off
  // `r.suggested`, so a rejected-only result must not look writable.
  const rows = await verifyCompanies([entry()], fetchers());
  const suggested = rowFor(rows).suggested;
  assert.ok(suggested, 'the suggestion object still exists so the refusal can ride on it');
  assert.equal(suggested.ats, undefined, 'no ATS may be adopted from a refused board');
  assert.equal(suggested.slug, undefined, 'no slug may be adopted from a refused board');
});

test('a genuinely dead slug reports no refusal', async () => {
  const rows = await verifyCompanies([entry()], deadFetchers());
  const row = rowFor(rows);
  assert.equal(row.status, 'missing');
  assert.equal(row.suggested?.rejectedAlternate, undefined);
});

test('an empty unconfirmed board is not reported as a refusal', async () => {
  // A live-but-empty board with an unconfirmed owner says nothing actionable, so it
  // must not be surfaced as though the company had a board elsewhere.
  const rows = await verifyCompanies([entry()], fetchers({ boardTitle: 'Somebody Else Ltd', jobs: [] }));
  assert.equal(rowFor(rows).suggested?.rejectedAlternate, undefined);
});

test('a confirmed live alternate is still suggested and adoptable', async () => {
  // The reporting addition must not disturb the adopting path.
  // The board title matches the configured name, so the gate passes.
  const title = COMPANY;
  const fetchJson = async (url) => {
    if (hostOf(url) === 'job-boards.greenhouse.io') throw notFound();
    if (url.includes('posting-api/job-board')) return { jobs: [{ id: 1, title: 'Eng' }] };
    throw notFound();
  };
  const fetchText = async (url) => (hostOf(url) === 'jobs.ashbyhq.com' ? `<title>${title}</title>` : '');

  const rows = await verifyCompanies([entry()], { fetchJson, fetchText });
  const suggested = rowFor(rows).suggested;
  assert.equal(suggested?.ats, 'ashby', 'an owner-matched board is still adoptable');
  assert.equal(suggested?.slug, ALT_SLUG);
  // No refusal rides along when a board was confirmed.
  assert.equal(suggested?.rejectedAlternate, undefined);
});

test('a rejected-only result does not print undefined/undefined', async () => {
  // The steward review caught this: the "try" line gated on `r.suggested` being
  // truthy, and a rejected-only result satisfies that while carrying no
  // top-level ats/slug. The operator saw `try undefined/undefined`.
  const fetchJson = async (url) => {
    if (hostOf(url) === 'job-boards.greenhouse.io') throw notFound();
    if (url.includes('posting-api/job-board')) return { jobs: [{ id: 1, title: 'Eng' }] };
    throw notFound();
  };
  const fetchText = async (url) => (hostOf(url) === 'jobs.ashbyhq.com' ? '<title>Somebody Else Ltd</title>' : '');

  const rows = await verifyCompanies([entry()], { fetchJson, fetchText });
  const printed = capturePrintResults(rows);
  assert.ok(!printed.includes('undefined'), `printed an undefined: ${printed}`);
  assert.ok(printed.includes('Somebody Else Ltd'), 'the observed owner is reported');
  assert.ok(printed.includes('owner-mismatch'), 'the refusal reason is reported separately');
});

test('an adoptable suggestion still prints its try line', async () => {
  // The guard above must not silence the line it was protecting.
  const fetchJson = async (url) => {
    if (hostOf(url) === 'job-boards.greenhouse.io') throw notFound();
    if (url.includes('posting-api/job-board')) return { jobs: [{ id: 1, title: 'Eng' }] };
    throw notFound();
  };
  const fetchText = async (url) => (hostOf(url) === 'jobs.ashbyhq.com' ? `<title>${COMPANY}</title>` : '');

  const rows = await verifyCompanies([entry()], { fetchJson, fetchText });
  const printed = capturePrintResults(rows);
  assert.ok(printed.includes(`try ashby/${ALT_SLUG}`), `missing try line: ${printed}`);
  assert.ok(!printed.includes('undefined'), `printed an undefined: ${printed}`);
});

test('a control character in a remote board title does not reach the terminal', async () => {
  // The owner name comes from a remote page's <title>, so a hostile board can
  // put ANSI escapes in our output and rewrite prior lines.
  const hostile = 'Ev\u001b[31mil\u001b[0m Corp';
  const fetchJson = async (url) => {
    if (hostOf(url) === 'job-boards.greenhouse.io') throw notFound();
    if (url.includes('posting-api/job-board')) return { jobs: [{ id: 1, title: 'Eng' }] };
    throw notFound();
  };
  const fetchText = async (url) => (hostOf(url) === 'jobs.ashbyhq.com' ? `<title>${hostile}</title>` : '');

  const rows = await verifyCompanies([entry()], { fetchJson, fetchText });
  const printed = capturePrintResults(rows);
  assert.ok(!printed.includes('\u001b'), 'an escape sequence reached the terminal');
  assert.ok(printed.includes('Ev[31mil[0m Corp'), 'the visible text survives');
});
