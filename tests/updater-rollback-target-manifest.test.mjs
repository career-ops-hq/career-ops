/**
 * updater-rollback-target-manifest.test.mjs — BEHAVIORAL coverage for #3780
 * and the CodeRabbit CWE-22 review of #3782.
 *
 * rollback() is ROOT-bound with heavy side effects, so the path list it
 * restores/removes is extracted into rollbackSystemPaths() and driven here,
 * same shape as updater-local-system-edits.test.mjs's pathFullyPreserved
 * cases. Two properties are verified: a file the TARGET release added is not
 * invisible to rollback() just because apply() failed before checking out
 * its own update-system.mjs (#3780); and an unsafe entry in that same
 * remote-controlled target manifest — a declared user-layer path, an
 * absolute path, a `..` traversal segment, or a `.git` path — never reaches
 * rollback()'s checkout/delete loop, whose delete-fallback operates on the
 * raw filesystem path regardless of git tracking state (#3782 review).
 */

import { pass, fail } from './helpers.mjs';
import { rollbackSystemPaths, isSafeManifestPath } from '../update-system.mjs';

const fakeTargetSource = (paths) =>
  `const SYSTEM_PATHS = [\n${paths.map((p) => `  '${p}',`).join('\n')}\n];\n`;

// ── 1. A file the TARGET release added is included via FETCH_HEAD ──
{
  const targetOnlyFile = 'plugins/h1b-sponsor/index.mjs';
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', targetOnlyFile]);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  if (paths.includes(targetOnlyFile)) {
    pass('a file only the TARGET release\'s manifest lists is included (#3780)');
  } else {
    fail(`#1 expected ${targetOnlyFile} in the merged list, got ${JSON.stringify(paths)}`);
  }
}

// ── 2. FETCH_HEAD unreadable degrades to the current manifest, never throws ──
{
  const ctx = { git: () => { throw new Error('no FETCH_HEAD (consumed by a later fetch)'); } };

  let threw = false;
  let paths = null;
  try {
    paths = rollbackSystemPaths(ctx);
  } catch {
    threw = true;
  }
  if (!threw && Array.isArray(paths) && paths.includes('AGENTS.md')) {
    pass('an unreadable FETCH_HEAD degrades to the current manifest instead of throwing');
  } else {
    fail(`#2 threw=${threw} paths=${JSON.stringify(paths)}`);
  }
}

// ── 3. A target predating update-system.mjs (empty SYSTEM_PATHS match) also degrades ──
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return 'this file predates update-system.mjs having a SYSTEM_PATHS array at all\n';
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  if (Array.isArray(paths) && paths.includes('AGENTS.md')) {
    pass('a target with no SYSTEM_PATHS array still returns the current manifest');
  } else {
    fail(`#3 expected the current manifest, got ${JSON.stringify(paths)}`);
  }
}

// ── 4. Entries the current manifest and the target manifest share are not duplicated ──
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', 'modes/pdf.md']);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  const agentsMdCount = paths.filter((p) => p === 'AGENTS.md').length;
  if (agentsMdCount === 1) {
    pass('an entry present in both the current and target manifest appears exactly once');
  } else {
    fail(`#4 expected AGENTS.md exactly once, appeared ${agentsMdCount} times`);
  }
}

// ── isSafeManifestPath: unit coverage (explicit userPaths, hermetic) ──

// ── 5. A declared user-layer path is rejected ──
{
  const result = isSafeManifestPath('cv.md', ['cv.md', 'data/']);
  if (result === false) {
    pass('isSafeManifestPath rejects an exact user-layer path (cv.md)');
  } else {
    fail(`#5 expected false, got ${result}`);
  }
}

// ── 6. A path nested under a declared user-layer directory is rejected ──
{
  const result = isSafeManifestPath('data/applications.md', ['cv.md', 'data/']);
  if (result === false) {
    pass('isSafeManifestPath rejects a path nested under a declared user-layer directory');
  } else {
    fail(`#6 expected false, got ${result}`);
  }
}

// ── 7. An absolute path is rejected ──
{
  const result = isSafeManifestPath('/etc/passwd', []);
  if (result === false) {
    pass('isSafeManifestPath rejects an absolute POSIX path');
  } else {
    fail(`#7 expected false, got ${result}`);
  }
}

// ── 8. A traversal segment is rejected ──
{
  const result = isSafeManifestPath('modes/../../../etc/passwd', []);
  if (result === false) {
    pass('isSafeManifestPath rejects a path containing a ".." segment');
  } else {
    fail(`#8 expected false, got ${result}`);
  }
}

// ── 9. A .git path is rejected ──
{
  const result = isSafeManifestPath('.git/hooks/pre-commit', []);
  if (result === false) {
    pass('isSafeManifestPath rejects a .git path');
  } else {
    fail(`#9 expected false, got ${result}`);
  }
}

// ── 10. A normal system path is accepted ──
{
  const result = isSafeManifestPath('modes/pdf.md', ['cv.md', 'data/']);
  if (result === true) {
    pass('isSafeManifestPath accepts an ordinary system-layer path');
  } else {
    fail(`#10 expected true, got ${result}`);
  }
}

