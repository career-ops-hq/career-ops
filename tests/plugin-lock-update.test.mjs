// A torn plugins.lock must stay on disk. Treating it as an empty lock and
// writing that back would drop every other pin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLock, writeLockEntry, removeLockEntry } from '../plugins/_lock.mjs';
import { lockGate } from '../plugins/_engine.mjs';

function freshRoot() {
  return mkdtempSync(join(tmpdir(), 'co-lock-'));
}

test('two pins survive a later rewrite and no temp file is left behind', () => {
  const root = freshRoot();
  try {
    const long = 'sha256-' + 'b'.repeat(400);
    writeLockEntry(root, 'plugin-a', { integrity: 'sha256-a' });
    writeLockEntry(root, 'plugin-b', { integrity: long });
    writeLockEntry(root, 'plugin-b', { integrity: 'sha256-short' });
    const file = join(root, 'plugins.lock');
    const bytes = readFileSync(file, 'utf8');
    const parsed = JSON.parse(bytes);
    assert.equal(parsed.plugins['plugin-a'].integrity, 'sha256-a');
    assert.equal(parsed.plugins['plugin-b'].integrity, 'sha256-short');
    assert.equal(bytes.includes('sha256-a'), true);
    assert.equal(bytes.includes('b'.repeat(400)), false);
    assert.equal(bytes.endsWith('}\n'), true);
    assert.equal(readdirSync(root).some((name) => name.startsWith('.plugins.lock.')), false);
    removeLockEntry(root, 'plugin-b');
    const afterBytes = readFileSync(file, 'utf8');
    const after = JSON.parse(afterBytes);
    assert.equal(after.plugins['plugin-a'].integrity, 'sha256-a');
    assert.equal(after.plugins['plugin-b'], undefined);
    assert.equal(afterBytes.includes('sha256-a'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a torn plugins.lock is left unchanged when an update is refused', () => {
  const root = freshRoot();
  try {
    const file = join(root, 'plugins.lock');
    const torn = '{not-json';
    writeFileSync(file, torn);
    assert.throws(
      () => writeLockEntry(root, 'plugin-a', { integrity: 'sha256-a' }),
      /plugins\.lock at .* is not valid JSON, so it was left unchanged\./,
    );
    assert.equal(readFileSync(file, 'utf8'), torn);
    assert.throws(
      () => removeLockEntry(root, 'plugin-a'),
      /is not valid JSON, so it was left unchanged\./,
    );
    assert.equal(readFileSync(file, 'utf8'), torn);
    assert.deepEqual(readLock(root).plugins, {});
    assert.equal(readdirSync(root).some((name) => name.endsWith('.tmp')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a torn plugins.lock blocks load and is not rewritten', () => {
  const root = freshRoot();
  try {
    const dir = join(root, 'plugins.local', 'lp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.mjs'), 'export default {};\n');
    const file = join(root, 'plugins.lock');
    const torn = '{not-json';
    writeFileSync(file, torn);
    const result = lockGate({
      id: 'lp', version: '1.0.0', dir, hooks: [], requiredEnv: [], allowedHosts: [],
    }, root);
    assert.equal(result.load, false);
    assert.equal(readFileSync(file, 'utf8'), torn);
    assert.equal(readdirSync(root).some((name) => name.startsWith('.plugins.lock.')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an absent plugins.lock is still pinned on first load', () => {
  const root = freshRoot();
  try {
    const dir = join(root, 'plugins.local', 'lp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'index.mjs'), 'export default {};\n');
    const result = lockGate({
      id: 'lp', version: '1.0.0', dir, hooks: [], requiredEnv: [], allowedHosts: [],
    }, root);
    assert.equal(result.load, true);
    const parsed = JSON.parse(readFileSync(join(root, 'plugins.lock'), 'utf8'));
    assert.equal(typeof parsed.plugins.lp.integrity, 'string');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a lock with no plugins map is left unchanged', () => {
  const root = freshRoot();
  try {
    const file = join(root, 'plugins.lock');
    const body = '{"lockfileVersion":1}\n';
    writeFileSync(file, body);
    assert.throws(
      () => writeLockEntry(root, 'plugin-a', { integrity: 'sha256-a' }),
      /has no plugins map, so it was left unchanged\./,
    );
    assert.equal(readFileSync(file, 'utf8'), body);
    assert.throws(
      () => removeLockEntry(root, 'plugin-b'),
      /has no plugins map, so it was left unchanged\./,
    );
    assert.equal(readFileSync(file, 'utf8'), body);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
