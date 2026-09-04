/**
 * updater-apply-target-verification.test.mjs — apply() must verify its target (#3052).
 *
 * Two structural gaps in `update-system.mjs apply()`, both readable straight
 * off the code before this change:
 *
 *   1. apply() never compared versions. `compareVersions()` has exactly two
 *      call sites and both live inside `check()`, which only decides whether to
 *      NOTIFY. The install path checked out whatever the fetch produced and
 *      printed "Update complete: vX → vY" regardless of which direction the
 *      version moved. `downgradeRefusal()` is the pure predicate apply() now
 *      consults before it writes anything.
 *
 *   2. apply() re-read `FETCH_HEAD` more than a dozen times. It is a pseudo-ref,
 *      re-resolved on every read, so the bootstrap checkout, the manifest read,
 *      the per-path checkout loop, the stale-file prune, the .gitignore
 *      reconciliation and the staging expansion were a dozen independent
 *      questions about a ref free to move between them. `pinRefToCommit()`
 *      resolves it once to an immutable SHA that the rest of the run addresses.
 *
 * Same shape as updater-upgrade-safety.test.mjs: the pure exports are driven
 * against a throwaway git repo through the ctx git seam — no network, no
 * apply() call. apply() itself is not exported, so the two properties that only
 * exist in its body (no unpinned ref reads; the guard runs before the first
 * write) are asserted against its source text.
 */

import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pass, fail } from './helpers.mjs';
import { gitIn, pinRefToCommit, versionAtRef, downgradeRefusal } from '../update-system.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const g = (...args) => gitIn(dir, ...args);
  g('init', '-q', '-b', 'main', '.');
  g('config', 'core.autocrlf', 'false');
  g('config', 'user.email', 'test@example.com');
  g('config', 'user.name', 'Test');
  // A second runner with stderr piped, for the calls whose git failure is the
  // expected outcome — gitIn inherits stderr, so those would print git's own
  // `fatal:` line into an otherwise passing suite.
  const quiet = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  return { dir, g, ctx: { git: g }, quietCtx: { git: quiet } };
}

function writeFixture(dir, rel, text) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf-8');
}

// A real FETCH_HEAD, written the way `git fetch` writes it, so rev-parse
// resolves it exactly as it would after a fetch from the canonical repo.
function setFetchHead(dir, sha) {
  writeFileSync(join(dir, '.git', 'FETCH_HEAD'), `${sha}\t\tbranch 'main' of https://example.invalid/repo\n`, 'utf-8');
}

console.log('\n🧪 Testing that apply() verifies its update target (#3052)...');

