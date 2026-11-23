// tests/walk-tree-on-skip.test.mjs — a walk that skips symlinks can say which
// ones it skipped.
//
// `links: 'skip'` is the right default (a symlinked directory can point outside
// the tree), but callers that treat the returned list as "what is there" — a
// backup, a copy — lose whatever was skipped unless the walk tells them. The
// option is additive: no callback keeps the old silent behaviour.
//
// A directory junction is used rather than a file symlink because creating one
// needs no SeCreateSymbolicLinkPrivilege on Windows, so this runs on an ordinary
// account instead of skipping. `lstat` reports a junction as a symbolic link, so
// the walk treats it exactly like one.
//
// Run:  node --test tests/walk-tree-on-skip.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkTree } from '../lib/walk-tree.mjs';

/** A tree with one real file and one nested link to a sibling directory. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'walk-tree-on-skip-'));
  mkdirSync(join(root, 'data', 'nested'), { recursive: true });
  mkdirSync(join(root, 'other'), { recursive: true });
  writeFileSync(join(root, 'data', 'real.txt'), 'x');
  symlinkSync(join(root, 'other'), join(root, 'data', 'nested', 'alias-dir'), 'junction');
  return root;
}

test('without onSkip, a skipped link stays silent', () => {
  const root = fixture();
  try {
    const files = walkTree(join(root, 'data'));
    assert.equal(files.length, 1, 'the link must still be skipped by default');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('with onSkip, the caller learns which path was skipped', () => {
  const root = fixture();
  try {
    const seen = [];
    const files = walkTree(join(root, 'data'), { onSkip: (p) => seen.push(p) });
    assert.equal(files.length, 1);
    assert.equal(seen.length, 1, 'the skipped link must be reported exactly once');
    assert.match(seen[0].replace(/\\/g, '/'), /data\/nested\/alias-dir$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('onSkip does not fire when links are followed', () => {
  const root = fixture();
  try {
    const seen = [];
    // 'other' is empty, so following the link adds no files and no cycle.
    const files = walkTree(join(root, 'data'), { links: 'follow', onSkip: (p) => seen.push(p) });
    assert.equal(files.length, 1);
    assert.deepEqual(seen, [], 'a followed link was not skipped');
  } finally { rmSync(root, { recursive: true, force: true }); }
});