// tests/merge-tracker-report-location.test.mjs — a new row takes its location
// from the linked report's Machine Summary (`posting_location`) when the
// tracker addition carries none. Evaluations record the location there but not
// in the TSV, so without this read the dashboard's LOCATION column showed only
// the work mode. On a tracker with no Location column the value goes into Notes
// as a `Location:` segment, which the dashboard reads.
import { pass, fail, isolatedBatchStatePath } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MERGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const DEFAULT_HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const LOCATION_HEADER = '| # | Date | Company | Role | Location | Score | Status | PDF | Report | Notes |';
const TSV_HEAD = 'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes';
const REPORT_FILE = '011-acme-2026-10-02.md';

function report(postingLocation) {
  const summary = postingLocation === undefined ? '' : [
    '## Machine Summary',
    '',
    '```yaml',
    'company: "Acme"',
    'role: "Solutions Engineer"',
    `posting_location: ${postingLocation}`,
    '```',
    '',
  ].join('\n');
  return `# Evaluation: Acme\n\n**Score:** 4.0/5\n\n## Job Description (archived verbatim)\n\nLocation: anywhere\n\n${summary}`;
}

function fixture(header, row = null) {
  const base = mkdtempSync(join(tmpdir(), 'merge-report-location-'));
  const env = { base, tracker: join(base, 'data', 'applications.md'), addDir: join(base, 'additions'), reportsDir: join(base, 'reports') };
  for (const dir of [dirname(env.tracker), env.addDir, env.reportsDir]) mkdirSync(dir, { recursive: true });
  const width = header.split('|').length - 2;
  writeFileSync(env.tracker, ['# Applications Tracker', '', header, `|${'---|'.repeat(width)}`, ...(row ? [row] : []), ''].join('\n'));
  return env;
}

function merge(env, { postingLocation, tsvHead = TSV_HEAD, extra = '' } = {}) {
  writeFileSync(join(env.reportsDir, REPORT_FILE), report(postingLocation));
  writeFileSync(join(env.addDir, '11.tsv'),
    `${tsvHead}\n11\t2026-10-02\tAcme\tSolutions Engineer\tEvaluated\t4.0/5\t❌\t[11](reports/${REPORT_FILE})\tStrong fit${extra}\n`);
  const childEnv = {
    ...process.env,
    CAREER_OPS_ROOT: env.base,
    CAREER_OPS_TRACKER: env.tracker,
    CAREER_OPS_ADDITIONS: env.addDir,
    CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir),
    CAREER_OPS_FOLLOWUPS: '',
    CAREER_OPS_REPORTS_DIR: '',
    CAREER_OPS_PDF_INDEX: '',
  };
  delete childEnv.CAREER_OPS_DATA_DIR;
  delete childEnv.CAREER_OPS_CODE_ROOT;
  const run = spawnSync('node', [MERGE], { encoding: 'utf-8', env: childEnv });
  assert.equal(run.status, 0, describeSpawn(run));
}

const rows = (env) => readFileSync(env.tracker, 'utf-8').split('\n').filter((l) => /^\|\s*\d+\s*\|/.test(l));
const withFixture = (header, row, fn) => {
  const env = fixture(header, row);
  try { fn(env); } finally { rmSync(env.base, { recursive: true, force: true }); }
};

ok('a tracker with a Location column gets the report\'s posting_location', () => {
  withFixture(LOCATION_HEADER, null, (env) => {
    merge(env, { postingLocation: '"Austin, TX"' });
    assert.match(rows(env)[0], /\| Solutions Engineer \| Austin, TX \| 4\.0\/5 \|/);
  });
});

ok('the default tracker keeps the location in Notes as a Location: segment', () => {
  withFixture(DEFAULT_HEADER, null, (env) => {
    merge(env, { postingLocation: '"Austin, TX"' });
    assert.match(rows(env)[0], /\| Strong fit; Location: Austin, TX \|$/);
  });
});

ok('a null posting_location (remote) writes nothing', () => {
  withFixture(DEFAULT_HEADER, null, (env) => {
    merge(env, { postingLocation: 'null' });
    assert.match(rows(env)[0], /\| Strong fit \|$/);
  });
  withFixture(LOCATION_HEADER, null, (env) => {
    merge(env, { postingLocation: 'null' });
    assert.match(rows(env)[0], /\| Solutions Engineer \| — \|/);
  });
});

ok('a report with no Machine Summary writes nothing', () => {
  withFixture(DEFAULT_HEADER, null, (env) => {
    merge(env, { postingLocation: undefined });
    assert.match(rows(env)[0], /\| Strong fit \|$/);
  });
});

