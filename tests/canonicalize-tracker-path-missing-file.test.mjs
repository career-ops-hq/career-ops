// tests/canonicalize-tracker-path-missing-file.test.mjs — the tracker lock is a
// hash of the canonical tracker path. A first merge creates the tracker, so the
// path is canonicalized once while the file is missing and again after it
// exists. Both must give the same string, or a second writer takes a different
// lock than the first and the two merges overwrite each other's rows. With a
// symlinked data/ the missing-file case used to return the lexical path while
// the existing-file case returned the real path.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalizeTrackerPath, resolveTrackerPathForWrite } from '../path-resolver.mjs';
import { trackerLockDirFor } from '../tracker-utils.mjs';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

function withLinkedData(fn) {
  const base = mkdtempSync(join(tmpdir(), 'canon-missing-'));
  try {
    const real = join(base, 'elsewhere');
    const root = join(base, 'root');
    mkdirSync(real);
    mkdirSync(root);
    // 'junction' needs no privilege on Windows and is ignored on POSIX.
    symlinkSync(real, join(root, 'data'), 'junction');
    fn({ base, real, root });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

ok('canonical path of a missing tracker under a symlinked dir equals its path once created', () => {
  withLinkedData(({ root }) => {
    const tracker = join(root, 'data', 'applications.md');
    const before = canonicalizeTrackerPath(tracker);
    writeFileSync(tracker, '# Applications\n');
    const after = canonicalizeTrackerPath(tracker);
    assert.equal(before, after);
  });
});

ok('canonical path of a missing tracker resolves the symlinked ancestor', () => {
  withLinkedData(({ real, root }) => {
    const before = canonicalizeTrackerPath(join(root, 'data', 'applications.md'));
    assert.equal(before, join(realpathSync(real), 'applications.md'));
  });
});

ok('lock directory is identical before and after the tracker is created', () => {
  withLinkedData(({ root }) => {
    const target = resolveTrackerPathForWrite(root);
    const before = trackerLockDirFor(canonicalizeTrackerPath(target));
    writeFileSync(target, '# Applications\n');
    const after = trackerLockDirFor(canonicalizeTrackerPath(target));
    assert.equal(before, after);
  });
});

ok('a missing tracker under a plain missing directory keeps its path', () => {
  const base = mkdtempSync(join(tmpdir(), 'canon-plain-'));
  try {
    const missing = join(realpathSync(base), 'no', 'such', 'dir', 'applications.md');
    assert.equal(canonicalizeTrackerPath(missing), missing);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
