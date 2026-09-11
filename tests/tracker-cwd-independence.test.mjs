// tests/tracker-cwd-independence.test.mjs — tracker.mjs must work from any cwd
// (#3508).
//
// templates/states.yml ships with the code, but tracker.mjs referenced it as the
// bare relative string 'templates/states.yml', which resolves against
// process.cwd(). Every command — sync, query, history, export, delete, all of
// which reach loadStates() — therefore failed from anywhere but the repo root,
// with an error that documented the constraint instead of fixing it:
//
//   Error: templates/states.yml not found — cannot validate statuses.
//   Run from the career-ops root.
//
// That is the shape the data-root mechanism invites: cd to your data directory,
// run the tool out of the checkout. It also breaks any cron entry, launchd job or
// wrapper that does not cd into the repo first — the automation shapes
// docs/AUTOMATION.md recommends.
//
// The suite could not see it because tests/helpers.mjs run() spawns every child
// with `cwd: ROOT` — the one directory where the bug cannot appear. So this suite
// sets cwd explicitly, and asserts on behavior (a real sync from a temp dir)
// rather than on the shape of the source.
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

console.log('\ntracker.mjs — runs from any working directory (#3508)');

const work = mkdtempSync(join(tmpdir(), 'cops-cwd-'));
const md = join(work, 'applications.md');

writeFileSync(md, [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  '| 1 | 2026-01-04 | Acme | Engineer | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-01-04.md) | first |',
  '',
].join('\n'), 'utf-8');

// Built once, deliberately, rather than spreading process.env and hoping. Suites
// share one process and children inherit whatever it holds, so a path override
// left set by an earlier suite would quietly redirect this one's index and turn a
// pass into a confusing failure here. Only the tracker is pinned; everything else
// this test reasons about must come from the module's own location.
const childEnv = { ...process.env, CAREER_OPS_TRACKER: md };
delete childEnv.CAREER_OPS_TRACKER_DB;
delete childEnv.CAREER_OPS_ROOT;
delete childEnv.CAREER_OPS_DATA_DIR;

/** Run tracker.mjs from `work`, never from the repo root. Returns {ok, out}. */
function trackerFromElsewhere(...args) {
  try {
    return {
      ok: true,
      out: execFileSync(NODE, [join(ROOT, 'tracker.mjs'), ...args], {
        cwd: work,                       // the point of this suite
        encoding: 'utf-8',
        timeout: 30000,
        env: childEnv,
      }),
    };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

try {
  const sync = trackerFromElsewhere('sync');
  sync.ok
    ? pass('tracker.mjs sync succeeds from a cwd outside the repo root')
    : fail(`tracker.mjs sync failed from another cwd: ${sync.out.trim().split('\n')[0]}`);

  // The old failure was specifically a states.yml miss. Name it, so a future
  // regression is recognizable rather than just "something broke".
  /states\.yml not found/.test(sync.out)
    ? fail('tracker.mjs still resolves templates/states.yml against the cwd (#3508)')
    : pass('templates/states.yml resolves from the codebase, not the cwd');

  existsSync(join(work, 'applications.db'))
    ? pass('the derived index landed beside the tracker it was built from')
    : fail('sync reported success but wrote no index beside the tracker');

  // query exercises loadStates() down a different path (ensureFresh), and proves
  // the row actually round-tripped rather than sync merely exiting 0.
  const query = trackerFromElsewhere('query', '--json');
  if (!query.ok) {
    fail(`tracker.mjs query failed from another cwd: ${query.out.trim().split('\n')[0]}`);
  } else {
    let rows = null;
    try { rows = JSON.parse(query.out); } catch { /* handled below */ }
    Array.isArray(rows) && rows.length === 1 && rows[0].company === 'Acme' && rows[0].status === 'Evaluated'
      ? pass('query returns the indexed row with its status validated against states.yml')
      : fail(`query returned unexpected rows from another cwd: ${query.out.trim().slice(0, 200)}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
