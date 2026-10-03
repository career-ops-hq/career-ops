// merge-tracker: a TSV row whose report link points at a missing file is still
// merged (never lose an application record), but the merge says so (#4748).
// Child-process CLI tests against disposable data roots; fictional data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HEADER = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|', '',
].join('\n');

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-missing-report-'));
  mkdirSync(join(root, 'data'), { recursive: true });
  mkdirSync(join(root, 'reports'), { recursive: true });
  mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
  writeFileSync(join(root, 'data', 'applications.md'), HEADER);
  return root;
}
function addTsv(root, report) {
  writeFileSync(
    join(root, 'batch', 'tracker-additions', '001-acme-widgets.tsv'),
    `num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\n1\t2026-07-15\tAcme Widgets\tCoordinator\tApplied\t3.2/5\t❌\t${report}\tsynthetic\n`,
  );
}
function run(root, args = [], envExtra = { CAREER_OPS_ROOT: root }) {
  const env = { ...process.env, ...envExtra };
  for (const k of ['CAREER_OPS_DATA_DIR', 'CAREER_OPS_TRACKER', 'CAREER_OPS_ADDITIONS', 'CAREER_OPS_BATCH_STATE']) delete env[k];
  if (!('CAREER_OPS_ROOT' in envExtra)) delete env.CAREER_OPS_ROOT;
  const r = spawnSync(process.execPath, [join(CODE_ROOT, 'merge-tracker.mjs'), ...args], { cwd: CODE_ROOT, env, encoding: 'utf-8', timeout: 30_000 });
  assert.equal(r.error, undefined);
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const tracker = (root) => readFileSync(join(root, 'data', 'applications.md'), 'utf-8');
const withRoot = (fn) => () => { const root = makeRoot(); try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };
const WARN = /report link "[^"]*" does not resolve/;

test('missing report: row is merged unchanged and a warning names it', withRoot((root) => {
  addTsv(root, '[1](reports/001-acme-widgets-2026-07-15.md)');
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, WARN);
  assert.match(r.out, /Acme Widgets/);
  assert.match(r.out, /001-acme-widgets-2026-07-15\.md/);
  assert.match(r.out, /1 row\(s\) link to a report that is not on disk/);
  assert.match(tracker(root), /Acme Widgets.*\[1\]\(\.\.\/reports\/001-acme-widgets-2026-07-15\.md\)/, 'row kept with its link, not rewritten');
}));

test('present report under an external data root (cwd = code root): no warning', withRoot((root) => {
  writeFileSync(join(root, 'reports', '001-acme-widgets-2026-07-15.md'), '# Eval\n**URL:** N/A\n');
  addTsv(root, '[1](reports/001-acme-widgets-2026-07-15.md)');
  const r = run(root);
  assert.equal(r.status, 0, r.out);
  assert.doesNotMatch(r.out, WARN);
  assert.doesNotMatch(r.out, /not on disk/);
}));

test('no-report sentinels do not warn', withRoot((root) => {
  for (const cell of ['—', 'N/A', '-']) {
    addTsv(root, cell);
    const r = run(root);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, WARN, `sentinel ${cell}`);
    assert.doesNotMatch(r.out, /not on disk/, `sentinel ${cell}`);
  }
}));

test('--dry-run reports the warning and writes nothing', withRoot((root) => {
  addTsv(root, '[1](reports/001-acme-widgets-2026-07-15.md)');
  const before = tracker(root);
  const r = run(root, ['--dry-run']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, WARN);
  assert.equal(tracker(root), before, 'tracker untouched');
  assert.ok(existsSync(join(root, 'batch', 'tracker-additions', '001-acme-widgets.tsv')), 'TSV not archived');
}));
