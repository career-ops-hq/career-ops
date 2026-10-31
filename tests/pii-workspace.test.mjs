// tests/pii-workspace.test.mjs — tests for pii-workspace tokenization tool.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  scrub,
  rehydrate,
  atomicWriteFileSync,
  loadTokenMap,
  saveTokenMap,
} from '../pii-workspace.mjs';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-ws-test-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('scrub allocates YAML-safe tokens and reuses only on exact case match', () => {
  const mockGuard = {
    textValues: new Set(['jordan placeholder', 'project nightingale']),
  };
  const map = {};

  const text = 'Candidate Jordan Placeholder worked on Project Nightingale. Another Jordan Placeholder.';
  const scrubbed = scrub(text, mockGuard, map);

  assert.match(scrubbed, /PRIVACY_VALUE_1/);
  assert.match(scrubbed, /PRIVACY_VALUE_2/);
  // Unquoted scalar validity: no braces, colons, or quotes
  assert.doesNotMatch(scrubbed, /[{}[\]:"]/);

  // Exact spelling match reuses token (jordan placeholder is processed second due to length)
  assert.equal(scrubbed.match(/PRIVACY_VALUE_2/g).length, 2);

  // Case difference allocates separate token
  const differentCase = 'Small jordan placeholder was here.';
  const scrubbedDiff = scrub(differentCase, mockGuard, map);
  assert.match(scrubbedDiff, /PRIVACY_VALUE_3/);
  assert.equal(map['PRIVACY_VALUE_3'], 'jordan placeholder');
});

test('scrub processes guard.textValues longest first using sorted copy without mutating guard', () => {
  const originalOrder = ['jordan', 'jordan placeholder'];
  const mockGuard = {
    textValues: new Set(originalOrder),
  };
  const map = {};
  const text = 'Candidate Jordan Placeholder arrived today.';
  const scrubbed = scrub(text, mockGuard, map);

  // Entire phrase 'Jordan Placeholder' should be tokenized as one token, not 'PRIVACY_VALUE_1 Placeholder'
  assert.equal(scrubbed, 'Candidate PRIVACY_VALUE_1 arrived today.');
  assert.equal(map['PRIVACY_VALUE_1'], 'Jordan Placeholder');
  // Original Set iteration order preserved
  assert.deepEqual([...mockGuard.textValues], originalOrder);
});

test('scrub handles numeric-only guard without throwing', () => {
  const mockGuard = {
    textValues: new Set(),
    digitStrings: new Set(['150000']),
    digitRuns: new Set(['150000']),
  };
  const map = {};
  const text = 'Base salary: 150000';
  const scrubbed = scrub(text, mockGuard, map);
  assert.equal(scrubbed, 'Base salary: 150000');
  assert.equal(Object.keys(map).length, 0);
});

test('rehydrate performs single-pass lookup avoiding prefix corruption for overlapping tokens', () => {
  const map = {
    PRIVACY_VALUE_1: 'Alice',
    PRIVACY_VALUE_10: 'Bob',
    PRIVACY_VALUE_100: 'Charlie',
  };

  // Text contains PRIVACY_VALUE_10 and PRIVACY_VALUE_100
  const input = 'First: PRIVACY_VALUE_1, Tenth: PRIVACY_VALUE_10, Hundredth: PRIVACY_VALUE_100.';
  const restored = rehydrate(input, map);

  assert.equal(restored, 'First: Alice, Tenth: Bob, Hundredth: Charlie.');
  // Must not produce corrupted forms like "Alice0"
  assert.doesNotMatch(restored, /Alice0/);
});

test('rehydrate handles legacy tokens in descending length order', () => {
  const map = {
    SHORT: 'short_val',
    SHORT_EXTRA: 'long_val',
  };

  const input = 'Tokens: SHORT_EXTRA and SHORT.';
  const restored = rehydrate(input, map);

  assert.equal(restored, 'Tokens: long_val and short_val.');
  assert.doesNotMatch(restored, /short_val_EXTRA/);
});

test('rehydrate matches numeric and legacy tokens in a single pass without re-processing inserted values', () => {
  const map = {
    TOKEN_A: 'value with TOKEN_B inside',
    TOKEN_B: 'replaced_val',
    PRIVACY_VALUE_1: 'value with PRIVACY_VALUE_2 inside',
    PRIVACY_VALUE_2: 'another_val',
  };

  const input = 'Test: TOKEN_A and PRIVACY_VALUE_1.';
  const restored = rehydrate(input, map);

  assert.equal(restored, 'Test: value with TOKEN_B inside and value with PRIVACY_VALUE_2 inside.');
  assert.doesNotMatch(restored, /replaced_val/);
  assert.doesNotMatch(restored, /another_val/);
});

test('atomicWriteFileSync writes atomically and preserves file mode', () => {
  withTempDir((dir) => {
    const target = path.join(dir, 'test.txt');
    fs.writeFileSync(target, 'initial', { mode: 0o644 });
    const expectedMode = fs.statSync(target).mode & 0o777;

    atomicWriteFileSync(target, 'updated', 'utf8');
    assert.equal(fs.readFileSync(target, 'utf8'), 'updated');

    // On non-Windows platforms verify mode preservation
    if (process.platform !== 'win32') {
      const mode = fs.statSync(target).mode & 0o777;
      assert.equal(mode, expectedMode);
    }
  });
});

test('atomicWriteFileSync preserves restrictive mode (0o600) set via chmodSync', () => {
  withTempDir((dir) => {
    const target = path.join(dir, 'restrictive.txt');
    fs.writeFileSync(target, 'initial');
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      /* ignore on platforms where chmod is not supported */
    }

    atomicWriteFileSync(target, 'updated', 'utf8');
    assert.equal(fs.readFileSync(target, 'utf8'), 'updated');

    if (process.platform !== 'win32') {
      const mode = fs.statSync(target).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  });
});

test('atomicWriteFileSync cleans up temporary file on successful write', () => {
  withTempDir((dir) => {
    const target = path.join(dir, 'test.txt');
    atomicWriteFileSync(target, 'hello', 'utf8');
    assert.equal(fs.readFileSync(target, 'utf8'), 'hello');
    const tempFiles = fs.readdirSync(dir).filter((f) => f.startsWith('.tmp-'));
    assert.equal(tempFiles.length, 0, 'no temporary files left after success');
  });
});

test('atomicWriteFileSync cleans up temporary file if write fails', () => {
  withTempDir((dir) => {
    // Pointing target to an existing directory forces renameSync to fail (EISDIR / EPERM)
    const target = path.join(dir, 'dir_as_target');
    fs.mkdirSync(target);

    assert.throws(() => atomicWriteFileSync(target, 'hello', 'utf8'));
    const tempFiles = fs.readdirSync(dir).filter((f) => f.startsWith('.tmp-'));
    assert.equal(tempFiles.length, 0, 'no temporary files left after failed write');
  });
});

test('atomicWriteFileSync preserves symlink target and updates destination', (t) => {
  withTempDir((dir) => {
    const realTarget = path.join(dir, 'real.txt');
    const symlinkTarget = path.join(dir, 'symlink.txt');
    fs.writeFileSync(realTarget, 'original content', 'utf8');
    try {
      fs.symlinkSync(realTarget, symlinkTarget);
    } catch {
      t.skip('symlinks not supported on this platform/privilege level');
      return;
    }

    atomicWriteFileSync(symlinkTarget, 'updated content', 'utf8');
    assert.equal(fs.readFileSync(realTarget, 'utf8'), 'updated content');
    assert.equal(fs.lstatSync(symlinkTarget).isSymbolicLink(), true);
  });
});

test('loadTokenMap throws error on corrupt or invalid token map file', () => {
  withTempDir((dir) => {
    const corruptFile = path.join(dir, 'corrupt-map.json');
    fs.writeFileSync(corruptFile, 'not valid json {', 'utf8');
    assert.throws(() => loadTokenMap(corruptFile), /Error reading token map/);

    const arrayFile = path.join(dir, 'array-map.json');
    fs.writeFileSync(arrayFile, '["an", "array"]', 'utf8');
    assert.throws(() => loadTokenMap(arrayFile), /invalid token map structure/);

    const absentFile = path.join(dir, 'absent-map.json');
    assert.deepEqual(loadTokenMap(absentFile), {});
  });
});

test('pii-workspace.mjs --help and -h print usage and exit 0', () => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  for (const flag of ['--help', '-h']) {
    const res = spawnSync(process.execPath, [path.join(root, 'pii-workspace.mjs'), flag], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /^Usage: node pii-workspace\.mjs <scrub\|restore\|status>/);
  }
});

test('restore removes token map when completed with none unresolved and keeps it if unresolved remain', () => {
  withTempDir((dir) => {
    const scriptPath = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'pii-workspace.mjs');
    const tokenMap = path.join(dir, '.pii-token-map.json');
    const cvFile = path.join(dir, 'cv.md');

    // Case 1: All tokens resolved -> token map removed
    fs.writeFileSync(tokenMap, JSON.stringify({ PRIVACY_VALUE_1: 'Alice' }), 'utf8');
    fs.writeFileSync(cvFile, 'Candidate: PRIVACY_VALUE_1', 'utf8');

    const resClean = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(resClean.status, 0);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice');
    assert.equal(fs.existsSync(tokenMap), false, 'token map should be removed after clean restore');

    // Case 2: Unresolved tokens remain -> token map kept
    fs.writeFileSync(tokenMap, JSON.stringify({ PRIVACY_VALUE_1: 'Alice' }), 'utf8');
    fs.writeFileSync(cvFile, 'Candidate: PRIVACY_VALUE_1 and PRIVACY_VALUE_99', 'utf8');

    const resUnresolved = spawnSync(process.execPath, [scriptPath, 'restore'], {
      encoding: 'utf8',
      env: { ...process.env, CAREER_OPS_ROOT: dir },
    });
    assert.equal(resUnresolved.status, 0);
    assert.equal(fs.readFileSync(cvFile, 'utf8'), 'Candidate: Alice and PRIVACY_VALUE_99');
    assert.equal(fs.existsSync(tokenMap), true, 'token map should be preserved when tokens remain unresolved');
  });
});


