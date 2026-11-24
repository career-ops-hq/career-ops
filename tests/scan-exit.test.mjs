// Unit tests for lib/scan-exit.mjs — the shared "every target failed" rule
// that the standalone scanners (scan-topdev, scan-interamt, scan-dayforce,
// scan-seek) use to exit 2 the way scan.mjs does (#5720).
//
// No network, no browser, and no real process state: the helper takes an
// injectable io so these tests never touch the real process.exitCode.
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  EXIT_EVERY_TARGET_FAILED,
  everyTargetFailed,
  exitIfEveryTargetFailed,
} from '../lib/scan-exit.mjs';

function fakeIo() {
  const lines = [];
  const proc = {};
  return { lines, proc, io: { error: (m) => lines.push(m), proc } };
}

test('everyTargetFailed is true only when something was attempted and nothing read', () => {
  assert.strictEqual(everyTargetFailed({ attempted: 3, read: 0 }), true);
  assert.strictEqual(everyTargetFailed({ attempted: 3, read: 1 }), false);
  assert.strictEqual(everyTargetFailed({ attempted: 0, read: 0 }), false); // nothing configured
  assert.strictEqual(everyTargetFailed({ attempted: 1, read: 0 }), true);
});

test('exitIfEveryTargetFailed sets 2 and prints scan.mjs\'s message when all failed', () => {
  const { lines, proc, io } = fakeIo();
  const result = exitIfEveryTargetFailed(
    { attempted: 2, read: 0, unit: 'TopDev search', thing: 'results page' },
    io,
  );
  assert.strictEqual(result, true);
  assert.strictEqual(proc.exitCode, 2);
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(
    lines[0],
    'Error: every TopDev search failed (2 of 2); no results page could be read. See the errors above.',
  );
});

test('a partial failure exits 0 silently and touches nothing', () => {
  const { lines, proc, io } = fakeIo();
  const result = exitIfEveryTargetFailed(
    { attempted: 2, read: 1, unit: 'TopDev search', thing: 'results page' },
    io,
  );
  assert.strictEqual(result, false);
  assert.strictEqual(proc.exitCode, undefined);
  assert.deepStrictEqual(lines, []);
});

test('nothing attempted exits 0 silently (an empty config is not an outage)', () => {
  const { lines, proc, io } = fakeIo();
  const result = exitIfEveryTargetFailed(
    { attempted: 0, read: 0, unit: 'TopDev search', thing: 'results page' },
    io,
  );
  assert.strictEqual(result, false);
  assert.strictEqual(proc.exitCode, undefined);
  assert.deepStrictEqual(lines, []);
});

test('EXIT_EVERY_TARGET_FAILED is the receipt/scan.mjs failure code 2', () => {
  assert.strictEqual(EXIT_EVERY_TARGET_FAILED, 2);
});

test('the message matches scan.mjs\'s frame', () => {
  const { lines, io } = fakeIo();
  exitIfEveryTargetFailed(
    { attempted: 1, read: 0, unit: 'Dayforce board', thing: 'board' },
    io,
  );
  const line = lines[0];
  assert.ok(line.startsWith('Error: every '), line);
  assert.ok(line.endsWith('See the errors above.'), line);
});

test('every standalone scanner calls the shared rule and documents exit 2', () => {
  for (const file of ['scan-topdev.mjs', 'scan-interamt.mjs', 'scan-dayforce.mjs', 'scan-seek.mjs']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(src, /from '\.\/lib\/scan-exit\.mjs'/, `${file} imports lib/scan-exit.mjs`);
    assert.match(src, /exitIfEveryTargetFailed\(\{/, `${file} calls exitIfEveryTargetFailed`);
    assert.match(src, /Exit status: 0 when the scan ran, 1 on a configuration or fatal error, 2 when every/, `${file} documents exit 2 in its usage`);
  }
  const seek = readFileSync(new URL('../scan-seek.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(seek, /errors === searches\.length\) process\.exitCode = 1/, 'SEEK no longer exits 1 on total failure');
});

test('lib/scan-exit.mjs ships to updated installs', () => {
  const manifest = readFileSync(new URL('../lib/update-manifest.mjs', import.meta.url), 'utf8');
  assert.match(manifest, /'lib\/scan-exit\.mjs',/);
});
