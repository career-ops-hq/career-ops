// tests/scan-workday-placeholder-title-filter.test.mjs — Workday answers a
// multi-location posting with a count ("3 Locations") and the real places need
// one detail GET per posting (#3860). That enrichment ran before scan.mjs's
// title_filter, so every placeholder posting on a tenant cost a request on every
// scan, including the ones the title filter then threw away. scan.mjs now
// passes its title decision to the provider as ctx.titleWanted.
//
// Drives the real scan.mjs (--dry-run) against a scratch data root, with
// globalThis.fetch replaced by an --import preload that serves a fake tenant and
// logs each request.
//
// Run: node --test tests/scan-workday-placeholder-title-filter.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CXS = 'https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/acmecareers';

const PAGE = {
  total: 3,
  jobPostings: [
    { title: 'Platform Engineer', externalPath: '/job/USA---Austin-TX/Platform-Engineer_R1', locationsText: '3 Locations', postedOn: 'Posted Today' },
    { title: 'Staff Accountant', externalPath: '/job/USA---Austin-TX/Staff-Accountant_R2', locationsText: '2 Locations', postedOn: 'Posted Today' },
    { title: 'Payroll Specialist', externalPath: '/job/USA---Austin-TX/Payroll-Specialist_R3', locationsText: '4 Locations', postedOn: 'Posted Today' },
  ],
};
const DETAIL = { jobPostingInfo: { location: 'USA - Austin, TX', additionalLocations: ['USA - Remote'], startDate: '2026-10-15' } };

// Values come from the environment, never spliced into this source.
const PRELOAD = [
  "import { appendFileSync } from 'node:fs';",
  'const log = process.env.FAKE_WD_LOG;',
  'const cxs = process.env.FAKE_WD_CXS;',
  'const page = process.env.FAKE_WD_PAGE;',
  'const detail = process.env.FAKE_WD_DETAIL;',
  'globalThis.fetch = async (input, init = {}) => {',
  '  const url = String(input?.url ?? input);',
  "  appendFileSync(log, `${(init.method || 'GET').toUpperCase()} ${url}\\n`);",
  "  const json = (body) => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });",
  "  if (url === `${cxs}/jobs`) return json(page);",
  "  if (url.startsWith(`${cxs}/job/`)) return json(detail);",
  "  return new Response('not found', { status: 404 });",
  '};',
].join('\n');

function runScan(portalsYml) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-wd-title-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, portalsYml);
    const preload = join(dir, 'fake-workday.mjs');
    writeFileSync(preload, PRELOAD);
    const log = join(dir, 'requests.log');
    const env = { ...process.env };
    for (const name of ['CAREER_OPS_PORTALS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_PIPELINE', 'CAREER_OPS_SCAN_HISTORY', 'CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR']) delete env[name];
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(ROOT, 'scan.mjs'), '--dry-run'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 60_000,
      env: {
        ...env,
        CAREER_OPS_ROOT: dir,
        CAREER_OPS_PORTALS: portals,
        FAKE_WD_LOG: log,
        FAKE_WD_CXS: CXS,
        FAKE_WD_PAGE: JSON.stringify(PAGE),
        FAKE_WD_DETAIL: JSON.stringify(DETAIL),
      },
    });
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const requests = existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n').filter(Boolean) : [];
    return { out, status: run.status, details: requests.filter((r) => r.startsWith('GET ') && r.includes(`${CXS}/job/`)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const company = `tracked_companies:
  - name: Acme
    careers_url: https://acme.wd5.myworkdayjobs.com/acmecareers
`;

test('placeholders whose title the scan will drop get no detail request', () => {
  const { out, details } = runScan(`title_filter:\n  positive:\n    - "Engineer"\n${company}`);
  assert.deepEqual(details, [`GET ${CXS}/job/USA---Austin-TX/Platform-Engineer_R1`], out);
  assert.match(out, /resolved 1 of 1 multi-location placeholder\(s\).*2 skipped by the title filter/);
});

test('a company whose filter_on leaves out the title still resolves every placeholder', () => {
  const { out, details } = runScan(`title_filter:\n  positive:\n    - "Engineer"\nfield_filters:\n  location:\n    positive: ["Austin"]\n${company}    filter_on: [location]\n`);
  assert.equal(details.length, 3, out);
  assert.match(out, /resolved 3 of 3 multi-location placeholder\(s\)/);
});