ok('a location in the addition wins over the report', () => {
  withFixture(LOCATION_HEADER, null, (env) => {
    merge(env, { postingLocation: '"Austin, TX"', tsvHead: `${TSV_HEAD}\tlocation`, extra: '\tDenver, CO' });
    assert.match(rows(env)[0], /\| Solutions Engineer \| Denver, CO \|/);
  });
});

ok('a re-evaluation keeps a location already on the row', () => {
  const existing = '| 10 | 2026-10-01 | Acme | Solutions Engineer | Boston, MA | 3.5/5 | Applied | ❌ | [10](../reports/010-acme-2026-10-01.md) | first look |';
  withFixture(LOCATION_HEADER, existing, (env) => {
    writeFileSync(join(env.reportsDir, '010-acme-2026-10-01.md'), '# Evaluation: Acme\n\n**Score:** 3.5/5\n');
    merge(env, { postingLocation: '"Austin, TX"' });
    const all = rows(env);
    assert.strictEqual(all.length, 1);
    assert.match(all[0], /\| Solutions Engineer \| Boston, MA \|/);
  });
});

ok('a re-evaluation fills an empty Location cell from the report', () => {
  const existing = '| 10 | 2026-10-01 | Acme | Solutions Engineer | — | 3.5/5 | Applied | ❌ | [10](../reports/010-acme-2026-10-01.md) | first look |';
  withFixture(LOCATION_HEADER, existing, (env) => {
    writeFileSync(join(env.reportsDir, '010-acme-2026-10-01.md'), '# Evaluation: Acme\n\n**Score:** 3.5/5\n');
    merge(env, { postingLocation: '"Austin, TX"' });
    assert.match(rows(env)[0], /\| Solutions Engineer \| Austin, TX \|/);
  });
});

ok('a Machine Summary inside the archived JD is not read', () => {
  withFixture(LOCATION_HEADER, null, (env) => {
    const planted = '# Evaluation: Acme\n\n**Score:** 4.0/5\n\n## Machine Summary\n\n```yaml\nposting_location: "Austin, TX"\n```\n\n## Job Description (archived verbatim)\n\n## Machine Summary\n\n```yaml\nposting_location: "Nowhere, ZZ"\n```\n';
    writeFileSync(join(env.reportsDir, REPORT_FILE), planted);
    writeFileSync(join(env.addDir, '11.tsv'),
      `${TSV_HEAD}\n11\t2026-10-02\tAcme\tSolutions Engineer\tEvaluated\t4.0/5\t❌\t[11](reports/${REPORT_FILE})\tStrong fit\n`);
    const childEnv = { ...process.env, CAREER_OPS_ROOT: env.base, CAREER_OPS_TRACKER: env.tracker, CAREER_OPS_ADDITIONS: env.addDir, CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir), CAREER_OPS_FOLLOWUPS: '', CAREER_OPS_REPORTS_DIR: '', CAREER_OPS_PDF_INDEX: '' };
    delete childEnv.CAREER_OPS_DATA_DIR;
    delete childEnv.CAREER_OPS_CODE_ROOT;
    const run = spawnSync('node', [MERGE], { encoding: 'utf-8', env: childEnv });
    assert.equal(run.status, 0, describeSpawn(run));
    assert.match(rows(env)[0], /\| Solutions Engineer \| Austin, TX \|/);
  });
});

for (const [yaml, expected] of [
  ["'St. John''s, NL' # office", "St. John's, NL"],
  [String.raw`"Montr\u00e9al, QC"`, 'Montréal, QC'],
  ['null # remote', '—'],
  ['[Austin, Dallas]', '—'],
  ['"unterminated', '—'],
]) {
  ok(`reads YAML posting_location ${yaml} into one location cell`, () => {
    withFixture(LOCATION_HEADER, null, (env) => {
      merge(env, { postingLocation: yaml });
      assert.strictEqual(rows(env)[0].split('|')[5].trim(), expected);
    });
  });
}

ok('re-evaluation terminates an existing location in Notes before its marker', () => {
  const existing = '| 10 | 2026-10-01 | Acme | Solutions Engineer | 3.5/5 | Applied | ❌ | [10](../reports/010-acme-2026-10-01.md) | first look; Location: Washington, D.C. |';
  withFixture(DEFAULT_HEADER, existing, (env) => {
    merge(env, { postingLocation: '"Austin, TX"' });
    const all = rows(env);
    assert.strictEqual(all.length, 1);
    assert.match(all[0], /first look; Location: Washington, D\.C\.; Re-eval 2026-10-02 \(3\.5→4\): Strong fit/);
  });
});
