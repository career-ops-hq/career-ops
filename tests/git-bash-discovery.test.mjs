// tests/git-bash-discovery.test.mjs — find the Git Bash that belongs to the git
// on PATH, instead of only the two install roots we happen to know.
//
// getBash() probes `C:\Program Files\Git\{bin,usr\bin}\bash.exe` and the Scoop
// equivalents, then falls back to whatever `bash` resolves to on PATH. That
// fallback is a different shell from a different install: on a machine whose Git
// lives elsewhere (D:\Git, a portable Git, an MSYS2 root) every section that
// spawns a subprocess can report a failure caused by the shell, with a warning
// the runner has to print to say so (#2344 took the Scoop case).
//
// `git --exec-path` answers "where is the git on PATH installed" directly, and
// the same install's bash is two levels up from it. Deriving the candidates is
// also what keeps `cygpath` co-located: mixing installs is the #1409 hazard the
// resolver already documents.
//
// Run:  node --test tests/git-bash-discovery.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bashCandidatesFromGitExecPath, cygpathCandidates, cygpathCandidatesForGitRoot, firstProbeable, getBash, gitRootOfBash, windowsBashCandidates } from './helpers.mjs';

test('a Git for Windows exec-path yields that install\'s bash, the real shell before the launcher', () => {
  assert.deepEqual(
    bashCandidatesFromGitExecPath('C:/Program Files/Git/mingw64/libexec/git-core'),
    ['C:/Program Files/Git/usr/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'],
  );
  assert.deepEqual(
    bashCandidatesFromGitExecPath('D:/Git/mingw64/libexec/git-core'),
    ['D:/Git/usr/bin/bash.exe', 'D:/Git/bin/bash.exe'],
  );
});

test('the older layout without mingw64 is understood too', () => {
  assert.deepEqual(
    bashCandidatesFromGitExecPath('C:/Program Files/Git/libexec/git-core'),
    ['C:/Program Files/Git/usr/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'],
  );
});

test('a trailing separator, backslashes, and a lowercase drive all resolve', () => {
  assert.deepEqual(
    bashCandidatesFromGitExecPath(String.raw`d:\Git\mingw64\libexec\git-core` + '\\'),
    ['d:/Git/usr/bin/bash.exe', 'd:/Git/bin/bash.exe'],
  );
});

test('a path that is not a Windows git install yields nothing rather than a guess', () => {
  for (const value of ['', '   ', undefined, null, '/usr/lib/git-core', 'D:/Git/mingw64/bin', 'relative/path']) {
    assert.deepEqual(bashCandidatesFromGitExecPath(value), [], `must not invent a root for ${JSON.stringify(value)}`);
  }
});

// ── cygpath must come from the same install as the bash ────────────────────
// The fixed cygpath list answered "is there a cygpath on this machine", not "is
// it the one that belongs to this shell". A machine with a Program Files Git and
// a second Git elsewhere would hand Git Bash a cygpath from the other install,
// and the /c/... versus /mnt/c/... mismatch is what #1409 documents.
test('a bash path names its Git install, in each layout it ships in', () => {
  const scoopRoot = 'C:/tools/scoop/apps/git/current';
  assert.equal(gitRootOfBash('D:/Git/bin/bash.exe'), 'D:/Git');
  assert.equal(gitRootOfBash('D:/Git/usr/bin/bash.exe'), 'D:/Git');
  assert.equal(gitRootOfBash(String.raw`C:\Program Files\Git\usr\bin\bash.exe`), 'C:/Program Files/Git');
  assert.equal(gitRootOfBash(`${scoopRoot}/bin/bash.exe`), scoopRoot);
});

test('a path that is not a Git bash names no install', () => {
  for (const value of ['bash', '/usr/bin/bash', '', undefined, null, 'D:/Git/mingw64/bin/git.exe']) {
    assert.equal(gitRootOfBash(value), null, `must not invent a root for ${JSON.stringify(value)}`);
  }
});

test('cygpath candidates follow the install root, and a missing root adds none', () => {
  assert.deepEqual(cygpathCandidatesForGitRoot('D:/Git'), ['D:/Git/usr/bin/cygpath.exe', 'D:/Git/bin/cygpath.exe']);
  assert.deepEqual(cygpathCandidatesForGitRoot(null), [], 'an unresolved bash adds no cygpath');
});