// ── rollbackSystemPaths: integration — an unsafe target-manifest entry
//    never survives the merge, even though it enters via the FETCH_HEAD
//    seam like any legitimate new file would ──

// ── 11. cv.md in the target manifest never reaches the merged result ──
//    The exact regression the CodeRabbit review asked for.
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', 'cv.md']);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  if (!paths.includes('cv.md')) {
    pass('cv.md in the target manifest is dropped before it reaches rollback\'s loop (#3782 review)');
  } else {
    fail(`#11 cv.md leaked into the rollback candidate list: ${JSON.stringify(paths)}`);
  }
}

// ── 12. A traversal entry is dropped; a legitimate sibling entry survives ──
{
  const legitFile = 'plugins/h1b-sponsor/index.mjs';
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', '../../etc/passwd', legitFile]);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  if (!paths.includes('../../etc/passwd') && paths.includes(legitFile)) {
    pass('a traversal entry is dropped while a legitimate sibling entry from the same manifest survives');
  } else {
    fail(`#12 got ${JSON.stringify(paths)}`);
  }
}

// ── 13. A directory root WITHOUT its trailing slash is still caught ──
//    CodeRabbit follow-up: 'data' didn't startsWith('data/'), so the bare
//    directory name slipped past the original check — and rollback()'s own
//    delete step strips a trailing slash right before touching the
//    filesystem, so 'data' and 'data/' are the same target once it gets
//    there. The exact case the review asked for.
{
  const result = isSafeManifestPath('data', ['data/']);
  if (result === false) {
    pass('isSafeManifestPath rejects a protected directory root missing its trailing slash (#3782 follow-up)');
  } else {
    fail(`#13 expected false, got ${result}`);
  }
}

// ── 14. An exact-file entry WITH a spurious trailing slash is still caught ──
//    The mirror-image bypass: 'cv.md/' !== 'cv.md' under a bare exact-match
//    comparison. The exact case the review asked for.
{
  const result = isSafeManifestPath('cv.md/', ['cv.md']);
  if (result === false) {
    pass('isSafeManifestPath rejects an exact user-layer file with a spurious trailing slash (#3782 follow-up)');
  } else {
    fail(`#14 expected false, got ${result}`);
  }
}

// ── 15. Multiple trailing slashes are normalized too, not just one ──
{
  const result = isSafeManifestPath('data///', ['data/']);
  if (result === false) {
    pass('isSafeManifestPath rejects a directory root with multiple trailing slashes');
  } else {
    fail(`#15 expected false, got ${result}`);
  }
}

// ── 16. rollbackSystemPaths integration: a bare 'data' target-manifest
//    entry never reaches the merged result ──
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', 'data']);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
  };

  const paths = rollbackSystemPaths(ctx);
  if (!paths.includes('data')) {
    pass('a bare directory-root entry (no trailing slash) is dropped before it reaches rollback\'s loop');
  } else {
    fail(`#16 'data' leaked into the rollback candidate list: ${JSON.stringify(paths)}`);
  }
}

// ── 17. A leading "./" alias for an exact user-layer file is still caught ──
//    CodeRabbit follow-up: path.join(ROOT, './cv.md') resolves to the exact
//    same file as path.join(ROOT, 'cv.md') once rollback() actually touches
//    the filesystem, but a raw string comparison saw them as different.
{
  const result = isSafeManifestPath('./cv.md', ['cv.md']);
  if (result === false) {
    pass('isSafeManifestPath rejects a "./" alias for an exact user-layer file (#3782 follow-up)');
  } else {
    fail(`#17 expected false, got ${result}`);
  }
}

// ── 18. A doubled internal slash alias for a user-layer file is still caught ──
{
  const result = isSafeManifestPath('modes//_profile.md', ['modes/_profile.md']);
  if (result === false) {
    pass('isSafeManifestPath rejects a doubled-internal-slash alias for a user-layer file (#3782 follow-up)');
  } else {
    fail(`#18 expected false, got ${result}`);
  }
}

// ── 19. A "./" alias for a protected directory root is still caught ──
{
  const result = isSafeManifestPath('./data/applications.md', ['data/']);
  if (result === false) {
    pass('isSafeManifestPath rejects a "./" alias for a path under a protected directory');
  } else {
    fail(`#19 expected false, got ${result}`);
  }
}

// ── 20. rollbackSystemPaths integration: a "./cv.md" target-manifest entry
//    never reaches the merged result — a fixed userPaths fixture is injected
//    via ctx so the test doesn't depend on the developer's real
//    config/local-paths.txt (CodeRabbit follow-up: the default
//    effectiveUserPaths() read here made this test's outcome depend on
//    local, developer-specific state unrelated to the code under test) ──
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', './cv.md', 'modes//_profile.md']);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
    userPaths: ['cv.md', 'modes/_profile.md', 'data/'],
  };

  const paths = rollbackSystemPaths(ctx);
  if (!paths.includes('./cv.md') && !paths.includes('modes//_profile.md')) {
    pass('"./cv.md" and "modes//_profile.md" target-manifest entries never reach the merged result');
  } else {
    fail(`#20 an alias leaked into the rollback candidate list: ${JSON.stringify(paths)}`);
  }
}

