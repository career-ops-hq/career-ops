// tests/suite-data-root-sandbox.test.mjs — the suite runs against a data root
// of its own, and says so when something reaches the developer's anyway (#5113).
//
// Three suites used to overwrite live files under the checkout's data/ and put
// them back from memory, and with CAREER_OPS_ROOT exported the script smoke
// tests appended a fixture row to the developer's real assessments log on
// every run. tests/helpers.mjs now pins a scratch data root when it loads and
// compares the real one with how it found it when the process exits.
//
// Checked from child processes that start the way a suite started from a
// developer's shell does — WITH their data root in the environment, and
// without the run's own sandbox variable, so each child owns a sandbox the way
// test-all.mjs does. "Their" data root here is a temp directory.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { diffSnapshots, snapshotDataRoot } from './data-root-guard.mjs';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\ntest suite — runs against its own data root, and guards the real one');

const FIXTURE = join(ROOT, 'tests', 'fixtures', 'data-root-sandbox-child.mjs');
const TRACKER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n| 1 | 2026-01-01 | Acme Widgets | Coordinator | 4.0/5 | Applied | ❌ | — | note |\n';
const ASSESSMENTS = 'date\tcompany\trole\tplatform\tsubject\tthreshold\tscore\n';

// The developer's shell, minus anything this run pinned for itself.
const shellEnv = { ...process.env };
delete shellEnv.CAREER_OPS_TEST_DATA_ROOT;
delete shellEnv.CAREER_OPS_ROOT;
delete shellEnv.CAREER_OPS_DATA_DIR;