// ── 1. pinRefToCommit: one apply run addresses one immutable commit ──
{
  const { dir, g, ctx, quietCtx } = makeRepo('co-3052-pin-');

  writeFixture(dir, 'VERSION', '2.0.0\n');
  writeFixture(dir, 'update-system.mjs', '// v2\n');
  g('add', '-A');
  g('commit', '-qm', 'v2');
  const older = g('rev-parse', 'HEAD');

  writeFixture(dir, 'VERSION', '2.1.0\n');
  writeFixture(dir, 'update-system.mjs', '// v2.1\n');
  g('add', '-A');
  g('commit', '-qm', 'v2.1');
  const newer = g('rev-parse', 'HEAD');

  setFetchHead(dir, newer);
  const pinned = pinRefToCommit('FETCH_HEAD', ctx);

  if (pinned === newer) {
    pass('pinRefToCommit resolves FETCH_HEAD to the commit SHA it names');
  } else {
    fail(`pinRefToCommit returned ${pinned}, expected ${newer}`);
  }
  if (/^[0-9a-f]{40}$/.test(pinned)) {
    pass('the pin is a full 40-hex SHA, not a name that can be re-resolved');
  } else {
    fail(`pin is not an immutable SHA: ${JSON.stringify(pinned)}`);
  }

  // The TOCTOU property: move FETCH_HEAD the way a concurrent fetch (or a
  // ref that auto-follows something else) would, and the pinned SHA must still
  // name the tree the run started with. This is what the dozen unpinned reads
  // inside apply() could not promise.
  setFetchHead(dir, older);
  const afterMove = gitIn(dir, 'show', `${pinned}:update-system.mjs`);
  const unpinnedAfterMove = gitIn(dir, 'show', 'FETCH_HEAD:update-system.mjs');
  if (afterMove.includes('v2.1')) {
    pass('a read through the pinned SHA still sees the original tree after FETCH_HEAD moves');
  } else {
    fail(`pinned read followed the moving ref (got: ${JSON.stringify(afterMove)})`);
  }
  if (unpinnedAfterMove.includes('v2') && !unpinnedAfterMove.includes('v2.1')) {
    pass('control: the same read through FETCH_HEAD does follow the move (so the pin is load-bearing)');
  } else {
    fail(`control failed: FETCH_HEAD did not move (got: ${JSON.stringify(unpinnedAfterMove)})`);
  }

  let threw = false;
  try { pinRefToCommit('refs/heads/does-not-exist', quietCtx); } catch { threw = true; }
  if (threw) {
    pass('an unresolvable ref throws instead of yielding an unusable "pin"');
  } else {
    fail('pinRefToCommit accepted a ref that resolves to nothing');
  }

  // versionAtRef reads VERSION from the pinned commit, not from disk.
  if (versionAtRef(pinned, ctx) === '2.1.0' && versionAtRef(older, ctx) === '2.0.0') {
    pass('versionAtRef reads the VERSION each commit ships');
  } else {
    fail(`versionAtRef misread the target VERSION (got ${versionAtRef(pinned, ctx)} / ${versionAtRef(older, ctx)})`);
  }

  // release-please marker must not break parsing, and a commit without VERSION
  // must report '' rather than throwing — the guard turns that into a refusal.
  writeFixture(dir, 'VERSION', '2.2.0 # x-release-please-version\n');
  g('add', '-A');
  g('commit', '-qm', 'marker');
  if (versionAtRef(g('rev-parse', 'HEAD'), ctx) === '2.2.0') {
    pass('versionAtRef strips the release-please marker');
  } else {
    fail('versionAtRef did not strip the release-please marker');
  }

  const { dir: bare, g: bg, quietCtx: bctx } = makeRepo('co-3052-noversion-');
  writeFixture(bare, 'README.md', 'no VERSION here\n');
  bg('add', '-A');
  bg('commit', '-qm', 'no version');
  if (versionAtRef(bg('rev-parse', 'HEAD'), bctx) === '') {
    pass("versionAtRef returns '' for a target that ships no VERSION (never throws)");
  } else {
    fail('versionAtRef did not report a missing VERSION as empty');
  }

  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(bare, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// ── 2. downgradeRefusal: the comparison apply() never made ──
{
  const older = downgradeRefusal('1.24.0', '1.22.0');
  if (older && older.includes('1.22.0') && older.includes('1.24.0') && /older than installed/.test(older)) {
    pass('an older target is refused, and the reason names both versions');
  } else {
    fail(`an older target was not refused with a usable reason (got: ${JSON.stringify(older)})`);
  }

  if (downgradeRefusal('1.24.0', '1.25.0') === null) {
    pass('a newer target is allowed');
  } else {
    fail('a newer target was refused');
  }
  if (downgradeRefusal('1.24.0', '1.24.0') === null) {
    pass('re-applying the same version is allowed (the #1998 repair path)');
  } else {
    fail('a same-version re-apply was refused');
  }
  // Patch- and minor-level downgrades are the ones a moving ref produces; a
  // guard that only caught major regressions would miss the realistic case.
  if (downgradeRefusal('1.24.3', '1.24.2') && downgradeRefusal('2.0.0', '1.99.99')) {
    pass('patch- and major-level downgrades are both refused');
  } else {
    fail('a patch- or major-level downgrade slipped through');
  }

  // Fail closed: an unreadable target VERSION is not evidence of a newer target.
  if (downgradeRefusal('1.24.0', '')) {
    pass('a target whose VERSION cannot be read is refused, not assumed benign');
  } else {
    fail('an unverifiable target was allowed (guard fails open)');
  }
}

// ── 3. apply()'s body: no unpinned ref reads, and the guard precedes the writes ──
// apply() is not exported, so these two properties can only be asserted against
// its source. They are the regressions most likely to creep back: a new step
// added to apply() that reaches for the pseudo-ref again, or a guard that drifts
// below the first checkout and therefore stops being fail-closed.
{
  const source = readFileSync(join(REPO_ROOT, 'update-system.mjs'), 'utf-8');
  const start = source.indexOf('async function apply() {');
  const end = source.indexOf('\nfunction rollback(', start);
  if (start === -1 || end === -1) {
    fail('could not locate apply() in update-system.mjs — update this test');
  } else {
    // Blank out comments and string bodies are kept: FETCH_HEAD only matters as
    // real code, and a comment mentioning it is not a read.
    const body = source.slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');

    const reads = body.match(/FETCH_HEAD/g) || [];
    const pinned = body.match(/pinRefToCommit\('FETCH_HEAD'\)/g) || [];
    if (reads.length > 0 && reads.length === pinned.length) {
      pass(`every FETCH_HEAD read in apply() goes through pinRefToCommit (${pinned.length})`);
    } else {
      fail(`apply() reads FETCH_HEAD outside the pin: ${reads.length} occurrence(s), ${pinned.length} pinned`);
    }

    const guardAt = body.indexOf('downgradeRefusal(');
    const firstWrite = Math.min(
      ...[/git\('checkout'/, /gitQuiet\('checkout'/, /unlinkSync\(/, /writeGitignoreAtomic\(/]
        .map((re) => { const m = body.match(re); return m ? body.indexOf(m[0]) : Infinity; }),
    );
    if (guardAt !== -1 && guardAt < firstWrite) {
      pass('the version guard runs before apply() writes its first file');
    } else {
      fail(`version guard is missing or runs after the first write (guard @${guardAt}, write @${firstWrite})`);
    }
  }
}
