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
//   2. EVERY copy of the protocol shares ONE definition — and the set of copies
//      is derived from the repo, not listed here. #2984 patched two files and
//      declared the drift dead; there were four, and the other two carried all
//      three faces of the bug for weeks,
//   3. no bare rmSync of a lock artifact remains in any acquisition path.

import { readFileSync, readdirSync, mkdirSync, existsSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pass, fail, ROOT } from './helpers.mjs';
import { isMkdirContention, isRmContention, rmLockArtifactSync } from '../pipeline-lock.mjs';

console.log('\n🔒 lock artifacts: rm contention is contention, not death (#2777)');

const ok = (cond, msg) => (cond ? pass(msg) : fail(msg));

// Quién implementa el protocolo se PREGUNTA al repo, nunca se escribe aquí: una
// lista a mano envejece en silencio y así es como #2984 arregló dos copias
// creyendo que eran todas. La firma es `recoverGuardDir`, el segundo directorio
// atómico que no usa ningún otro código de este repo.
const protocolImplementors = () => readdirSync(ROOT)
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => readFileSync(join(ROOT, f), 'utf-8').includes('recoverGuardDir'));
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

// ── 3. One definition, EVERY copy of the protocol ────────────────────
// The list is DERIVED, not written down. #2984 patched two files and said "one
// definition, no sibling drift" — and there were four. followup-seed.mjs and
// portal-health-lock.mjs had been carrying all three faces of #2777 the whole
// time, invisible because nobody had asked the repo how many copies there were.
// A hand-kept list would have aged the same way (lesson #52): so the test asks.
//
// The signature of the protocol is `recoverGuardDir`, the second atomic guard
// no other code in this repo uses. Any file that has one is implementing this
// lock and must derive the classifiers rather than re-deriving the rules.
{
  const implementors = protocolImplementors();

  ok(implementors.length >= 2, `found ${implementors.length} files implementing the lock protocol (${implementors.join(', ')})`);
  ok(implementors.includes('pipeline-lock.mjs'), 'pipeline-lock.mjs is among them (it is the definition)');

  for (const file of implementors.filter((f) => f !== 'pipeline-lock.mjs')) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    ok(
      /import\s*\{[^}]*isMkdirContention[^}]*\}\s*from\s*'\.\/pipeline-lock\.mjs'/.test(src),
      `${file} imports the contention classifiers from pipeline-lock`,
    );
    ok(
      !/function isMkdirContention/.test(src) && !/function isRmContention/.test(src),
      `${file} defines no second copy of the classifiers`,
    );
    ok(
      !/if\s*\([^)]*code\s*!==\s*'EEXIST'\)\s*throw/.test(src),
      `${file} does not treat a non-EEXIST mkdir answer as fatal (Windows says EPERM under contention)`,
    );
    ok(
      /import\s*\{[^}]*lockRecoveryVerdict[^}]*\}\s*from\s*'\.\/pipeline-lock\.mjs'/.test(src),
      `${file} imports the recovery judgment from pipeline-lock`,
    );
    ok(
      !/function lockCanRecover/.test(src) && !/function lockRecoveryVerdict/.test(src),
      `${file} defines no second copy of the recovery judgment`,
    );
  }
}

// ── 3b. "Could not look" is never "recoverable" ──────────────────────
// The third face of #2777: the recovery judgment's stat catch answered `true`
// (recoverable) to EVERY stat failure, so a Windows EPERM on a mid-flight
// directory let a caller delete a live lock created microseconds ago — its
// winner then died with ENOENT writing owner.json. Only ENOENT (genuinely
// vanished) may answer "nothing to recover"; both locks must carry the guard.
//
// There is now exactly ONE place to assert this, which is the point: section 3
// requires every other implementor to import the judgment rather than carry a
// copy, so the rule is checked where it is decided instead of four times over.
// Four correct copies were never the goal — #2984 asked for one definition, and
// a repo that merely keeps its copies in agreement is one patch away from the
// drift that produced all three faces of #2777.
//
// The verdict is tri-state because "vanished" and "stale" are different answers
// and only one of them licenses a delete: acting on "it was gone when I looked"
// destroys a lock a rival acquirer created in the interim.
{
  const src = readFileSync(join(ROOT, 'pipeline-lock.mjs'), 'utf-8');
  ok(
    /return err\?\.code === 'ENOENT' \? RECOVER_VANISHED : RECOVER_LIVE;/.test(src),
    'pipeline-lock.mjs: the stat catch answers VANISHED only on ENOENT, never on "could not look"',
  );
  ok(
    !/return err\?\.code === 'ENOENT';/.test(src),
    'pipeline-lock.mjs: the judgment is a verdict, not a boolean that conflates vanished with stale',
  );
  for (const file of protocolImplementors()) {
    ok(
      !/catch\s*\{\s*\n\s*return true;/.test(readFileSync(join(ROOT, file), 'utf-8')),
      `${file}: no bare catch{return true} remains in a recovery judgment`,
    );
  }
}

// ── 4. No bare rmSync of a lock artifact in either acquisition path ──
// The helper is the only code allowed to rmSync the recover guard, and the
// only permitted direct rmSync(lockDir) is pipeline-lock's release(), which
// wraps it in its own deliberate swallow-everything catch (work is already
// done by then). A bare call anywhere else reintroduces the crash one
// refactor from now.
{
  for (const file of protocolImplementors()) {
    const src = readFileSync(join(ROOT, file), 'utf-8');
    const guardCalls = [...src.matchAll(/rmSync\(\s*recoverGuardDir\b/g)].length;
    ok(guardCalls === 0, `${file}: no bare rmSync(recoverGuardDir) remains (found ${guardCalls})`);
    const lockCalls = [...src.matchAll(/rmSync\(\s*lockDir\b/g)].length;
    const permitido = file === 'pipeline-lock.mjs' ? 1 : 0;  // release() de pipeline-lock lleva su propio catch deliberado
    ok(lockCalls <= permitido, `${file}: bare rmSync(lockDir) within budget (found ${lockCalls}, allowed ${permitido})`);
  }
}