const child = (env, ...argv) => {
  const r = spawnSync(NODE, [FIXTURE, ...argv], {
    cwd: ROOT,
    env: { ...shellEnv, ...env },
    encoding: 'utf-8',
    timeout: 60_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const field = (name) => (out.match(new RegExp(`^${name}=(.*)$`, 'm')) || [])[1];
  return { status: r.status, out, field };
};

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'co-suite-data-root-')));
try {
  // "The developer's" data root: outside the checkout, with a tracker and an
  // append-only log a stray writer would add to.
  const theirs = join(dir, 'theirs');
  mkdirSync(join(theirs, 'data'), { recursive: true });
  const seed = () => {
    writeFileSync(join(theirs, 'data', 'applications.md'), TRACKER);
    writeFileSync(join(theirs, 'data', 'assessments.tsv'), ASSESSMENTS);
  };
  seed();
  const before = snapshotDataRoot(theirs, ROOT);
  const untouched = () => diffSnapshots(before, snapshotDataRoot(theirs, ROOT)).length === 0;

  for (const variable of ['CAREER_OPS_ROOT', 'CAREER_OPS_DATA_DIR']) {
    const r = child({ [variable]: theirs }, 'report');
    const sandbox = r.field('SANDBOX');
    if (r.status === 0 && r.field('REAL') === theirs && sandbox && sandbox !== theirs
        && r.field('RESOLVED') === sandbox) {
      pass(`an inherited ${variable} is recorded as the real root and replaced by a scratch one`);
    } else {
      fail(`an inherited ${variable} still decides the data root: exit ${r.status}\n${r.out}`);
    }
    if (sandbox && !existsSync(sandbox)) {
      pass(`the scratch data root is removed when its owner exits (${variable})`);
    } else {
      fail(`the scratch data root outlived its owner: ${sandbox}`);
    }
  }

  // The writer that leaked: assessment-log.mjs add, run from the checkout with
  // no env of its own.
  {
    const r = child({ CAREER_OPS_ROOT: theirs }, 'writer');
    if (r.status === 0 && r.field('ADDED') === 'true') {
      pass('a writer run through run() succeeds against the scratch root (control)');
    } else {
      fail(`the writer did not run: exit ${r.status}\n${r.out}`);
    }
    if (untouched()) {
      pass("the writer left the developer's data root byte-identical");
    } else {
      fail(`the writer reached the developer's data root: ${JSON.stringify(diffSnapshots(before, snapshotDataRoot(theirs, ROOT)))}`);
    }
  }

  // One sandbox per run: a child that loads the helpers joins its parent's and
  // leaves it in place when it exits.
  {
    const r = child({ CAREER_OPS_ROOT: theirs }, 'nested');
    const sandbox = r.field('SANDBOX');
    if (r.status === 0 && sandbox && r.field('INNER_SANDBOX') === sandbox
        && r.field('INNER_RESOLVED') === sandbox && r.field('INNER_REAL') === ''
        && r.field('SANDBOX_SURVIVED_CHILD') === 'true') {
      pass("a child that loads the helpers joins the run's scratch root and does not remove it");
    } else {
      fail(`a child of the run did not share its scratch root: exit ${r.status}\n${r.out}`);
    }
  }

  // The sandbox variable is inherited too, so a stale export must not be taken
  // at its word: a directory these helpers did not make is not joined, whether
  // it is somebody's data or merely named like a sandbox somewhere else.
  {
    const lookalike = join(dir, 'career-ops-test-data-lookalike');
    mkdirSync(lookalike);
    for (const [label, stale] of [['a real data directory', theirs], ['a sandbox-named directory outside the temp root', lookalike]]) {
      const r = child({ CAREER_OPS_ROOT: theirs, CAREER_OPS_TEST_DATA_ROOT: stale }, 'writer');
      const sandbox = r.field('SANDBOX');
      if (r.status === 0 && r.field('ADDED') === 'true' && r.field('REAL') === theirs
          && sandbox && sandbox !== stale && r.field('RESOLVED') === sandbox
          && untouched() && readdirSync(lookalike).length === 0) {
        pass(`an inherited sandbox variable naming ${label} is not joined`);
      } else {
        fail(`a stale sandbox variable (${label}) was trusted: exit ${r.status}\n${r.out}`);
      }
    }
  }

  // The guard. A clean run says nothing and exits 0 …
  {
    const r = child({ CAREER_OPS_ROOT: theirs }, 'report');
    if (r.status === 0 && !/changed the real data root/.test(r.out)) {
      pass('the guard is silent when the real data root is unchanged (control)');
    } else {
      fail(`the guard fired on an unchanged data root: exit ${r.status}\n${r.out}`);
    }
  }

  // … a suite run on its own that writes the real root exits non-zero and
  // names the file …
  {
    const r = child({ CAREER_OPS_ROOT: theirs }, 'write-real');
    if (r.status === 1 && r.out.includes(`changed the real data root (${theirs})`)
        && /modified\s+data\/applications\.md/.test(r.out)) {
      pass('a suite that writes to the real data root fails, naming the file');
    } else {
      fail(`a write to the real data root went unreported: exit ${r.status}\n${r.out}`);
    }
    seed();
  }

  // … and under test-all.mjs the summary itself is red, not green above a
  // complaint.
  {
    const r = child({ CAREER_OPS_ROOT: theirs }, 'write-real-finish');
    if (r.status === 1 && /Results: 0 passed, 1 failed/.test(r.out) && r.out.includes('TESTS FAILED')
        && !r.out.includes('All tests passed')
        && r.out.indexOf('changed the real data root') < r.out.indexOf('Results:')
        && r.out.split('changed the real data root').length === 2) {
      pass('the summary counts the write as a failure, once, above the totals');
    } else {
      fail(`the summary did not turn red: exit ${r.status}\n${r.out}`);
    }
    seed();
  }

  // An interrupted run still looks. Windows cannot deliver either signal to a
  // handler (process.kill terminates the target outright there).
  if (process.platform === 'win32') {
    pass('interrupt checks skipped on Windows: signals cannot reach a handler there');
  } else {
    for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      const r = child({ CAREER_OPS_ROOT: theirs }, 'write-real-signal', signal);
      if (r.status === code && r.out.includes(`interrupted (${signal})`)
          && /modified\s+data\/applications\.md/.test(r.out) && !r.out.includes('SIGNAL-NOT-HANDLED')) {
        pass(`a run ended by ${signal} still reports the write, and keeps exit ${code}`);
      } else {
        fail(`${signal} skipped the data-root check: exit ${r.status}\n${r.out}`);
      }
      seed();
    }
  }
} catch (err) {
  fail(`data-root sandbox test could not run: ${err.message}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
