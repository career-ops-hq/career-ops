// tests/no-user-data-batch-guard.test.mjs — the PR guard covers batch/, and
// still lets the tracked sources under it through (#4531).
//
// batch/ is where the batch workers write their output: tailored CV and
// cover-letter JSON, prefetched job-description text, per-run state. That is
// user-layer content by DATA_CONTRACT.md's definition even though the scripts
// that produce it are system layer, and .github/workflows/no-user-data.yml had
// no pattern for it — a staged batch/cv-*.json passed the guard and printed
// "OK". .gitignore stops the accident; this guard is the layer that stops a
// deliberate `git add -f` and the next generator name that outruns the ignore
// rules.
//
// The guard is a blanket ^batch/ with the tracked sources exempted by name, so
// the two halves below are both load-bearing. Blocking without the exemption
// would wall off every edit to batch-runner.sh; exempting without the block
// would restore the original hole.
//
// The guard also has to keep pace with update-system.mjs's USER_PATHS: a
// user-layer path added there and not here (documents/, modes/_brief.md —
// #4891) is private data the guard waves through. The last test below fails
// the moment the two lists drift, unless the gap is allowlisted with a reason.
//
// The predicate is EVALUATED out of the workflow, not pattern-matched in it.
// A regex-over-source check passes on a USER_PATHS entry that an isScaffold
// change has quietly neutered, which is exactly the drift worth catching.
//
// Run:  node --test tests/no-user-data-batch-guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER_PATHS } from '../update-system.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const WORKFLOW = '.github/workflows/no-user-data.yml';

/**
 * Build the workflow's own "is this file blocked?" decision.
 *
 * Slices the YAML from the USER_PATHS declaration to the line that consumes it
 * and evaluates that slice, so the returned predicate is the shipped logic
 * rather than a second copy of it. The slice bounds are asserted first: an
 * indexOf miss returns -1, and a silently empty slice would make every
 * assertion below pass against a predicate that blocks nothing.
 *
 * @returns {(f: string) => boolean} True when the guard would fail the PR over `f`.
 */
function loadGuard() {
  const yaml = readFileSync(join(ROOT, WORKFLOW), 'utf-8');
  const start = yaml.indexOf('const USER_PATHS = [');
  const end = yaml.indexOf('const bad = files');
  assert.ok(start !== -1, `${WORKFLOW} has no USER_PATHS declaration`);
  assert.ok(end > start, `${WORKFLOW} no longer consumes USER_PATHS via "const bad = files"`);
  const src = yaml.slice(start, end);
  assert.match(src, /isScaffold/, 'the extracted slice is missing the isScaffold exemption');
  // eslint-disable-next-line no-new-func
  return new Function(
    `${src}\nreturn (f) => USER_PATHS.some((re) => re.test(f)) && !isScaffold(f);`,
  )();
}

/** @returns {string[]} Repo-relative paths git tracks under batch/. */
function trackedBatchFiles() {
  // -z for the same reason the rest of the suite uses it: a path containing a
  // newline must not split into two records and drop a file from the sweep.
  return execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', 'batch/'], { encoding: 'utf-8' })
    .split('\0')
    .filter(Boolean);
}

test('the guard blocks generated batch/ worker output', () => {
  const isBlocked = loadGuard();

  // A control from the list that predates this change. If the extracted
  // predicate is inert, this fails first and names the real cause.
  assert.ok(isBlocked('cv.md'), 'the extracted predicate does not even block cv.md — it is inert');

  const generated = [
    'batch/cv-001.json',                  // tailored CV payload: candidate, experience, projects
    'batch/cover-001.json',               // tailored cover-letter payload
    'batch/tmp/jd-001.txt',               // prefetched job-description text
    'batch/batch-state.tsv',              // per-run worker state
    'batch/batch-state.tsv.tmp',          // its atomic-rename sibling
    'batch/batch-input.tsv',
    'batch/email-leads.json',
    'batch/logs/worker-1.log',
    'batch/tracker-additions/001-example.tsv',
    'batch/batch-state-recovery.d/001.tsv',
    // The generic scaffold exemptions must not reach into batch/. A worker
    // scratch dir is free to contain a README.md, and a filename-shaped
    // exemption would wave it through carrying whatever the worker wrote.
    'batch/tmp/README.md',
    'batch/tmp/.gitkeep',
  ];
  const passed = generated.filter((f) => !isBlocked(f));
  assert.deepEqual(
    passed,
    [],
    `the no-user-data guard would merge generated batch/ output: ${passed.join(', ')}`,
  );
});

test('the generic scaffold exemptions still apply outside batch/', () => {
  const isBlocked = loadGuard();

  // batch/ narrows isScaffold to an exact allowlist. The other guarded
  // directories keep the filename exemption they have always had, and several
  // of them track a real .gitkeep or README.md, so narrowing it globally would
  // fail every PR that touches those files.
  const scaffoldElsewhere = [
    'data/.gitkeep',
    'reports/.gitkeep',
    'documents/.gitkeep',
    'documents/README.md',
    'interview-prep/sessions/README.md',
    'writing-samples/README.md',
  ];
  const overblocked = scaffoldElsewhere.filter(isBlocked);
  assert.deepEqual(
    overblocked,
    [],
    `the batch/ narrowing leaked into other directories and would block tracked ` +
      `scaffolding there: ${overblocked.join(', ')}`,
  );
});

test('the guard exempts every tracked source under batch/', () => {
  const isBlocked = loadGuard();
  const tracked = trackedBatchFiles();

  // Without this the assertion below is satisfied by an empty list, which is
  // what a failed git call or a renamed directory produces.
  assert.ok(
    tracked.length >= 6,
    `git ls-files found only ${tracked.length} tracked files under batch/ — the exemption ` +
      'check would pass vacuously',
  );

  const blocked = tracked.filter(isBlocked);
  assert.deepEqual(
    blocked,
    [],
    `the no-user-data guard would block tracked batch/ sources, failing every PR that edits ` +
      `them: ${blocked.join(', ')}`,
  );
});

// update-system.mjs USER_PATHS entries the guard deliberately does not block.
// Each one needs a reason; an entry here that leaves USER_PATHS fails below.
const NOT_GUARDED = new Map([
  ['voice-dna.md', 'ships as a populated system default, so edits to it are legit'],
  ['.claude/settings.json', 'project harness config, not gitignored, may legitimately be committed'],
  ['.claude/hooks/', 'project harness config, not gitignored, may legitimately be committed'],
]);

test('the guard blocks every update-system.mjs user-layer path not allowlisted', () => {
  const isBlocked = loadGuard();

  const stale = [...NOT_GUARDED.keys()].filter((p) => !USER_PATHS.includes(p));
  assert.deepEqual(stale, [], `NOT_GUARDED names paths update-system.mjs no longer lists: ${stale.join(', ')}`);

  // A directory entry is probed with a file under it, since the guard sees
  // file paths from listFiles, never bare directories.
  const unguarded = USER_PATHS
    .filter((p) => !NOT_GUARDED.has(p))
    .filter((p) => !isBlocked(p.endsWith('/') ? `${p}private.pdf` : p));
  assert.deepEqual(
    unguarded,
    [],
    `update-system.mjs USER_PATHS entries the no-user-data guard lets through — add them to ` +
      `${WORKFLOW} or to NOT_GUARDED with a reason: ${unguarded.join(', ')}`,
  );
});
