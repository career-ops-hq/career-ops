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
import {
  gitIn, pinRefToCommit, pinInheritedTarget, versionAtRef, downgradeRefusal,
  isComparableVersion, targetIdentityRefusal, refusalMessage,
  authoritativeShaFromRefBody, refspecForTarget,
} from '../update-system.mjs';

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

  // An inherited target skips the identity check, so it must be the parent's
  // exact SHA. rev-parse alone resolves any commit-ish: `HEAD~1` pins cleanly
  // (the control below), which is exactly what the inherited pin must refuse.
  if (pinRefToCommit('HEAD~1', ctx) === older) {
    pass('control: pinRefToCommit resolves a relative commit-ish, so it cannot vet an inherited SHA');
  } else {
    fail('control failed: pinRefToCommit did not resolve HEAD~1');
  }
  for (const value of ['HEAD~1', 'refs/heads/main', older.slice(0, 12), older.toUpperCase()]) {
    let refused = false;
    try { pinInheritedTarget(value, ctx); } catch (e) { refused = /not a commit SHA/.test(e.message); }
    if (refused) {
      pass(`pinInheritedTarget refuses ${JSON.stringify(value.length > 20 ? `${value.slice(0, 12)}…` : value)} instead of resolving it`);
    } else {
      fail(`pinInheritedTarget accepted a non-SHA inherited target: ${JSON.stringify(value)}`);
    }
  }
  if (pinInheritedTarget(older, ctx) === older) {
    pass('pinInheritedTarget returns a full SHA that exists locally unchanged');
  } else {
    fail('pinInheritedTarget did not return the inherited SHA');
  }
  let missing = false;
  try { pinInheritedTarget('0'.repeat(40), quietCtx); } catch { missing = true; }
  if (missing) {
    pass('pinInheritedTarget still throws for a well-formed SHA the object store does not have');
  } else {
    fail('pinInheritedTarget accepted a SHA that does not exist locally');
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

// ── 2b. downgradeRefusal must not be fooled by a version it cannot parse ──
// compareVersions() is the NOTIFY helper: Number() with `|| 0` and a loop that
// stops at three components. Every string below therefore compares as "at least
// as new as installed" while having been understood by nobody. Deciding to
// overwrite an installation on that basis is failing open.
{
  const installed = '1.32.0';
  const unparseable = [
    ['999.bad.0', 'a non-numeric component coerced to 0'],
    ['999.0.0-rc', 'a prerelease suffix silently dropped'],
    ['1.32.0.1', 'a fourth component never compared'],
    ['v1.33.0', 'a leading v the comparison cannot read'],
    ['1.32', 'a two-component version'],
  ];
  const leaked = unparseable.filter(([v]) => downgradeRefusal(installed, v) === null);
  if (leaked.length === 0) {
    pass(`every unparseable target VERSION is refused (${unparseable.length} shapes)`);
  } else {
    fail(`unparseable target VERSION(s) accepted: ${leaked.map(([v]) => v).join(', ')}`);
  }

  // The reason has to name the shape, or the user cannot tell this refusal from
  // a genuine downgrade and will "fix" the wrong thing.
  const reason = downgradeRefusal(installed, '999.bad.0') || '';
  if (/not a comparable/.test(reason) && reason.includes('999.bad.0')) {
    pass('the refusal says the target VERSION is unparseable, not that it is older');
  } else {
    fail(`unhelpful refusal reason: ${JSON.stringify(reason)}`);
  }

  // Same argument on the installed side: a direction computed from a string
  // nobody could parse is not a direction.
  if (downgradeRefusal('1.32.0.1', '1.33.0')) {
    pass('an unparseable INSTALLED version is refused too, not compared as 1.32.0');
  } else {
    fail('an unparseable installed version was compared anyway');
  }

  // Control: the shapes career-ops actually ships stay allowed, so the
  // validator is a filter and not a blanket refusal.
  if (isComparableVersion('1.32.0') && downgradeRefusal('1.32.0', '1.33.0') === null) {
    pass('control: a real release version is still accepted');
  } else {
    fail('the shape check rejects a legitimate version');
  }
}

// ── 2c. targetIdentityRefusal: the target must BE upstream main ──
// #3052's expected-behaviour item 1, and the axis the version guard cannot
// cover: an older auto-followed tag, or any side branch, can ship a VERSION at
// or above the installed one and pass the downgrade check untouched.
{
  const { dir, g, ctx, quietCtx } = makeRepo('co-3052-identity-');

  writeFixture(dir, 'VERSION', '1.32.0\n');
  g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');

  writeFixture(dir, 'VERSION', '1.33.0\n');
  g('add', '-A'); g('commit', '-qm', 'main advances');
  const advanced = g('rev-parse', 'HEAD');

  // A tag on an OLDER commit that ships a VERSION the downgrade guard is happy
  // with — the shape of the rogue target the version check alone lets through.
  g('checkout', '-q', '-b', 'side', base);
  writeFixture(dir, 'VERSION', '9.9.9\n');
  g('add', '-A'); g('commit', '-qm', 'rogue 9.9.9');
  const rogue = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'main');

  if (targetIdentityRefusal(advanced, advanced, 'refs/heads/main', ctx) === null) {
    pass('the target that IS the authoritative commit is accepted');
  } else {
    fail('an exact match with upstream main was refused');
  }

  // main moved between the API read and the fetch: the fetched tip descends
  // from the authoritative commit and is still the requested branch.
  if (targetIdentityRefusal(advanced, base, 'refs/heads/main', ctx) === null) {
    pass('a target that descends from the authoritative commit is accepted (main advanced mid-run)');
  } else {
    fail('a legitimate newer tip of main was refused');
  }

  // The #3052 shape: authoritative main is AHEAD of the target, so the target
  // is a stale or foreign tree no matter what VERSION it ships.
  const rogueRefusal = targetIdentityRefusal(rogue, advanced, 'refs/heads/main', quietCtx);
  if (rogueRefusal && rogueRefusal.includes(rogue.slice(0, 12))) {
    pass('a target upstream main does not descend into is refused, VERSION notwithstanding');
  } else {
    fail(`the rogue target was accepted (got: ${JSON.stringify(rogueRefusal)})`);
  }
  // Two-sided: that same rogue target sails through the version guard, which is
  // precisely why the identity check has to exist.
  if (downgradeRefusal('1.32.0', versionAtRef(rogue, ctx)) === null) {
    pass('control: the downgrade guard alone would have installed the rogue target');
  } else {
    fail('control failed: the rogue target was expected to pass the version guard');
  }

  // A commit the local object store has never heard of cannot be vouched for.
  const unknown = '0'.repeat(40);
  if (targetIdentityRefusal(advanced, unknown, 'refs/heads/main', quietCtx)) {
    pass('an authoritative SHA absent from the object store is a refusal, not a pass');
  } else {
    fail('an unresolvable authoritative SHA was treated as agreement');
  }

  // No authoritative answer is not a claim about any commit. It must not
  // manufacture a refusal either: a GitHub rate limit is not a rogue target.
  let calls = 0;
  const spy = { git: () => { calls++; throw new Error('unexpected git call'); } };
  if (targetIdentityRefusal(advanced, '', 'refs/heads/main', spy) === null && calls === 0) {
    pass('an unavailable authoritative SHA yields no verdict, and costs no git call');
  } else {
    fail(`an empty authoritative SHA produced a verdict (calls=${calls})`);
  }

  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// ── 2c-ter. the default release channel: identity is checked against the TAG ──
// apply() now installs the latest release tag by default and main only on
// `--channel main` (#3845). The identity guard must follow: against main's tip a
// release tag is an ANCESTOR, which is exactly the shape the guard refuses, so
// comparing a release install to main would refuse every default update. The
// fetch and the authoritative read both go through refspecForTarget(), and the
// guard compares against the ref that was requested.
{
  const mapping = [
    ['main', 'refs/heads/main'],
    ['career-ops-v1.34.0', 'refs/tags/career-ops-v1.34.0'],
  ];
  const wrong = mapping.filter(([ref, want]) => refspecForTarget(ref) !== want);
  if (wrong.length === 0) {
    pass('main and a release tag map to their full refspecs');
  } else {
    fail(`refspecForTarget mapped wrongly: ${JSON.stringify(wrong)}`);
  }
  // resolveTargetRef() only ever yields those two shapes; anything else is not
  // something to fetch, including the `web-v*` sibling component's tags.
  const refused = ['web-v0.10.0', 'career-ops-vpreview-v1.32.0', 'refs/heads/main', 'feature', ''].filter((ref) => {
    try { refspecForTarget(ref); return false; } catch { return true; }
  });
  if (refused.length === 5) {
    pass('a ref that is neither main nor a career-ops release tag is refused, not fetched');
  } else {
    fail(`refspecForTarget accepted a ref it should refuse (refused ${refused.length}/5)`);
  }

  const { dir, g, ctx, quietCtx } = makeRepo('co-3052-release-');
  writeFixture(dir, 'VERSION', '1.33.0\n');
  g('add', '-A'); g('commit', '-qm', 'release 1.33.0');
  g('tag', 'career-ops-v1.33.0');
  const older = g('rev-parse', 'HEAD');
  writeFixture(dir, 'VERSION', '1.34.0\n');
  g('add', '-A'); g('commit', '-qm', 'release 1.34.0');
  g('tag', '-a', '-m', 'annotated', 'career-ops-v1.34.0');
  const tagged = g('rev-parse', 'HEAD');
  const tagObject = g('rev-parse', 'career-ops-v1.34.0');
  writeFixture(dir, 'VERSION', '1.35.0\n');
  g('add', '-A'); g('commit', '-qm', 'main moves on past the release');
  const mainTip = g('rev-parse', 'HEAD');
  const tagRefspec = refspecForTarget('career-ops-v1.34.0');

  if (targetIdentityRefusal(tagged, tagged, tagRefspec, ctx) === null) {
    pass('a release target that IS the tag commit is accepted');
  } else {
    fail('the requested release tag was refused against itself');
  }
  // The pre-rebase wiring, stated as a control: checked against main's tip, a
  // correct release install reads as "does not descend" and would be refused.
  if (targetIdentityRefusal(tagged, mainTip, 'refs/heads/main', quietCtx)) {
    pass('control: comparing a release target to main would refuse it, which is why the refspec follows the channel');
  } else {
    fail('control failed: a release tag was expected to be refused against main');
  }
  // GitHub's ref API names the TAG OBJECT for an annotated tag. merge-base
  // peels it, so the answer is still "this is the requested release".
  if (tagObject !== tagged && targetIdentityRefusal(tagged, tagObject, tagRefspec, ctx) === null) {
    pass('an annotated tag object from the ref API is peeled and accepted');
  } else {
    fail(`an annotated tag's object name was refused (tagObject=${tagObject.slice(0, 12)})`);
  }
  // The #3052 shape on this channel: FETCH_HEAD holds an older release than the
  // one requested. Refused, and the reason names the release that was asked for.
  const olderRefusal = targetIdentityRefusal(older, tagged, tagRefspec, quietCtx) || '';
  if (olderRefusal.includes(older.slice(0, 12)) && olderRefusal.includes('career-ops-v1.34.0')) {
    pass('an older release standing in for the requested one is refused, naming the requested tag');
  } else {
    fail(`an older release passed as the requested tag (got: ${JSON.stringify(olderRefusal)})`);
  }

  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// ── 2c-bis. a ref-API body that parses but says nothing must not be quoted ──
// The authoritative SHA is a string the far side chose. A body can parse as JSON
// and still carry no commit — a proxied error page, a truncated response, a
// captive portal. Before the shape check, `object.sha` went to
// targetIdentityRefusal() verbatim; git cannot resolve it, throws, and the catch
// reports "does not descend from upstream main". That is a claim about the
// TARGET made on the strength of a value that described nothing, and it sends
// the user to look at a tree that was never actually examined. The truthful
// outcome is the no-claim one that offline and rate-limited runs already take.
{
  const bodies = [
    ['not-a-sha', 'a plain non-SHA string'],
    ['<html><body>403 Forbidden</body></html>', 'an HTML error page in the sha field'],
    ['abc123', 'a short hex string that is not a full object name'],
    ['0'.repeat(39), 'a 39-hex near-miss'],
    ['0'.repeat(41), 'a 41-hex near-miss'],
    ['A'.repeat(40), 'uppercase hex, which is not what git rev-parse emits'],
    ['  ', 'whitespace'],
  ];

  const leaked = bodies.filter(
    ([sha]) => authoritativeShaFromRefBody(JSON.stringify({ object: { sha } })) !== '',
  );
  if (leaked.length === 0) {
    pass(`every ref-API body carrying a non-SHA reads as "no answer" (${bodies.length} shapes)`);
  } else {
    fail(`non-SHA object.sha values survived the shape check: ${leaked.map(([s]) => JSON.stringify(s)).join(', ')}`);
  }

  // The two properties the fix is actually for, asserted end to end through the
  // consumer: the verdict is the no-claim one, and git is never reached at all —
  // so the guard is proven to stop the value BEFORE merge-base sees it, rather
  // than rewording a refusal after the fact.
  const calls = [];
  const spy = { git: (...args) => { calls.push(args); throw new Error('git should never have been called'); } };
  const target = 'a'.repeat(40);
  const parsedButUseless = authoritativeShaFromRefBody(JSON.stringify({ object: { sha: 'not-a-sha' } }));
  const verdict = targetIdentityRefusal(target, parsedButUseless, 'refs/heads/main', spy);

  if (verdict === null) {
    pass('a body that parses but carries no commit yields no identity verdict, not a false "does not descend"');
  } else {
    fail(`a non-SHA authoritative value produced a verdict about the target: ${JSON.stringify(verdict)}`);
  }
  if (calls.length === 0) {
    pass('merge-base is never invoked for a non-SHA authoritative value');
  } else {
    fail(`git was called with an unresolvable value: ${JSON.stringify(calls)}`);
  }

  // The regression this replaces, stated as the control: feeding the RAW field
  // (what the code did before the shape check) does reach merge-base and does
  // produce the untrue sentence. Without this, the two assertions above would
  // still pass if the whole identity guard were deleted.
  const rawCalls = [];
  const rawSpy = { git: (...args) => { rawCalls.push(args); throw new Error('fatal: Not a valid object name'); } };
  const rawVerdict = targetIdentityRefusal(target, 'not-a-sha', 'refs/heads/main', rawSpy);
  if (rawCalls.length === 1 && /does not descend from upstream main/.test(rawVerdict || '')) {
    pass('control: the unchecked value would have reached merge-base and produced the untrue refusal');
  } else {
    fail(`control failed: the pre-fix path no longer misbehaves (calls=${rawCalls.length}, verdict=${JSON.stringify(rawVerdict)})`);
  }

  // Filter, not blanket rejection: a real ref-API body still yields its commit,
  // and a body that does not parse at all keeps its existing '' answer.
  const real = 'd'.repeat(40);
  if (authoritativeShaFromRefBody(JSON.stringify({ object: { sha: real, type: 'commit' } })) === real) {
    pass('control: a genuine ref-API body still yields its commit SHA');
  } else {
    fail('the shape check rejects a legitimate ref-API body');
  }
  if (authoritativeShaFromRefBody('<html>502</html>') === '' && authoritativeShaFromRefBody('{}') === '') {
    pass("an unparseable body and a body with no object still read as '' (unchanged)");
  } else {
    fail('the malformed-body path regressed');
  }
}

// ── 2d. refusalMessage tells the truth about what is on disk ──
// The parent refuses before its first write. The child refuses AFTER the parent
// checked the self-bootstrap closure out from the very target being refused, so
// the parent's "No system files were changed" is false there.
{
  const parent = refusalMessage('a'.repeat(40), 'reason here', false);
  const child = refusalMessage('a'.repeat(40), 'reason here', true);
  if (/No system files were changed/.test(parent)) {
    pass('the parent refusal says no system files were changed');
  } else {
    fail('the parent refusal lost its no-files-changed statement');
  }
  if (!/No system files were changed/.test(child) && /self-bootstrap files/.test(child)) {
    pass('the re-exec refusal does not claim an untouched tree, and names what was written');
  } else {
    fail(`the re-exec refusal still claims nothing was changed: ${JSON.stringify(child)}`);
  }
  if (parent.includes('aaaaaaaaaaaa') && parent.includes('reason here')) {
    pass('the refusal names the target and the reason');
  } else {
    fail('the refusal dropped the target SHA or the reason');
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

    const firstWrite = Math.min(
      ...[/git\('checkout'/, /gitQuiet\('checkout'/, /unlinkSync\(/, /writeGitignoreAtomic\(/]
        .map((re) => { const m = body.match(re); return m ? body.indexOf(m[0]) : Infinity; }),
    );

    // Presence and ordering are not enough. `downgradeRefusal(...)` can appear
    // in the right place and still decide nothing: `if (false && refusal)`
    // keeps every assertion in this file green while the guard is inert. Pin
    // the whole statement — the operand it reads, the condition, and the throw.
    const guardShape = /const targetVersion = versionAtRef\(targetCommit\);\s*\n\s*const refusal = downgradeRefusal\(local, targetVersion\);\s*\n\s*if \(refusal\) \{\s*\n\s*throw new Error\(refusalMessage\(targetCommit, refusal, isReexec\)\);\s*\n\s*\}/;
    const guardMatch = body.match(guardShape);
    if (guardMatch && body.indexOf(guardMatch[0]) < firstWrite) {
      pass('the version guard reads the PINNED target, throws on refusal, and runs before the first write');
    } else {
      fail(`the version guard is missing, reads the wrong ref, or does not abort (matched=${Boolean(guardMatch)}, write @${firstWrite})`);
    }

    // `versionAtRef('HEAD')` compares the installed tree with itself and always
    // returns null. It is the mutant that survives every behavioural test here,
    // because apply() is not callable from a test, so pin it explicitly.
    const versionReads = body.match(/versionAtRef\([^)]*\)/g) || [];
    if (versionReads.length === 1 && versionReads[0] === 'versionAtRef(targetCommit)') {
      pass('apply() reads the target VERSION only from the pinned target');
    } else {
      fail(`apply() reads versionAtRef with the wrong argument: ${JSON.stringify(versionReads)}`);
    }

    // Identity is a separate axis from direction, and must also precede writes.
    const identityShape = /const identity = targetIdentityRefusal\(targetCommit,\s*authoritativeCommit,\s*targetRefspec\);\s*\n\s*if \(identity\) throw new Error\(/;
    const identityMatch = body.match(identityShape);
    if (identityMatch && body.indexOf(identityMatch[0]) < firstWrite) {
      pass('the identity guard consumes the authoritative SHA and aborts before the first write');
    } else {
      fail('apply() does not cross-check the pinned target against the authoritative SHA before writing');
    }

    // The inherited SHA skips the identity check, so it must be trusted exactly
    // as far as the inherited ref is (#3845's trustsEnvTargetRef gate), and no
    // further: isReexec also admits a bare CAREER_OPS_UPDATE_REEXEC=1 plus
    // --confirm, which proves nothing about a parent.
    if (/const inheritedTarget = trustsEnvTargetRef\(authenticatedReexec,\s*legacyReexec\)\s*\n?\s*\? \(process\.env\.CAREER_OPS_UPDATE_TARGET_SHA \|\| ''\)/.test(body)) {
      pass('the inherited target SHA is read only under the same trust gate as the inherited ref');
    } else {
      fail('CAREER_OPS_UPDATE_TARGET_SHA is read under a weaker gate than CAREER_OPS_UPDATE_TARGET_REF');
    }

    if (/inheritedTarget\s*\n?\s*\? pinInheritedTarget\(inheritedTarget\)/.test(body)) {
      pass('apply() pins an inherited target through the SHA-only pin');
    } else {
      fail('apply() resolves CAREER_OPS_UPDATE_TARGET_SHA with a pin that accepts any commit-ish');
    }

    // The pin must have no fallback. A child that cannot resolve the SHA its
    // parent verified is already running bootstrap files checked out FROM that
    // SHA; re-pinning its own FETCH_HEAD there assembles the install from two
    // trees, which is the mixed state #3052 reports.
    const pinStart = body.indexOf('const inheritedTarget');
    const pinEnd = body.indexOf('const targetVersion');
    const pinRegion = pinStart !== -1 && pinEnd > pinStart ? body.slice(pinStart, pinEnd) : '';
    if (pinRegion && !/\bcatch\b/.test(pinRegion)) {
      pass('an unresolvable target ends the run instead of falling back to a second pin');
    } else {
      fail('the target pin still has a fallback path (a catch between the pin and the guard)');
    }
  }
}
