// tests/local-time-stamps.test.mjs — writers that stamp a record with the
// UTC clock now use the local one.
//
//   agent-inbox.mjs        `- [ ] <stamp> — <request>`: the stamp was
//                          toISOString().slice(0, 16), i.e. UTC date AND time
//                          with no zone marker. At UTC+14 a request queued at
//                          10:30 on the 18th was recorded as "2026-08-17 20:30".
//   plugins/apify          the `scraped:` date in a saved JD's frontmatter was
//                          the UTC day, one day behind for the first hours of a
//                          local morning east of Greenwich.
//   generate-pdf.mjs       the date column of data/pdf-index.tsv.
//   fix-slugs.mjs          the `(slug migrated … <date>, verify-portals)` note
//                          it writes into portals.yml.
//   company-funded.mjs     generated_at, which also names the report files, and
//                          the date of an item with none of its own. It read
//                          the current year from the UTC clock as well, so an
//                          item naming the local year was dated in the future
//                          and dropped for the first hours of a new year.
//   discover-new-companies.mjs  the date in the banner of its YAML.
//
// Every other "today" in the repo already goes through lib/local-today.mjs
// (#2765, #2932, #3070, #3301, #3990). These were missed because they stamp
// rather than gate.
//
// PINNED INSTANT in a zone far from UTC: Pacific/Kiritimati is UTC+14, so
// 20:30Z on the 17th is 10:30 on the 18th there, and no two readings of the
// clock can agree by accident.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TZ = 'Pacific/Kiritimati';
const INSTANT = '2026-08-17T20:30:00Z';
const LOCAL_DAY = '2026-08-18';
const LOCAL_STAMP = '2026-08-18 10:30';
const UTC_DAY = '2026-08-17';

// Replace Date so `new Date()` and Date.now() return INSTANT; dated
// constructions are untouched.
const FREEZE = `
const RealDate = Date;
const FROZEN = new RealDate('${INSTANT}').getTime();
globalThis.Date = class extends RealDate {
  constructor(...a) { if (a.length === 0) super(FROZEN); else super(...a); }
  static now() { return FROZEN; }
};
`;

test('premise: at this instant the UTC day and the local day differ in Kiritimati', () => {
  const day = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(INSTANT));
  assert.equal(day('UTC'), UTC_DAY);
  assert.equal(day(TZ), LOCAL_DAY);
});

