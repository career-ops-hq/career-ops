// tests/lock-rm-contention.test.mjs
//
// #2777, the EPERM half. The mkdir side of both locks already treated
// Windows' EPERM/EACCES answers as contention, but every rmSync of a lock
// artifact (the lock dir, the recover guard) was bare — and on windows-latest
// removing a directory another process is touching fails with
// EPERM/EBUSY/ENOTEMPTY, killing the writer and losing its queued item
// (run 32044401225: 2 of 30 concurrent adds died exactly there).
//
// These tests pin three things:
//   1. the contention classifiers agree on the measured Windows codes,
//   2. there is ONE implementation of the protocol, lib/dir-lock.mjs (plus the
//      web's byte-identical copy of it) — and the files that could hold a
//      second one are derived from the repo, not listed here. #2984 patched two files and declared the drift dead; there
//      were four, and the other two carried all three faces of the bug for
//      weeks,
//   3. no bare rmSync of a lock artifact remains in the acquisition path.

import { readFileSync, mkdirSync, existsSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';
import { isMkdirContention, isRmContention, rmLockArtifactSync } from '../lib/dir-lock.mjs';
import { trackedFiles } from '../lib/mjs-files.mjs';

console.log('\n🔒 lock artifacts: rm contention is contention, not death (#2777)');

const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));

const DEFINITION = 'lib/dir-lock.mjs';
// The web bundle cannot import the core (web/next.config.mjs pins its Turbopack
// root to web/), so it carries a copy. A copy is a second body only if it can
// differ, so it is accepted on one condition, checked here as well as in its
// own parity test (web/tests/lib/dir-lock.test.mjs): byte-for-byte identity.
const MIRROR = 'web/src/lib/core/dir-lock.mjs';
const PROTOCOL_FILES = [DEFINITION, MIRROR];

// Every module git ships, minus the suites: test fixtures stamp owner.json by
// hand on purpose, to stage the states the lock must survive.
const shippedCoreModules = () => trackedFiles(ROOT, (rel) => rel.endsWith('.mjs')
  && !rel.startsWith('tests/') && !rel.startsWith('web/tests/') && rel !== 'test-all.mjs')
  .map((abs) => abs.slice(ROOT.length + 1).replace(/\\/g, '/'));

// Comments are stripped first: explaining what the protocol does is not
// implementing it, and a guard that fires on prose gets silenced, not obeyed.
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
const mkErr = (code) => Object.assign(new Error(code), { code });

// ── 1. Classifier tables ─────────────────────────────────────────────
// The codes come from measured windows-latest failures, not speculation:
// EPERM (#2777 both halves), EACCES (mkdir mid-flight), EBUSY/ENOTEMPTY
// (rm of a directory with an open handle inside).
{
  for (const code of ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']) {
    ok(isRmContention(mkErr(code)), `rm ${code} is contention`);
  }
  for (const code of ['EROFS', 'ENOSPC', 'ENOENT']) {
    ok(!isRmContention(mkErr(code)), `rm ${code} is NOT contention (real breakage must still throw)`);
  }
  for (const code of ['EEXIST', 'EPERM', 'EACCES']) {
    ok(isMkdirContention(mkErr(code)), `mkdir ${code} is contention`);
  }
  ok(!isMkdirContention(mkErr('EROFS')), 'mkdir EROFS is NOT contention');
  ok(!isRmContention(undefined) && !isRmContention(null), 'no error object is not contention');
}

// ── 2. rmLockArtifactSync on a real directory ────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'lockrm-'));
  const artifact = join(dir, 'x.lock');
  mkdirSync(artifact);
  ok(rmLockArtifactSync(artifact) === true, 'removing an existing artifact returns true');
  ok(!existsSync(artifact), 'and the artifact is gone');
  ok(rmLockArtifactSync(artifact) === true, 'removing a missing artifact is a quiet success (force semantics)');
  rmSync(dir, { recursive: true, force: true });
}