test('on this machine the cygpath tried first belongs to the bash install', () => {
  if (process.platform !== 'win32') return; // nothing to pair on POSIX
  const root = gitRootOfBash(getBash());
  if (!root) return; // unresolved bash: the fixed list is the whole story, unchanged
  const first = cygpathCandidates()[0];
  assert.equal(first, `${root}/usr/bin/cygpath.exe`,
    `the first cygpath must come from the bash install (${root}), not from another one`);
});

// ── the chain itself, driven by injection rather than by this machine ──────
// The string tests above pin what a path means; these pin what getBash() walks.
// Without them, deleting the derived append would leave every other assertion
// green on a machine whose Git sits in Program Files or Scoop.
const FAKE_FIXED = ['C:/fixed/bin/bash.exe'];
const ELSEWHERE = 'C:/Elsewhere/mingw64/libexec/git-core';

test('the chain appends the git install\'s bash after the fixed literals', () => {
  assert.deepEqual(
    windowsBashCandidates({ fixed: FAKE_FIXED, gitExecPath: () => ELSEWHERE }),
    ['C:/fixed/bin/bash.exe', 'C:/Elsewhere/usr/bin/bash.exe', 'C:/Elsewhere/bin/bash.exe'],
  );
});

test('a silent git adds nothing to the chain', () => {
  for (const answer of ['', '   ', 'not a path']) {
    assert.deepEqual(windowsBashCandidates({ fixed: FAKE_FIXED, gitExecPath: () => answer }), FAKE_FIXED,
      `git answering ${JSON.stringify(answer)} must not add a candidate`);
  }
});

test('a fixed candidate that the git install also provides is not repeated', () => {
  const shared = 'C:/Elsewhere/usr/bin/bash.exe';
  assert.deepEqual(
    windowsBashCandidates({ fixed: [shared], gitExecPath: () => ELSEWHERE }),
    [shared, 'C:/Elsewhere/bin/bash.exe'],
  );
});

test('selection takes the derived shell when the fixed candidates do not answer', () => {
  // The case the fixed list cannot cover: every literal fails the probe and the
  // only shell that starts is the one derived from `git --exec-path`.
  const chain = windowsBashCandidates({ fixed: FAKE_FIXED, gitExecPath: () => ELSEWHERE });
  const picked = firstProbeable(chain, (candidate) => candidate.startsWith('C:/Elsewhere/'));
  assert.equal(picked, 'C:/Elsewhere/usr/bin/bash.exe',
    'the derived install\'s usr/bin must be what getBash() selects');
});

test('a probe that throws counts as "not this one", and nothing answering is null', () => {
  assert.equal(firstProbeable(['a', 'b'], (c) => { if (c === 'a') throw new Error('nope'); return false; }), null);
  assert.equal(firstProbeable(['a', 'b'], (c) => c === 'b'), 'b');
  assert.equal(firstProbeable([], () => true), null);
});

// ── every environment directory, not just mingw64 ──────────────────────────
// Git for Windows ARM64 ships clangarm64 and MSYS2 packages git under ucrt64 or
// clang64, so a mingw64-only rule builds <root>/<environment>/usr/bin/bash.exe
// and points the harness at a shell that is not there.
test('ARM64, UCRT64 and CLANG64 layouts resolve to the install root', () => {
  for (const environment of ['clangarm64', 'ucrt64', 'clang64']) {
    assert.deepEqual(
      bashCandidatesFromGitExecPath(`C:/Git/${environment}/libexec/git-core`),
      ['C:/Git/usr/bin/bash.exe', 'C:/Git/bin/bash.exe'],
      `${environment} must resolve to the install root`,
    );
  }
});

test('MSYS2\'s own environment resolves one level below its root', () => {
  assert.deepEqual(
    bashCandidatesFromGitExecPath('C:/msys64/usr/libexec/git-core'),
    ['C:/msys64/usr/bin/bash.exe', 'C:/msys64/bin/bash.exe'],
  );
});

test('an unrecognised directory before libexec is taken as the root', () => {
  // Only the known environment names are stripped. Guessing for anything else
  // would move the root for an install that names its directory something new,
  // which is the bug this rule exists to avoid.
  assert.deepEqual(
    bashCandidatesFromGitExecPath('C:/Git/weird/libexec/git-core'),
    ['C:/Git/weird/usr/bin/bash.exe', 'C:/Git/weird/bin/bash.exe'],
  );
});

test('a path with no libexec/git-core tail still yields nothing', () => {
  for (const value of ['C:/Git/mingw64/bin', 'C:/Git/libexec', 'C:/Git/libexec/git-core/extra']) {
    assert.deepEqual(bashCandidatesFromGitExecPath(value), [], `${value} is not an exec-path`);
  }
});