test('agent-inbox add stamps the local date and time, not UTC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-stamp-'));
  try {
    const preload = join(dir, 'freeze.mjs');
    writeFileSync(preload, FREEZE);
    const inbox = join(dir, 'agent-inbox.md');
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'agent-inbox.mjs'), 'add', 'evaluate https://acme.example/jobs/42'], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, TZ, CAREER_OPS_INBOX: inbox },
    });
    assert.equal(r.status, 0, r.stderr);
    const line = readFileSync(inbox, 'utf-8').split('\n').find((l) => l.startsWith('- [ ]'));
    assert.ok(line, 'no queued item was written');
    assert.ok(line.startsWith(`- [ ] ${LOCAL_STAMP} — `), `stamp was not the local time: ${line}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('apify JD frontmatter dates the capture with the local day, not UTC', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'apify-stamp-'));
  const RealDate = Date;
  const realFetch = globalThis.fetch;
  const realTz = process.env.TZ;
  try {
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith('/acts/owner~actor/runs')) return json({ data: { id: 'run-1' } });
      if (u.endsWith('/actor-runs/run-1')) return json({ data: { status: 'SUCCEEDED' } });
      if (u.endsWith('/actor-runs/run-1/dataset/items')) {
        return json([{ title: 'Data Engineer', url: 'https://jobs.example.test/1', company: 'Acme', description: 'Build and run the data platform. '.repeat(4) }]);
      }
      throw new Error(`unexpected request in test: ${u}`);
    };
    const { default: apify } = await import('../plugins/apify/index.mjs');
    process.env.TZ = TZ;
    const frozen = new RealDate(INSTANT).getTime();
    globalThis.Date = class extends RealDate {
      constructor(...a) { if (a.length === 0) super(frozen); else super(...a); }
      static now() { return frozen; }
    };
    const entry = { name: 'fixture', actor: 'owner/actor', field_map: { title: 'title', url: 'url', company: 'company', description: 'description' } };
    await apify.provider.fetch(entry, { env: { APIFY_TOKEN: 'test-token' }, dataRoot: dir });
    globalThis.Date = RealDate;

    const jds = join(dir, 'jds');
    assert.ok(existsSync(jds), 'no JD capture was written');
    const [file] = readdirSync(jds);
    const front = readFileSync(join(jds, file), 'utf-8').split('---')[1];
    assert.match(front, new RegExp(`scraped: '?${LOCAL_DAY}'?`), `scraped was not the local day:\n${front}`);
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = realFetch;
    if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Runs a module in a child pinned to TZ and to `instant`; `source` is written next to it. */
function runPinned(dir, { source, script, args = [], env = {}, instant = INSTANT }) {
  const preload = join(dir, 'freeze.mjs');
  writeFileSync(preload, FREEZE.replace(INSTANT, instant));
  if (source) writeFileSync(script = join(dir, 'run.mjs'), source);
  return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, script, ...args], {
    cwd: dir, encoding: 'utf-8', timeout: 60000,
    env: { ...process.env, TZ, ...env },
  });
}
const href = (file) => JSON.stringify(pathToFileURL(join(ROOT, file)).href);

test('generate-pdf dates its PDF index row with the local day, not UTC', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'pdf-index-stamp-')));
  try {
    mkdirSync(join(dir, 'output'));
    const manifest = join(dir, 'pdf-index.tsv');
    // The browser is a test double, as in generate-pdf-manifest-concurrency.test.mjs.
    const r = runPinned(dir, {
      source: `
const { renderHtmlToPdf } = await import(${href('generate-pdf.mjs')});
const pdf = Buffer.from('%PDF-1.7\\n1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n'
  + '2 0 obj\\n<< /Type /Pages /Count 1 >>\\nendobj\\n%%EOF');
const launchBrowser = async () => ({
  async newPage() { return { async goto() {}, async evaluate() {}, async pdf() { return pdf; } }; },
  async close() {},
});
await renderHtmlToPdf('<!doctype html><html><body>cv</body></html>', ${JSON.stringify(join(dir, 'output', 'cv.pdf'))}, {
  reportNum: '7', workspaceRoot: ${JSON.stringify(dir)}, styleTokens: {}, launchBrowser, kind: 'cv',
});
`,
      env: { CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_TRACKER: '', CAREER_OPS_PDF_INDEX: manifest },
    });
    assert.equal(r.status, 0, r.stderr);
    const row = readFileSync(manifest, 'utf-8').split('\n').find((l) => l.startsWith('7\t'));
    assert.ok(row, 'no manifest row was written');
    assert.equal(row.split('\t')[4], LOCAL_DAY, `the row was not dated with the local day: ${row}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fix-slugs dates the note it writes into portals.yml with the local day, not UTC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fix-slugs-stamp-'));
  try {
    const r = runPinned(dir, {
      source: `
const { computeFixes } = await import(${href('fix-slugs.mjs')});
const text = ['tracked_companies:', '  - name: Foo Bar', '    careers_url: https://job-boards.greenhouse.io/foobar', ''].join('\\n');
const results = [{ name: 'Foo Bar', status: 'missing', ats: 'greenhouse', suggested: { ats: 'lever', slug: 'foobar' } }];
process.stdout.write(computeFixes(text, results).text);
`,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`(slug migrated greenhouse->lever ${LOCAL_DAY}, verify-portals)`), r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const FUNDED = (title) => `
const { discoverFundedCompanies } = await import(${href('company-funded.mjs')});
const item = { source: 'hacker_news', title: ${JSON.stringify(title)}, url: 'https://news.ycombinator.com/item?id=77',
  observedDate: null, text: 'Acme raises funding.', categories: [] };
const result = await discoverFundedCompanies({ discoveryItems: [item], months: 3 });
process.stdout.write(JSON.stringify({ generated_at: result.generated_at, company: result.companies[0]?.company ?? null,
  observed: result.companies[0]?.funding.sources[0]?.observed_date ?? null }));
`;

test('company-funded dates its run, and an item with no date, with the local day', () => {
  const dir = mkdtempSync(join(tmpdir(), 'funded-stamp-'));
  try {
    const r = runPinned(dir, { source: FUNDED('Acme raises $25M Series A') });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { generated_at: LOCAL_DAY, company: 'Acme', observed: LOCAL_DAY });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('company-funded keeps an item naming the local year once the UTC year is behind it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'funded-year-'));
  try {
    // 20:30Z on 31 December is 10:30 on 1 January in Kiritimati.
    const r = runPinned(dir, { source: FUNDED('Acme raises $25M Series A in 2027'), instant: '2026-12-31T20:30:00Z' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { generated_at: '2027-01-01', company: 'Acme', observed: '2027' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('discover-new-companies dates its YAML banner with the local day, not UTC', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discover-stamp-'));
  try {
    const hist = join(dir, 'scan-history.tsv');
    const rows = [1, 2].map((n) => [`https://boards.greenhouse.io/acme/jobs/${n}`, UTC_DAY, 'greenhouse', 'Engineer', 'Acme', 'skipped', 'Remote'].join('\t'));
    writeFileSync(hist, `url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n${rows.join('\n')}\n`);
    writeFileSync(join(dir, 'portals.yml'), '{}\n');
    const r = runPinned(dir, {
      script: join(ROOT, 'discover-new-companies.mjs'),
      env: { CAREER_OPS_SCAN_HISTORY: hist, CAREER_OPS_PORTALS: join(dir, 'portals.yml'), CAREER_OPS_BLACKLIST: join(dir, 'blacklist.md') },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.startsWith(`# Generated by discover-new-companies.mjs — ${LOCAL_DAY}\n`), r.stdout);
    assert.match(r.stdout, /name: Acme/, 'the run must emit the company, or the banner proves nothing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
