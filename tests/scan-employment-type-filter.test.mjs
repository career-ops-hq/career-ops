// tests/scan-employment-type-filter.test.mjs — employment_type_filter through
// the real scan.
//
// The unit half pins buildEmploymentTypeFilter(): allow-list, unknown types
// passing by default, include_unknown: false, and a raw label from a local
// parser read the same as a provider's normalized value. The end-to-end half
// runs scan.mjs against a fixture board that feeds the real We Work Remotely
// parser (one full-time, one contract, one part-time and one untyped posting),
// and checks what reached pipeline.md, the summary counter, the
// scan-history.tsv employment_type column, and that a typo in `allow` stops the
// scan before it reads anything. validate-portals.mjs must refuse the same
// shapes, since it calls the same parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { buildEmploymentTypeFilter } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
const { validatePortalsConfig } = await import(pathToFileURL(join(ROOT, 'validate-portals.mjs')).href);
const { parseScanHistoryLine } = await import(pathToFileURL(join(ROOT, 'lib/scan-history-columns.mjs')).href);

// ── buildEmploymentTypeFilter ───────────────────────────────────────
test('no employment_type_filter block passes every job, typed or not', () => {
  const filter = buildEmploymentTypeFilter(undefined);
  for (const t of ['full_time', 'contract', undefined, '', 'Volunteer']) assert.equal(filter(t), true, String(t));
});

test('allow keeps listed types, drops other known types, passes unknown by default', () => {
  const filter = buildEmploymentTypeFilter({ allow: ['contract', 'part_time'] });
  assert.equal(filter('contract'), true);
  assert.equal(filter('part_time'), true);
  assert.equal(filter('full_time'), false);
  assert.equal(filter('internship'), false);
  assert.equal(filter(undefined), true, 'a source with no type is not dropped');
  assert.equal(filter('Volunteer'), true, 'a type the normalizer does not know counts as unknown');
});

test('include_unknown: false drops postings whose type is unknown', () => {
  const filter = buildEmploymentTypeFilter({ allow: ['contract'], include_unknown: false });
  assert.equal(filter('contract'), true);
  assert.equal(filter(undefined), false);
  assert.equal(filter(''), false);
  assert.equal(filter('Other'), false);
});

test('a raw label from a local parser is normalized before the check', () => {
  const filter = buildEmploymentTypeFilter({ allow: ['contract'] });
  assert.equal(filter('Contractor'), true);
  assert.equal(filter('Full-Time'), false);
});

test('a malformed block throws instead of filtering wrongly', () => {
  assert.throws(() => buildEmploymentTypeFilter({ allow: ['contractor'] }), /did you mean "contract"/);
  assert.throws(() => buildEmploymentTypeFilter({ allow: [] }), /non-empty list/);
});

test('validate-portals reports the same shapes scan.mjs refuses, and accepts a valid block', async () => {
  const errorsFor = async (block) => (await validatePortalsConfig({ employment_type_filter: block }))
    .errors.filter(e => e.path === 'employment_type_filter').map(e => e.message);
  assert.deepEqual(await errorsFor({ allow: ['contract', 'part_time'], include_unknown: false }), []);
  for (const bad of [{ allow: ['contractor'] }, { allow: [] }, { allow: ['contract'], include_unknown: 'no' }, ['contract']]) {
    const errors = await errorsFor(bad);
    assert.equal(errors.length, 1, JSON.stringify(bad));
    assert.throws(() => buildEmploymentTypeFilter(bad), (err) => err.message === errors[0], JSON.stringify(bad));
  }
});

// ── End to end ──────────────────────────────────────────────────────
const SCANNER_PATH_VARS = [
  'CAREER_OPS_PORTALS',
  'CAREER_OPS_PROFILE',
  'CAREER_OPS_PIPELINE',
  'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_ROOT',
  'CAREER_OPS_DATA_DIR',
];

function runScan(filterBlock) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-employment-type-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`);
    writeFileSync(join(dir, 'data', 'pipeline.md'), '# Pipeline\n\n');
    writeFileSync(join(dir, 'config', 'profile.yml'), 'location:\n  country: Germany\n');
    const portals = join(dir, 'portals.yml');
    writeFileSync(portals, `title_filter:
  positive:
    - "Engineer"
${filterBlock}tracked_companies:
  - name: Fixture Labs
    careers_url: https://example.invalid/jobs
    parser:
      command: node
      script: tests/fixtures/wwr-employment-type-board.mjs
`);
    const childEnv = { ...process.env };
    for (const name of SCANNER_PATH_VARS) delete childEnv[name];
    const r = spawnSync(process.execPath, [join(ROOT, 'scan.mjs')], {
      cwd: dir,
      env: { ...childEnv, CAREER_OPS_ROOT: dir, CAREER_OPS_PORTALS: portals },
      encoding: 'utf-8',
      timeout: 60_000,
    });
    const pipelinePath = join(dir, 'data', 'pipeline.md');
    const slugs = existsSync(pipelinePath)
      ? readFileSync(pipelinePath, 'utf-8').split('\n')
        .map(l => l.match(/^- \[[ x]\]\s+https:\/\/weworkremotely\.com\/remote-jobs\/fixture-labs-([\w-]+)/)?.[1])
        .filter(Boolean)
        .sort()
      : [];
    const historyPath = join(dir, 'data', 'scan-history.tsv');
    const history = existsSync(historyPath)
      ? Object.fromEntries(readFileSync(historyPath, 'utf-8').split('\n').slice(1).filter(Boolean)
        .map(parseScanHistoryLine)
        .map(row => [row.url.replace(/^.*fixture-labs-/, ''), row.employment_type]))
      : {};
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, slugs, history };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const counter = (stdout) => stdout.match(/Filtered by employment type:\s+(\d+) removed/)?.[1];

test('scan without the block: every posting is added, no counter line, types reach scan-history', () => {
  const { status, stdout, stderr, slugs, history } = runScan('');
  assert.equal(status, 0, stderr);
  assert.deepEqual(slugs, ['contract', 'fulltime', 'parttime', 'untyped']);
  assert.equal(counter(stdout), undefined, 'no employment-type line when the filter is off');
  assert.deepEqual(history, { fulltime: 'full_time', contract: 'contract', parttime: 'part_time', untyped: '' });
});

test('scan with allow [contract, part_time]: full-time dropped and counted, untyped kept', () => {
  const { status, stdout, stderr, slugs } = runScan('employment_type_filter:\n  allow: [contract, part_time]\n');
  assert.equal(status, 0, stderr);
  assert.deepEqual(slugs, ['contract', 'parttime', 'untyped']);
  assert.equal(counter(stdout), '1', stdout);
});

test('scan with include_unknown: false: the untyped posting is dropped too', () => {
  const { status, stdout, stderr, slugs } = runScan('employment_type_filter:\n  allow: [contract, part_time]\n  include_unknown: false\n');
  assert.equal(status, 0, stderr);
  assert.deepEqual(slugs, ['contract', 'parttime']);
  assert.equal(counter(stdout), '2', stdout);
});

test('scan with a typo in allow exits 1 before adding anything', () => {
  const { status, stderr, slugs } = runScan('employment_type_filter:\n  allow: [contractor]\n');
  assert.equal(status, 1);
  assert.match(stderr, /^Error: employment_type_filter\.allow has unknown value\(s\) "contractor" \(did you mean "contract"\?\)/m);
  assert.deepEqual(slugs, []);
});
