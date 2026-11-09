// tests/analyzer-flag-forms.test.mjs — tracker-sync-check.mjs and
// discard-analytics.mjs read their value flags in both spellings and refuse
// flags they do not know.
//
// Both scripts looked a value up with `indexOf('--flag')`, which is -1 for
// `--flag=value`. The `=` spelling therefore ran on the default input and
// exited 0:
//   - `tracker-sync-check.mjs --apps-file=a.md --interviews-file=b.md` reported
//     "total: 0" (no mismatches) for files it never opened, so a tracker that
//     was out of sync read as in sync.
//   - `discard-analytics.mjs --log=d.log --since=2026-08-26` looked for the
//     default log and said it was not found; `--since=`, `--reason=` and
//     `--top=` were dropped even when the log was found.
// A mistyped flag (`--sumary`) was ignored the same way.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const dir = mkdtempSync(join(tmpdir(), 'analyzer-flag-forms-'));
try {
  const empty = join(dir, 'empty-root');
  mkdirSync(join(empty, 'data'), { recursive: true });

  const apps = join(dir, 'applications.md');
  writeFileSync(apps, [
    '# Applications Tracker', '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|---|---|---|---|---|---|---|---|',
    '| 1 | 2026-10-01 | Acme Corp | Backend Engineer | 4.2/5 | Evaluated | ❌ | — | |',
    '',
  ].join('\n'));
  const interviews = join(dir, 'active-interviews.md');
  writeFileSync(interviews, [
    '# Active Interviews', '',
    '| Company | Role | Status | Notes |',
    '|---|---|---|---|',
    '| Acme Corp | Backend Engineer | Interview | #1 in tracker |',
    '',
  ].join('\n'));
  const log = join(dir, 'discard.log');
  writeFileSync(log, [
    '2026-08-25T10:00:00Z\thttps://example.com/job1\ttitle_mismatch: a',
    '2026-08-25T11:00:00Z\thttps://example.com/job2\tnot_tech: b',
    '2026-08-26T09:00:00Z\thttps://example.com/job3\tlocation_mismatch: c',
    '',
  ].join('\n'));

  const run = (script, ...args) => {
    const r = spawnSync(NODE, [join(ROOT, script), ...args], {
      cwd: dir, encoding: 'utf-8', timeout: 30000,
      env: { ...process.env, CAREER_OPS_ROOT: empty, CAREER_OPS_TRACKER: '', CAREER_OPS_DATA_DIR: '' },
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const syncTotal = (r) => JSON.parse(r.out).summary.total;

  console.log('\ntracker-sync-check — --apps-file / --interviews-file');

  ok('premise: the space form reads both files (one interview row checked)', () => {
    const r = run('tracker-sync-check.mjs', '--apps-file', apps, '--interviews-file', interviews);
    assert.strictEqual(r.status, 0, r.err);
    assert.strictEqual(syncTotal(r), 1);
  });

  ok('the `=` form reads the same files', () => {
    const r = run('tracker-sync-check.mjs', `--apps-file=${apps}`, `--interviews-file=${interviews}`);
    assert.strictEqual(r.status, 0, r.err);
    assert.strictEqual(syncTotal(r), 1, 'the `=` form was ignored and the empty default root was checked');
  });

  ok('a value flag with no value stops the run', () => {
    for (const args of [['--apps-file'], ['--interviews-file='], ['--apps-file', '--summary']]) {
      const r = run('tracker-sync-check.mjs', ...args);
      assert.strictEqual(r.status, 1, `${args.join(' ')}: exit ${r.status}\n${r.out}`);
      assert.match(r.err, /requires a value/, r.err);
    }
  });

  ok('an unknown flag stops the run', () => {
    const r = run('tracker-sync-check.mjs', '--sumary');
    assert.strictEqual(r.status, 1, `exit ${r.status}\n${r.out}`);
    assert.match(r.err, /unrecognized flag\(s\): --sumary/, r.err);
  });

  console.log('\ndiscard-analytics — --log / --since / --reason / --top');

  ok('premise: the space form applies --since', () => {
    const r = run('discard-analytics.mjs', '--log', log, '--since', '2026-08-26');
    assert.strictEqual(r.status, 0, r.err);
    assert.match(r.out, /Total discards: 1\b/, r.out);
  });

  ok('the `=` form applies --log and --since', () => {
    const r = run('discard-analytics.mjs', `--log=${log}`, '--since=2026-08-26');
    assert.strictEqual(r.status, 0, r.err);
    assert.match(r.out, /Total discards: 1\b/, r.out);
  });

  ok('the `=` form applies --reason and --top', () => {
    const r = run('discard-analytics.mjs', `--log=${log}`, '--reason=not_tech', '--top=1');
    assert.match(r.out, /Total discards: 1\b/, r.out);
    assert.match(r.out, /By domain \(top 1\)/, r.out);
  });

  ok('a value flag with no value stops the run', () => {
    for (const args of [['--log'], ['--since='], ['--reason', '--top', '3']]) {
      const r = run('discard-analytics.mjs', ...args);
      assert.strictEqual(r.status, 1, `${args.join(' ')}: exit ${r.status}\n${r.out}`);
      assert.match(r.err, /requires a value/, r.err);
    }
  });

  ok('an unknown flag stops the run', () => {
    const r = run('discard-analytics.mjs', `--log=${log}`, '--sinse=2026-08-26');
    assert.strictEqual(r.status, 1, `exit ${r.status}\n${r.out}`);
    assert.match(r.err, /unrecognized flag\(s\): --sinse=2026-08-26/, r.err);
  });

  ok('--help still prints usage and exits 0', () => {
    for (const script of ['tracker-sync-check.mjs', 'discard-analytics.mjs']) {
      for (const flag of ['--help', '-h']) {
        const r = run(script, flag);
        assert.strictEqual(r.status, 0, `${script} ${flag}: exit ${r.status}\n${r.err}`);
        assert.match(r.out, /Usage/i, `${script} ${flag}: no usage text`);
      }
    }
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