// ── isSafeManifestPath: case-insensitivity coverage (CodeRabbit follow-up on
//    #3782) — macOS (APFS default) and Windows (NTFS default) are
//    case-insensitive filesystems, so a manifest entry differing only in
//    case resolves to the exact same file the checkout/delete loop would
//    touch, even though a case-sensitive comparison sees a different string.
//    pathSegments() folds case once at the point segments are produced, so
//    both the .git check and the user-path check inherit the fix from a
//    single change. ──

// ── 21. A case-variant .git path is rejected ──
{
  const result = isSafeManifestPath('.GIT/hooks/pre-commit', []);
  if (result === false) {
    pass('isSafeManifestPath rejects a case-variant .git path (.GIT/)');
  } else {
    fail(`#21 expected false, got ${result}`);
  }
}

// ── 22. A case-variant exact user-layer path is rejected ──
{
  const result = isSafeManifestPath('CV.md', ['cv.md']);
  if (result === false) {
    pass('isSafeManifestPath rejects a case-variant exact user-layer path (CV.md)');
  } else {
    fail(`#22 expected false, got ${result}`);
  }
}

// ── 23. A case-variant protected directory root is rejected ──
{
  const result = isSafeManifestPath('DATA/applications.md', ['data/']);
  if (result === false) {
    pass('isSafeManifestPath rejects a path nested under a case-variant protected directory (DATA/)');
  } else {
    fail(`#23 expected false, got ${result}`);
  }
}

// ── 24. rollbackSystemPaths integration: a case-variant target-manifest
//    entry (CV.MD) never reaches the merged result ──
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', 'CV.MD']);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
    userPaths: ['cv.md', 'data/'],
  };

  const paths = rollbackSystemPaths(ctx);
  if (!paths.includes('CV.MD')) {
    pass('a case-variant target-manifest entry (CV.MD) is dropped before it reaches rollback\'s loop');
  } else {
    fail(`#24 'CV.MD' leaked into the rollback candidate list: ${JSON.stringify(paths)}`);
  }
}

// ── isSafeManifestPath: Unicode normalization coverage (CodeRabbit follow-up
//    on #3782) — a single visual character can have more than one valid
//    Unicode spelling: an accented letter as one precomposed codepoint (NFC)
//    versus the base letter plus a combining mark (NFD). Some filesystems
//    normalize on write, so a manifest entry spelled one way can resolve to
//    the exact same file as a protected path spelled the other way, even
//    though a raw code-unit comparison sees different strings.
//    pathSegments() now normalizes to NFC before lowercasing, so both
//    directions collapse to the same segment. ──

// Built from explicit code points, not typed accented characters, so the two
// spellings are guaranteed byte-distinct regardless of editor/source encoding.
const nfc = `caf${String.fromCodePoint(0xe9)}.md`;             // precomposed 'e-acute' (U+00E9)
const nfd = `caf${String.fromCodePoint(0x65, 0x301)}.md`;      // 'e' (U+0065) + combining acute accent (U+0301)
if (nfc === nfd || nfc.normalize('NFC') !== nfd.normalize('NFC')) {
  fail(`Unicode test fixtures are wrong: nfc=${JSON.stringify(nfc)} nfd=${JSON.stringify(nfd)}`);
}

// ── 25. An NFD-spelled candidate is rejected against an NFC-declared user path ──
{
  const result = isSafeManifestPath(nfd, [nfc]);
  if (result === false) {
    pass('isSafeManifestPath rejects an NFD-spelled path matching an NFC-declared user-layer path');
  } else {
    fail(`#25 expected false, got ${result}`);
  }
}

// ── 26. An NFC-spelled candidate is rejected against an NFD-declared user path ──
//    The mirror direction — either side of the comparison could be the one
//    spelled differently, since the declaration and the target manifest are
//    independent sources.
{
  const result = isSafeManifestPath(nfc, [nfd]);
  if (result === false) {
    pass('isSafeManifestPath rejects an NFC-spelled path matching an NFD-declared user-layer path');
  } else {
    fail(`#26 expected false, got ${result}`);
  }
}

// ── 27. rollbackSystemPaths integration: an NFD-spelled target-manifest
//    entry matching an NFC-declared user path never reaches the merged result ──
{
  const ctx = {
    git: (...args) => {
      if (args[0] === 'show' && args[1] === 'FETCH_HEAD:update-system.mjs') {
        return fakeTargetSource(['AGENTS.md', nfd]);
      }
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    },
    userPaths: [nfc, 'data/'],
  };

  const paths = rollbackSystemPaths(ctx);
  if (!paths.includes(nfd)) {
    pass('an NFD-spelled target-manifest entry is dropped before it reaches rollback\'s loop (NFC-declared user path)');
  } else {
    fail(`#27 an NFD/NFC alias leaked into the rollback candidate list: ${JSON.stringify(paths)}`);
  }
}
