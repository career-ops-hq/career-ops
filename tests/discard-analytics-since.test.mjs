// discard-analytics.mjs --since must refuse a value that is not a real
// YYYY-MM-DD date. The filter compares it with each entry's ISO timestamp as
// text, so any other spelling filtered silently wrong and still exited 0:
// "2026-11-1" dropped November 1-9, "2026/11/01" dropped every entry, and
// "11/01/2026" kept every entry, October's included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const SCRIPT = fileURLToPath(new URL('../discard-analytics.mjs', import.meta.url));

const LOG = [
  '2026-10-30T10:00:00Z\thttps://example.com/jobs/1\twrong domain',
  '2026-11-01T10:00:00Z\thttps://example.com/jobs/2\twrong domain',
  '2026-11-05T10:00:00Z\thttps://example.com/jobs/3\tbelow-min-score',
  '2026-11-12T10:00:00Z\thttps://example.com/jobs/4\tbelow-min-score',
].join('\n') + '\n';

function runSince(since) {
  const dir = mkdtempSync(join(tmpdir(), 'discard-analytics-since-'));
  try {
    const log = join(dir, 'discard.log');
    writeFileSync(log, LOG);
    return spawnSync(process.execPath, [SCRIPT, '--log', log, '--since', since],
      { cwd: dir, encoding: 'utf8', timeout: 20000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const since of ['2026-11-1', '2026/11/01', '11/01/2026', '2026-02-30', 'yesterday']) {
  test(`--since ${since} is refused, not used as a text bound`, () => {
    const result = runSince(since);
    assert.equal(result.status, 1, describeSpawn(result));
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.startsWith(`Error: --since expects a date as YYYY-MM-DD, got "${since}"\n`), describeSpawn(result));
  });
}

test('a real date keeps the entries from that day on', () => {
  const result = runSince('2026-11-01');
  assert.equal(result.status, 0, describeSpawn(result));
  assert.match(result.stdout, /^Period: 2026-11-01 to 2026-11-12$/m);
  assert.match(result.stdout, /^Total discards: 3$/m);
});