// ── 3. One implementation of the protocol ────────────────────────
// #2984 patched two files and said "one definition, no sibling drift" — and
// there were four. #3123, #3143 and #5249 then moved the classifiers, the
// recovery verdict, the wait policy and the identity helper into one module,
// and the acquire/release bodies that called them were still five copies that
// had drifted apart (#5358). So the guard is no longer "every copy imports the
// helpers" but "there is no second copy": the protocol is lib/dir-lock.mjs, and
// any other shipped file that pairs a mkdir with an owner.json stamp has an
// acquire loop of its own.
//
// The set is DERIVED from the files git ships, not listed here (lesson #52: a
// hand-kept list ages silently, which is how two of the four copies were missed).
{
  const shipped = shippedCoreModules();
  // A guard that cannot look must never pass: an empty or tiny scan means the
  // walk failed, not that the repository is clean.
  ok(shipped.length > 100, `scanned ${shipped.length} shipped .mjs files (the guard can see the tree)`);

  // Two shapes of lock body. A mkdir paired with an owner.json stamp is this
  // protocol's own shape, written again. An exclusive create ('wx') of a
  // `.lock` file is the older shape: the web's chat store locked that way, with
  // no stale recovery at all, and the mkdir rule could not see it (#5358).
  const lockBodies = shipped.filter((rel) => {
    const src = withoutComments(readFileSync(join(ROOT, rel), 'utf-8'));
    const dirLock = /\bmkdir(?:Sync)?\(/.test(src) && src.includes('owner.json');
    const fileLock = /\b(?:openSync|writeFileSync|open)\([^;]*\.lock[`'"][^;]*['"]wx\+?['"]/.test(src);
    return dirLock || fileLock;
  });
  ok(lockBodies.includes(DEFINITION), `${DEFINITION} is found by the scan (it is the definition)`);
  for (const rel of lockBodies.filter((f) => !PROTOCOL_FILES.includes(f))) {
    fail(`${rel} carries a lock body of its own — use acquireDirLock or tryAcquireDirLockSync from ${DEFINITION} (the web: ${MIRROR})`);
  }
  if (lockBodies.every((f) => PROTOCOL_FILES.includes(f))) {
    pass(`no shipped module outside ${PROTOCOL_FILES.join(' and ')} carries a lock body`);
  }

  // The mirror is only exempt while it IS the definition.
  const definitionBytes = readFileSync(join(ROOT, DEFINITION));
  ok(
    existsSync(join(ROOT, MIRROR)) && readFileSync(join(ROOT, MIRROR)).equals(definitionBytes),
    `${MIRROR} is byte-for-byte ${DEFINITION} (copy the core file across after editing it)`,
  );

  // The scan has to be able to see the shape it exists to forbid. The chat
  // store's own former lock line, which the mkdir rule missed:
  ok(
    /\b(?:openSync|writeFileSync|open)\([^;]*\.lock[`'"][^;]*['"]wx\+?['"]/.test("try { fd = openSync(`${file}.lock`, 'wx', 0o600); }"),
    'the file-lock rule recognizes an O_EXCL .lock file',
  );

  // The recover guard is the protocol's other signature: nothing else in this
  // repo takes a second atomic directory to serialize stale recovery.
  const guardImplementors = shipped.filter((rel) => readFileSync(join(ROOT, rel), 'utf-8').includes('recoverGuardDir'));
  ok(
    guardImplementors.length === PROTOCOL_FILES.length && PROTOCOL_FILES.every((f) => guardImplementors.includes(f)),
    `only ${PROTOCOL_FILES.join(' and ')} implement the recover guard (found: ${guardImplementors.join(', ') || 'none'})`,
  );
}

// ── 3b. "Could not look" is never "recoverable" ──────────────────────
// The third face of #2777: the recovery judgment's stat catch answered `true`
// (recoverable) to EVERY stat failure, so a Windows EPERM on a mid-flight
// directory let a caller delete a live lock created microseconds ago — its
// winner then died with ENOENT writing owner.json. Only ENOENT (genuinely
// vanished) may answer "nothing to recover".
//
// There is exactly ONE place to assert this, which is the point: section 3
// fails on any other copy, so the rule is checked where it is decided.
//
// The verdict is tri-state because "vanished" and "stale" are different answers
// and only one of them licenses a delete: acting on "it was gone when I looked"
// destroys a lock a rival acquirer created in the interim.
{
  const src = readFileSync(join(ROOT, DEFINITION), 'utf-8');
  ok(
    /return err\?\.code === 'ENOENT' \? RECOVER_VANISHED : RECOVER_LIVE;/.test(src),
    `${DEFINITION}: the stat catch answers VANISHED only on ENOENT, never on "could not look"`,
  );
  ok(
    !/return err\?\.code === 'ENOENT';/.test(src),
    `${DEFINITION}: the judgment is a verdict, not a boolean that conflates vanished with stale`,
  );
  ok(
    !/catch\s*\{\s*\n\s*return true;/.test(src),
    `${DEFINITION}: no bare catch{return true} remains in a recovery judgment`,
  );
}

// ── 4. No bare rmSync of a lock artifact in the acquisition path ─────
// The helper is the only code allowed to rm the recover guard or the lock dir
// while acquiring. Release's removal is the injectable `removeLock`, whose
// contention errors release() swallows itself (work is already done by then).
// A bare call anywhere else reintroduces the crash one refactor from now.
{
  const src = readFileSync(join(ROOT, DEFINITION), 'utf-8');
  const guardCalls = [...src.matchAll(/rmSync\(\s*recoverGuardDir\b/g)].length;
  ok(guardCalls === 0, `${DEFINITION}: no bare rmSync(recoverGuardDir) remains (found ${guardCalls})`);
  const lockCalls = [...src.matchAll(/rmSync\(\s*lockDir\b/g)].length;
  ok(lockCalls === 0, `${DEFINITION}: no bare rmSync(lockDir) remains (found ${lockCalls})`);
}
