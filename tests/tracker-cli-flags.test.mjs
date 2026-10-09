// tests/tracker-cli-flags.test.mjs — tracker.mjs validates each subcommand's
// own flags instead of accepting anything with a leading dash (#4602).
//
// `node tracker.mjs delete --num 12 --dryrun` (missing the hyphen) reached
// `deleteApp()`'s `args.includes('--dry-run')` check unseen: it evaluated to
// false, and row 12 was removed from applications.md FOR REAL instead of
// previewing the removal. Every subcommand's flags were read the same
// unvalidated way (`args.includes(...)` / a local `flagValue()`), so any
// mistyped flag silently fell through to that subcommand's default, live
// behavior. Separately, `node tracker.mjs --help` (no subcommand) fell into
// the "unknown command" branch, which treats any truthy `command` as an
// error and exited 1 despite printing usage.
//
// HERMETIC: every run below points CAREER_OPS_TRACKER at a throwaway fixture
// under tmpdir(); nothing reads or writes the developer's own tracker.
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

console.log('\ntracker.mjs — per-subcommand CLI flag validation (#4602)');

const FIXTURE_ROW =
  '| 1 | 2026-01-05 | Northwind Robotics | Backend Engineer | 4.2/5 | Applied | ✅ | [1](reports/001-northwind-robotics-2026-01-05.md) | fixture |\n';

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'co-tracker-cli-'));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir, { recursive: true });
  const tracker = join(dataDir, 'applications.md');
  writeFileSync(
    tracker,
    '# Applications Tracker\n\n'
      + '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
      + '|---|------|---------|------|-------|--------|-----|--------|-------|\n'
      + FIXTURE_ROW,
    'utf-8',
  );
  return { dir, tracker };
}

function runTracker(args, sandbox) {
  const env = {
    ...process.env,
    CAREER_OPS_ROOT: sandbox.dir,
    CAREER_OPS_DATA_DIR: '',
    CAREER_OPS_TRACKER: sandbox.tracker,
  };
  const r = spawnSync(NODE, [join(ROOT, 'tracker.mjs'), ...args], {
    cwd: ROOT, encoding: 'utf-8', timeout: 30_000, env,
  });
  return { status: r.status, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function cleanup(sandbox) {
  rmSync(sandbox.dir, { recursive: true, force: true });
}

// ── Test 1: the exact reported bug — `--dryrun` (missing the hyphen) on
//    `delete` must be rejected, not silently treated as absent. ──
{
  const sb = makeSandbox();
  const r = runTracker(['delete', '--num', '1', '--dryrun'], sb);
  if (r.status !== 0 && /unrecognized flag/i.test(r.all) && r.all.includes('--dryrun')) {
    pass('delete --num 1 --dryrun (typo) is rejected, names the bad flag');
  } else {
    fail(`delete --num 1 --dryrun (typo) — expected a named rejection, got exit ${r.status}: ${r.all}`);
  }
  const stillThere = readFileSync(sb.tracker, 'utf-8').includes('Northwind Robotics');
  if (stillThere) pass('the row survives the rejected typo — no silent real deletion');
  else fail('the row survives the rejected typo — it was removed');
  cleanup(sb);
}

// ── Test 2: the correctly-spelled flag still previews, and still leaves the
//    row untouched (dry-run must remain a genuine no-op). ──
{
  const sb = makeSandbox();
  const r = runTracker(['delete', '--num', '1', '--dry-run'], sb);
  if (r.status === 0) pass('delete --num 1 --dry-run (correct) still exits 0');
  else fail(`delete --num 1 --dry-run (correct) — expected exit 0, got ${r.status}: ${r.all}`);
  const stillThere = readFileSync(sb.tracker, 'utf-8').includes('Northwind Robotics');
  if (stillThere) pass('a genuine --dry-run leaves the row untouched');
  else fail('a genuine --dry-run leaves the row untouched — it was removed');
  cleanup(sb);
}

// ── Test 3: web/src/app/api/tracker/delete/route.ts's exact argv (the
//    web-core-argv-contract shape) must keep working unchanged. ──
{
  const sb = makeSandbox();
  const r = runTracker(['delete', '--num', '1', '--dry-run'], sb);
  if (r.status === 0) pass('the web delete route\'s exact argv still exits 0');
  else fail(`the web delete route's exact argv — expected exit 0, got ${r.status}: ${r.all}`);
  cleanup(sb);
}

// ── Test 4: a mistyped flag on every OTHER subcommand is rejected too — the
//   bug was never delete-specific, just most visible there. ──
const OTHER_TYPOS = [
  { args: ['sync', '--chek'], typo: '--chek' },
  { args: ['query', '--statuz', 'Applied'], typo: '--statuz' },
  { args: ['history', '--idd', '1'], typo: '--idd' },
  { args: ['export', '--forc'], typo: '--forc' },
];
for (const { args, typo } of OTHER_TYPOS) {
  const sb = makeSandbox();
  runTracker(['sync'], sb); // seed the index so query/history/export have one to read
  const r = runTracker(args, sb);
  if (r.status !== 0 && /unrecognized flag/i.test(r.all) && r.all.includes(typo)) {
    pass(`${args[0]} ${typo} (typo) is rejected, names the bad flag`);
  } else {
    fail(`${args[0]} ${typo} (typo) — expected a named rejection, got exit ${r.status}: ${r.all}`);
  }
  cleanup(sb);
}

// ── Test 5: `--help`/`-h` at the top level (no subcommand) now exits 0 —
//    it used to fall into the "unknown command" branch and exit 1. ──
{
  const sb = makeSandbox();
  const r1 = runTracker(['--help'], sb);
  if (r1.status === 0 && /Usage:/.test(r1.all)) pass('tracker.mjs --help exits 0 and prints usage');
  else fail(`tracker.mjs --help — expected exit 0 with usage, got ${r1.status}: ${r1.all}`);
  const r2 = runTracker(['-h'], sb);
  if (r2.status === 0) pass('tracker.mjs -h exits 0');
  else fail(`tracker.mjs -h — expected exit 0, got ${r2.status}: ${r2.all}`);
  cleanup(sb);
}

// ── Test 6: an unknown SUBCOMMAND (not a flag) still exits 1, unchanged —
//    only --help/-h at the top level changed. ──
{
  const sb = makeSandbox();
  const r = runTracker(['bogus-command'], sb);
  if (r.status === 1) pass('an unknown subcommand still exits 1, unchanged');
  else fail(`an unknown subcommand — expected exit 1, got ${r.status}: ${r.all}`);
  cleanup(sb);
}

// ── Test 7: every documented flag on every subcommand still behaves as
//    before — the acceptance criterion this whole fix must not regress. ──
{
  const sb = makeSandbox();
  runTracker(['sync'], sb);
  const q = runTracker(['query', '--status', 'Applied', '--json'], sb);
  if (q.status === 0 && /Northwind Robotics/.test(q.all)) {
    pass('query --status Applied --json still returns the matching row');
  } else {
    fail(`query --status Applied --json — expected the fixture row, got exit ${q.status}: ${q.all}`);
  }
  const h = runTracker(['history', '--id', '1'], sb);
  if (h.status === 0 && /Northwind Robotics/.test(h.all)) pass('history --id 1 still works');
  else fail(`history --id 1 — expected the fixture row, got exit ${h.status}: ${h.all}`);
  const e = runTracker(['export', '--out', join(sb.dir, 'out.md'), '--force'], sb);
  if (e.status === 0) pass('export --out <path> --force still works');
  else fail(`export --out <path> --force — expected exit 0, got ${e.status}: ${e.all}`);
  cleanup(sb);
}
