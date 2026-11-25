// A title match must not turn a rejection into Evaluated or delete that row.
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const DEDUP = join(ROOT, 'dedup-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';
const URL = 'https://boards.greenhouse.io/fixtureco/jobs/4401';

function run(rows) {
  const dir = mkdtempSync(join(tmpdir(), 'dedup-rejection-'));
  const tracker = join(dir, 'applications.md');
  try {
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    const childEnv = { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ROOT: dir };
    delete childEnv.CAREER_OPS_DATA_DIR;
    const r = spawnSync(process.execPath, [DEDUP], { encoding: 'utf-8', env: childEnv });
    assert.strictEqual(r.status, 0, `dedup exited ${r.status}: ${r.stderr}`);
    return readFileSync(tracker, 'utf-8').split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const statusOf = (line) => line.split('|')[6].trim();
const scoreOf = (line) => line.split('|')[5].trim();
const numOf = (line) => line.split('|')[1].trim();

console.log('\ndedup-tracker — a rejection survives a title match');

ok('a higher-scored rejection is not rewritten to Evaluated', () => {
  const rows = run([
    `| 1 | 2026-06-01 | Fixture Co | Engineer | 4.9/5 | Rejected | ❌ | [1](reports/1-fixture.md) | they said no | ${URL} |`,
    `| 2 | 2026-06-02 | Fixture Co | Engineer | 3.1/5 | Evaluated | ❌ | [2](reports/2-fixture.md) | fresh look | ${URL} |`,
  ]);
  assert.strictEqual(rows.length, 2, `both rows stay, got ${rows.length}`);
  const rejected = rows.find(r => numOf(r) === '1');
  assert.ok(rejected, 'the rejected row is still there');
  assert.strictEqual(statusOf(rejected), 'Rejected');
  assert.strictEqual(scoreOf(rejected), '4.9/5');
  assert.match(rejected, /they said no/);
});

ok('a lower-scored rejection is not deleted', () => {
  const rows = run([
    `| 1 | 2026-06-01 | Fixture Co | Engineer | 4.9/5 | Evaluated | ❌ | [1](reports/1-fixture.md) | fresh look | ${URL} |`,
    `| 2 | 2026-06-02 | Fixture Co | Engineer | 3.1/5 | Rejected | ❌ | [2](reports/2-fixture.md) | they said no | ${URL} |`,
  ]);
  assert.strictEqual(rows.length, 2, `both rows stay, got ${rows.length}`);
  const rejected = rows.find(r => numOf(r) === '2');
  assert.ok(rejected, 'the rejected row is still there');
  assert.strictEqual(statusOf(rejected), 'Rejected');
  assert.match(rejected, /they said no/);
});

ok('the same report still collapses, and Evaluated does not replace Rejected', () => {
  const rows = run([
    `| 1 | 2026-06-01 | Fixture Co | Engineer | 4.9/5 | Rejected | ❌ | [1](reports/1-fixture.md) | they said no | ${URL} |`,
    `| 2 | 2026-06-02 | Fixture Co | Engineer | 3.1/5 | Evaluated | ❌ | [1](reports/1-fixture.md) | duplicate | ${URL} |`,
  ]);
  assert.strictEqual(rows.length, 1, `same report is one row, got ${rows.length}`);
  assert.strictEqual(statusOf(rows[0]), 'Rejected');
  assert.strictEqual(scoreOf(rows[0]), '4.9/5');
});

ok('a higher-scored Evaluated row does not replace a same-report rejection', () => {
  const rows = run([
    `| 1 | 2026-06-01 | Fixture Co | Engineer | 3.1/5 | Rejected | ❌ | [1](reports/1-fixture.md) | they said no | ${URL} |`,
    `| 2 | 2026-06-02 | Fixture Co | Engineer | 4.9/5 | Evaluated | ❌ | [1](reports/1-fixture.md) | duplicate | ${URL} |`,
  ]);
  assert.strictEqual(rows.length, 1, `same report is one row, got ${rows.length}`);
  assert.strictEqual(statusOf(rows[0]), 'Rejected');
  assert.strictEqual(scoreOf(rows[0]), '4.9/5');
  assert.match(rows[0], /they said no/);
});

ok('a different report does not join a cluster that already holds a rejection', () => {
  const rows = run([
    `| 1 | 2026-06-01 | Fixture Co | Engineer | 3.1/5 | Evaluated | ❌ | [1](reports/1-fixture.md) | fresh look | ${URL} |`,
    `| 2 | 2026-06-02 | Fixture Co | Engineer | 3.0/5 | Rejected | ❌ | [1](reports/1-fixture.md) | they said no | ${URL} |`,
    `| 3 | 2026-06-03 | Fixture Co | Engineer | 4.9/5 | Evaluated | ❌ | [3](reports/3-fixture.md) | other opening | ${URL} |`,
  ]);
  assert.strictEqual(rows.length, 2, `the other report stays, got ${rows.length}: ${rows.join(' || ')}`);
  const rejected = rows.find(r => statusOf(r) === 'Rejected');
  assert.ok(rejected, 'the rejection survives');
  assert.match(rejected, /they said no/);
  const other = rows.find(r => numOf(r) === '3');
  assert.ok(other, 'the other report stays');
  assert.strictEqual(statusOf(other), 'Evaluated');
  assert.strictEqual(scoreOf(other), '4.9/5');
});
