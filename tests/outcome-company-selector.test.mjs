// tests/outcome-company-selector.test.mjs — outcome.mjs records an outcome only
// on a row whose company the selector actually names.
//
// After the exact company tier, outcome.mjs fell back to a raw substring
// test in both directions. normalizeCompany('?') is '' (the #1596 blind-
// employer convention), and `key.includes('')` is true, so every blind `?`
// row matched every selector: `node outcome.mjs "Acme Corp" rejected` for an
// application that was never tracked flipped an unrelated agency row from
// Applied to Rejected, appended to its Notes, and created its outcome
// journal. The same tier selected "Metabase" for "Meta". set-status.mjs
// could not catch it, because outcome.mjs passes it the chosen row's own
// number and role.
//
// The fallback is now the corporate-form rule dedup-tracker and merge-tracker
// use, an empty selector key is refused as set-status refuses it, and a near
// miss is offered in the error rather than selected.
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const TRACKER = [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-01-01 | ? | Platform Engineer | 4.0/5 | Applied | ❌ | — | via Hays |',
  '| 2 | 2026-01-02 | Metabase | Data Engineer | 4.2/5 | Applied | ❌ | — |  |',
  '| 3 | 2026-01-03 | Acme Inc. | Backend Engineer | 4.1/5 | Applied | ❌ | — |  |',
  '',
].join('\n');

/** Run outcome.mjs on a fresh copy of TRACKER; report what it changed. */
function outcome(...args) {
  const root = mkdtempSync(join(tmpdir(), 'outcome-selector-test-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    const tracker = join(root, 'data', 'applications.md');
    writeFileSync(tracker, TRACKER);
    const r = spawnSync(process.execPath, [join(ROOT, 'outcome.mjs'), ...args, '--json'], {
      cwd: root,
      encoding: 'utf-8',
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, CAREER_OPS_DATA_DIR: '' },
    });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* asserted by the caller */ }
    return {
      status: r.status,
      json,
      stderr: r.stderr,
      trackerChanged: readFileSync(tracker, 'utf-8') !== TRACKER,
      journalWritten: existsSync(join(root, 'data', 'outcomes')),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('\noutcome.mjs — a company selector selects only the company it names');

ok('a company that was never tracked does not land on a blind `?` row', () => {
  // THE BUG: this recorded "rejected" on row #1.
  const r = outcome('Acme Corp', 'rejected');
  assert.strictEqual(r.status, 2, `expected not-found (2), got ${r.status}: ${JSON.stringify(r.json)} ${r.stderr}`);
  assert.strictEqual(r.json?.code, 'company-not-found');
  assert.strictEqual(r.trackerChanged, false, 'the tracker was written');
  assert.strictEqual(r.journalWritten, false, 'an outcome journal was created');
});

ok('a name that is only a substring of another company is offered, not selected', () => {
  const r = outcome('Meta', 'rejected');
  assert.strictEqual(r.status, 2, `expected not-found (2), got ${r.status}`);
  assert.match(r.json?.error ?? '', /did you mean #2 Metabase\?/);
  assert.strictEqual(r.trackerChanged, false, 'Metabase was written for "Meta"');
});

ok('a selector that normalizes to nothing is refused before any row is chosen', () => {
  const r = outcome('?', 'rejected');
  assert.strictEqual(r.status, 1, `expected usage (1), got ${r.status}`);
  assert.strictEqual(r.json?.code, 'empty-selector');
  assert.strictEqual(r.trackerChanged, false);
});

ok('the same employer under another corporate form is still found', () => {
  // The convenience the substring tier gave and the corporate-form rule keeps.
  const r = outcome('Acme', 'rejected', '--dry-run');
  assert.strictEqual(r.status, 0, `${JSON.stringify(r.json)} ${r.stderr}`);
  assert.match(r.json?.outcomeDir ?? '', /3_acme-inc_backend-engineer$/);
});

ok('an exact company and a row number still select their row', () => {
  const byName = outcome('Metabase', 'rejected', '--dry-run');
  assert.match(byName.json?.outcomeDir ?? '', /2_metabase_data-engineer$/, JSON.stringify(byName.json));
  const byNum = outcome('1', 'rejected', '--dry-run');
  assert.match(byNum.json?.outcomeDir ?? '', /1_unknown_platform-engineer$/, JSON.stringify(byNum.json));
});
