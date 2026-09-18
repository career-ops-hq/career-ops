/**
 * updater-local-paths.test.mjs — coverage for the local user-paths
 * declaration file (#2421).
 *
 * A fork that keeps its own files (a nightly runner, an .mcp.json, a
 * .gitattributes) has no supported way to say "this file is mine": the only
 * lever is USER_PATHS, which lives inside update-system.mjs — the very file
 * `apply` overwrites and git re-merges on every sync. The declaration file
 * moves that statement OUT of the system layer.
 *
 * What is pinned here is the property that makes the feature safe to ship:
 * absent file changes nothing, and a declaration that would silently stop a
 * system file from updating is refused instead of honored.
 */

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { ROOT, pass, fail } from './helpers.mjs';
import {
  LOCAL_PATHS_FILE,
  USER_PATHS,
  parseLocalPaths,
  localUserPaths,
  effectiveUserPaths,
  userLayerViolations,
} from '../update-system.mjs';

/** A throwaway root with an optional declaration file already written. */
function makeRoot(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'co-local-paths-'));
  if (contents !== undefined) {
    mkdirSync(join(dir, 'config'), { recursive: true });
    writeFileSync(join(dir, LOCAL_PATHS_FILE), contents);
  }
  return dir;
}

const roots = [];
function root(contents) {
  const dir = makeRoot(contents);
  roots.push(dir);
  return dir;
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('\n🧪 Local user-paths declaration file (#2421)\n');

// ── 1. Absent file is a no-op ──
//    The whole feature has to be invisible to every existing install. If this
//    ever goes red, the default behaviour changed for people who never opted
//    in.
{
  const got = localUserPaths(root(undefined));
  if (eq(got, [])) {
    pass('no declaration file → no extra user paths');
  } else {
    fail(`#1 absent file returned ${JSON.stringify(got)}`);
  }
}

// ── 2. An empty / comments-only file is also a no-op ──
{
  const got = localUserPaths(root('# just a comment\n\n   \n'));
  if (eq(got, [])) {
    pass('comments and blank lines only → no extra user paths');
  } else {
    fail(`#2 comments-only returned ${JSON.stringify(got)}`);
  }
}

// ── 3. Real declarations parse, in order, with comments and noise stripped ──
{
  const got = parseLocalPaths(
    '# my fork\nrun-nightly.ps1\n\n  .mcp.json  \nqa-fixtures/\n# trailing note\n',
  );
  if (eq(got, ['run-nightly.ps1', '.mcp.json', 'qa-fixtures/'])) {
    pass('paths parse in order; comments, blanks and padding stripped');
  } else {
    fail(`#3 parsed ${JSON.stringify(got)}`);
  }
}

// ── 4. CRLF ──
//    Windows forks are the population that needs this feature most (the
//    reported case was .gitattributes forcing LF for Git Bash), and Notepad
//    writes CRLF. A stray \r would make every entry miss its match.
{
  const got = parseLocalPaths('run-nightly.ps1\r\nqa-fixtures/\r\n');
  if (eq(got, ['run-nightly.ps1', 'qa-fixtures/'])) {
    pass('CRLF line endings parse the same as LF');
  } else {
    fail(`#4 CRLF parsed ${JSON.stringify(got)}`);
  }
}

// ── 5. Duplicates collapse ──
{
  const got = parseLocalPaths('run-nightly.ps1\nrun-nightly.ps1\n');
  if (eq(got, ['run-nightly.ps1'])) {
    pass('duplicate entries collapse to one');
  } else {
    fail(`#5 duplicates returned ${JSON.stringify(got)}`);
  }
}

// ── 6. A SYSTEM_PATHS collision is refused, loudly, naming the path ──
//    Honoring it would be worse than refusing: the user would stop receiving
//    updates for a system file and get no signal that it happened.
{
  let threw = null;
  try {
    localUserPaths(root('merge-tracker.mjs\n'));
  } catch (err) {
    threw = err;
  }
  if (threw && threw.message.includes('merge-tracker.mjs')) {
    pass('declaring a SYSTEM_PATHS entry throws and names the path');
  } else {
    fail(`#6 expected a throw naming merge-tracker.mjs, got ${threw ? threw.message : 'no throw'}`);
  }
}

// ── 7. A collision inside a SYSTEM_PATHS *directory* is refused too ──
//    'modes/' is a directory entry; modes/pdf.md is shipped by it.
{
  let threw = null;
  try {
    localUserPaths(root('modes/pdf.md\n'));
  } catch (err) {
    threw = err;
  }
  if (threw && threw.message.includes('modes/pdf.md')) {
    pass('a file inside a system directory is refused too');
  } else {
    fail(`#7 expected a throw naming modes/pdf.md, got ${threw ? threw.message : 'no throw'}`);
  }
}

// ── 8. Absolute paths and parent-directory escapes are refused ──
//    The declaration is a repo-relative statement about this checkout. A path
//    that leaves it can only widen the "never touch" set over files the
//    updater does not own.
{
  for (const bad of ['/etc/passwd', '../outside.txt', 'C:\\Windows\\system.ini']) {
    let threw = null;
    try {
      localUserPaths(root(`${bad}\n`));
    } catch (err) {
      threw = err;
    }
    if (threw) {
      pass(`escaping path refused: ${bad}`);
    } else {
      fail(`#8 accepted an escaping path: ${bad}`);
    }
  }
}

// ── 9. The declaration file never declares itself away ──
//    It is gitignored, so it is not a tracked file and needs no coverage; a
//    self-reference is a sign of a confused config, not a valid statement.
{
  let threw = null;
  try {
    localUserPaths(root(`${LOCAL_PATHS_FILE}\n`));
  } catch (err) {
    threw = err;
  }
  if (threw && threw.message.includes(LOCAL_PATHS_FILE)) {
    pass('the declaration file cannot list itself');
  } else {
    fail(`#9 expected a throw naming ${LOCAL_PATHS_FILE}, got ${threw ? threw.message : 'no throw'}`);
  }
}

// ── 10/11. End-to-end: the coverage guard honours the declaration ──
//    This is the half of #2421 that bites second. Even with the safety check
//    fixed, `validate-system-paths-coverage.mjs` fails the whole suite on any
//    tracked file that is in neither array — so a fork keeping its own file
//    still has to edit update-system.mjs. Both halves have to move together.
//
//    Driven against a throwaway git repo holding copies of the two scripts,
//    the same shape as the coverage-guard probe in test-all.mjs.
{
  const dir = mkdtempSync(join(tmpdir(), 'co-local-paths-repo-'));
  roots.push(dir);
  // The throwaway repo is only throwaway if git ignores the ambient
  // environment. GIT_CONFIG_COUNT/KEY_n/VALUE_n outrank every config file, so
  // an inherited triple would override the `g('config', ...)` calls below —
  // and a system gitconfig can still redirect a URL or install a hooksPath.
  // Neutralize both, and hand the same environment to the guard subprocess,
  // which shells out to git itself.
  const env = { ...process.env, GIT_CONFIG_COUNT: '0', GIT_CONFIG_NOSYSTEM: '1' };
  const g = (...args) =>
    spawnSync('git', args, { cwd: dir, encoding: 'utf-8', env });

  g('init', '-q', '-b', 'main', '.');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  g('config', 'commit.gpgsign', 'false');
  g('config', 'core.hooksPath', join(dir, 'no-such-hooks'));

  for (const f of ['validate-system-paths-coverage.mjs', 'update-system.mjs']) {
    copyFileSync(join(ROOT, f), join(dir, f));
  }
  // A fork-local file upstream has never heard of — the reported case.
  writeFileSync(join(dir, 'run-nightly.ps1'), '# fork-local runner\n');
  g('add', '-A');
  g('commit', '-qm', 'base');

  const runGuard = () =>
    spawnSync(process.execPath, [join(dir, 'validate-system-paths-coverage.mjs')], {
      cwd: dir,
      encoding: 'utf-8',
      env,
    });

  const before = runGuard();
  if (before.status !== 0 && (before.stderr || '').includes('run-nightly.ps1')) {
    pass('undeclared fork-local file still fails the coverage guard');
  } else {
    fail(`#10 expected a coverage gap naming run-nightly.ps1, got status=${before.status}\n${before.stderr || before.stdout}`);
  }

  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(join(dir, LOCAL_PATHS_FILE), '# mine, not upstream\nrun-nightly.ps1\n');

  const after = runGuard();
  if (after.status === 0) {
    pass('declaring it in the local file clears the coverage gap');
  } else {
    fail(`#11 guard still fails after declaration: status=${after.status}\n${after.stderr || after.stdout}`);
  }
}

// ── 12-14. The apply() safety check must see declared paths as user layer ──
//    The coverage guard only decides whether a file is *registered*. The check
//    that decides whether the updater is allowed to have touched a file is the
//    SAFETY VIOLATION loop in apply(), and it compares against USER_PATHS. If
//    only the guard learns about the declaration, a fork's own file passes
//    coverage and then gets silently overwritten — the worse half of the bug.
{
  const declared = ['run-nightly.ps1', 'qa-fixtures/'];

  const got = userLayerViolations(['run-nightly.ps1'], [], declared);
  if (eq(got, ['run-nightly.ps1'])) {
    pass('a touched fork-local file is reported as a safety violation');
  } else {
    fail(`#12 expected run-nightly.ps1 flagged, got ${JSON.stringify(got)}`);
  }

  const nested = userLayerViolations(['qa-fixtures/jd-sample.md'], [], declared);
  if (eq(nested, ['qa-fixtures/jd-sample.md'])) {
    pass('a directory declaration protects files under it');
  } else {
    fail(`#13 expected the nested file flagged, got ${JSON.stringify(nested)}`);
  }

  // The existing precedence rule has to survive: an explicit path being
  // updated wins over a user-layer prefix match (writing-samples/README.md is
  // a system-owned doc inside a user directory).
  const override = userLayerViolations(
    ['writing-samples/README.md'],
    ['writing-samples/README.md'],
    ['writing-samples/'],
  );
  if (eq(override, [])) {
    pass('an explicitly updated path still overrides a user-layer prefix match');
  } else {
    fail(`#14 precedence rule broken, got ${JSON.stringify(override)}`);
  }

  // ── 15. A file declaration is not a prefix ──
  //    Without a trailing `/` the entry names one file. `startsWith` let it
  //    claim every neighbour sharing those bytes, so a declared
  //    run-nightly.ps1 also swallowed run-nightly.ps1.old and
  //    run-nightly.ps1.bak — files upstream may legitimately write, reported
  //    as violations the user never asked for.
  const neighbours = userLayerViolations(
    ['run-nightly.ps1.old', 'run-nightly.ps1-notes.md', 'qa-fixtures-old/stale.md'],
    [],
    declared,
  );
  if (eq(neighbours, [])) {
    pass('a file declaration does not claim prefix-sharing neighbours');
  } else {
    fail(`#15 expected no violations, got ${JSON.stringify(neighbours)}`);
  }
}

// ── 16-18. The path union apply() actually consumes ──
//    Every case above drives localUserPaths() or userLayerViolations() with a
//    hand-built array. apply() uses neither directly — it calls
//    effectiveUserPaths(), and that union is the value a regression would
//    corrupt. Byte-identity of the union was only proven in the real-apply CI
//    leg, so a change dropping or reordering USER_PATHS would leave every
//    unit test green. Pin the union itself.
{
  const untouched = effectiveUserPaths(root(undefined));
  if (eq(untouched, USER_PATHS)) {
    pass('no declaration file → the union is USER_PATHS, byte for byte');
  } else {
    fail(`#16 union drifted from USER_PATHS: ${JSON.stringify(untouched)}`);
  }

  const declared = ['run-nightly.ps1', 'qa-fixtures/'];
  const widened = effectiveUserPaths(root(`# mine\n${declared.join('\n')}\n`));
  if (eq(widened, [...USER_PATHS, ...declared])) {
    pass('a declaration widens the union without disturbing USER_PATHS');
  } else {
    fail(`#17 expected USER_PATHS + ${JSON.stringify(declared)}, got ${JSON.stringify(widened)}`);
  }

  // Widening is additive in the direction that matters: the safety check must
  // still flag a built-in user-layer file, not just the declared ones. A union
  // that replaced USER_PATHS instead of extending it would pass #17's length
  // check on a reordering but silently stop protecting cv.md here.
  const builtin = userLayerViolations(['cv.md'], [], widened);
  if (eq(builtin, ['cv.md'])) {
    pass('a built-in user-layer file is still protected under a widened union');
  } else {
    fail(`#18 expected cv.md flagged, got ${JSON.stringify(builtin)}`);
  }
}

// ── 19. Non-canonical spellings of a system path are refused ──
//
// The collision check compares strings exactly (`path === sys`), and
// userLayerViolations() later compares against git's changed-path format, which
// is always canonical. A declaration written as `./merge-tracker.mjs` therefore
// matches NEITHER: the collision check waves it through, and the safety check
// never recognises it as the file it names. The declaration silently protects
// nothing and the updater overwrites the file — the exact data loss #2421
// exists to prevent, reachable from a plausible typo.
//
// Canonical syntax is REQUIRED rather than normalised, because normalising
// would quietly accept several spellings for one path and leave this file
// disagreeing with what git reports.
{
  const nonCanonical = [
    ['./merge-tracker.mjs', 'a leading ./'],
    ['batch/./batch-runner.sh', 'an interior . segment'],
    ['batch//batch-runner.sh', 'a repeated separator'],
    ['batch\\batch-runner.sh', 'a backslash separator'],
    ['.', 'a bare dot'],
  ];
  const survivors = [];
  for (const [path, shape] of nonCanonical) {
    let threw = null;
    try {
      localUserPaths(root(`${path}\n`));
    } catch (err) {
      threw = err;
    }
    if (!threw || !threw.message.includes(path)) survivors.push(`${shape} → ${path}`);
  }
  if (survivors.length === 0) {
    pass('non-canonical path spellings are refused and named');
  } else {
    fail(`#19 these non-canonical forms were accepted: ${survivors.join('; ')}`);
  }
}

// ── 20. Canonical forms the fix must NOT break ──
//
// The guard rejects spelling, not vocabulary. A directory declaration keeps its
// single trailing slash, a nested path keeps its separators, and dots inside a
// FILENAME are ordinary characters rather than path segments — so a dotfile and
// a dotted name must both survive.
{
  const canonical = ['my-runner.ps1', '.toolrc', 'fixtures/', 'scripts/fetch-thing.mjs', 'notes-v2.md'];
  let problem = null;
  try {
    const got = localUserPaths(root(`${canonical.join('\n')}\n`));
    if (!eq(got, canonical)) problem = `returned ${JSON.stringify(got)}`;
  } catch (err) {
    problem = err.message;
  }
  if (!problem) {
    pass('canonical declarations, including a trailing-slash directory, still parse');
  } else {
    fail(`#20 canonical declarations were rejected or altered: ${problem}`);
  }
}

for (const dir of roots) rmSync(dir, { recursive: true, force: true });
