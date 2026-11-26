// Unit and spawn tests for SEEK's configuration-error exit (#7741 review).
//
// A bad seek_searches entry (max_pages, keyword, location, daterange) throws
// before the first request. main() used to count that as a failed search, so a
// portals.yml typo exited 2 — the code the usage text reserves for "every
// search was tried and none could be read". These tests pin the split: a bad
// entry is a configuration error (exit 1), never a failed search.
//
// No network: seekSearchConfigError is pure, and the spawn case is a portals.yml
// whose only entry is invalid, so no request is ever made.
import test from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seekSearchConfigError } from '../scan-seek.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

test('a valid entry passes the pre-flight check', () => {
  assert.strictEqual(seekSearchConfigError({ keyword: 'developer' }), null);
});

test('max_pages below 1 is a configuration error, not a failed search', () => {
  const message = seekSearchConfigError({ keyword: 'developer', max_pages: 0 });
  assert.ok(message, 'a max_pages of 0 must be rejected');
  assert.match(message, /max_pages/);
});

test('a keyword that slugifies to nothing is a configuration error', () => {
  // '!!!' survives loadSearches (its trim is non-empty) but slugifies to '',
  // which is the shape buildSeekUrl rejects.
  const message = seekSearchConfigError({ keyword: '!!!' });
  assert.ok(message, 'an unsluggable keyword must be rejected');
  assert.match(message, /Empty keyword/);
});

test('an unknown location is a configuration error', () => {
  const message = seekSearchConfigError({ keyword: 'developer', location: 'Atlantis' });
  assert.ok(message, 'an unknown location must be rejected');
  assert.match(message, /location/);
});

test('an all-invalid portals.yml exits 1 with the entry named, never 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seek-config-exit-'));
  try {
    writeFileSync(join(dir, 'portals.yml'), [
      'seek_searches:',
      '  - keyword: developer',
      '    max_pages: 0',
      '',
    ].join('\n'));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('CAREER_OPS_')) delete env[key];
    env.CAREER_OPS_ROOT = dir;
    env.CAREER_OPS_PORTALS = join(dir, 'portals.yml');

    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../scan-seek.mjs', import.meta.url)), '--dry-run'],
      { cwd: dir, env, encoding: 'utf8', timeout: 30_000 },
    );

    assert.equal(result.status, 1, describeSpawn(result, 'a config-only SEEK run must exit 1'));
    assert.match(result.stderr, /seek_searches entry "developer": .*max_pages/);
    assert.doesNotMatch(result.stderr, /every SEEK search failed/);
    assert.match(result.stdout, /Errors:\s+1 of 1 queries/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
