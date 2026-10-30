// tests/check-liveness-status-flag.test.mjs — `--status` selects the tracker
// rows it names, whichever way it is written, or stops the run.
//
// check-liveness read only `--status=…`. `--status Rejected` (the space form
// most of the repo's CLIs accept) and a `--status` with no value both fell back
// to the default statuses, Evaluated and Applied, without a word. With
// `--discard-expired --apply` that rewrote rows the user never asked about.
//
// The rows here have no posting URL, so the run reports which rows it selected
// and checks nothing: no network, no browser.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const dir = mkdtempSync(join(tmpdir(), 'liveness-status-flag-'));
try {
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-10-01 | Acme | Engineer | 4.0/5 | Rejected | ❌ | — | |',
    '| 2 | 2026-10-02 | Globex | Engineer | 4.1/5 | Applied | ❌ | — | |',
    '',
  ].join('\n'));
  const run = (...args) => {
    const r = spawnSync(NODE, [join(ROOT, 'check-liveness.mjs'), '--tracker', '--no-record', ...args], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_TRACKER: '', CAREER_OPS_DATA_DIR: '' },
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  console.log('\ncheck-liveness — --status selects the rows it names');

  ok('`--status Rejected` selects the Rejected row', () => {
    // THE BUG: this read the defaults and selected #2, the Applied row.
    const r = run('--status', 'Rejected');
    assert.strictEqual(r.status, 0, r.out);
    assert.match(r.out, /Tracker rows with status Rejected: 0 with a posting URL, 1 without \(#1\)/, r.out);
  });

  ok('`--status=Rejected` selects the same row', () => {
    const r = run('--status=Rejected');
    assert.match(r.out, /Tracker rows with status Rejected: 0 with a posting URL, 1 without \(#1\)/, r.out);
  });

  ok('a --status with no value stops the run', () => {
    for (const args of [['--status'], ['--status='], ['--status', '--discard-expired']]) {
      const r = run(...args);
      assert.strictEqual(r.status, 1, `${args.join(' ')}: exit ${r.status}\n${r.out}`);
      assert.match(r.out, /--status needs a value/, r.out);
      assert.doesNotMatch(r.out, /Tracker rows with status/, 'no rows may be selected');
    }
  });

  ok('premise: without --status the defaults select the Applied row', () => {
    const r = run();
    assert.match(r.out, /Tracker rows with status evaluated or applied: 0 with a posting URL, 1 without \(#2\)/, r.out);
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
