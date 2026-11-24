import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runBackup } from '../backup.mjs';

test('overlapping backups can both publish an intact CV', (t) => {
  const fixture = fs.mkdtempSync(join(tmpdir(), 'co-backup-overlap-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const dataRoot = join(fixture, 'source');
  const dest = join(fixture, 'backup');
  fs.mkdirSync(dataRoot);
  fs.mkdirSync(dest);
  const source = join(dataRoot, 'cv.md');
  const target = join(dest, 'cv.md');
  const original = 'previous recoverable CV\n';
  const complete = 'complete new CV\nwith all its content\n';
  fs.writeFileSync(source, complete);
  fs.writeFileSync(target, original);

  const copy = fs.copyFileSync;
  const utimes = fs.utimesSync;
  const stagingPaths = [];
  let otherRun;
  const injectCopy = t.mock.method(fs, 'copyFileSync', (from, to, ...args) => {
    stagingPaths.push(to);
    return copy(from, to, ...args);
  });
  const injectUtimes = t.mock.method(fs, 'utimesSync', (...args) => {
    // Pause one run after its copy and complete the other run before its rename.
    injectUtimes.mock.restore();
    syncBuiltinESMExports();
    otherRun = runBackup({ dataRoot, dest });
    return utimes(...args);
  });
  syncBuiltinESMExports();
  try {
    const firstRun = runBackup({ dataRoot, dest });
    assert.equal(stagingPaths.length, 2);
    assert.deepEqual(otherRun.failed, []);
    assert.deepEqual(firstRun.failed, [], 'the second backup must leave the first backup’s staging file in place');
    assert.equal(otherRun.copied, 1);
    assert.equal(firstRun.copied, 1);
    assert.equal(fs.readFileSync(target, 'utf8'), complete);
    for (const stagingPath of stagingPaths) assert.equal(fs.existsSync(stagingPath), false);
  } finally {
    injectCopy.mock.restore();
    injectUtimes.mock.restore();
    syncBuiltinESMExports();
  }
});
