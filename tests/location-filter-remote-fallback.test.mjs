// #5429: opt out of only the final title rescue, preserving location evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLocationFilter } from '../scan.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

for (const city of ['Shenzhen', 'Berlin']) {
  for (const flag of [undefined, true, false]) {
    test(`${city}: remote_title_fallback=${flag} controls only unmatched-location rescue`, () => {
      const config = { strict: true, allow: [city] };
      if (flag !== undefined) config.remote_title_fallback = flag;
      const accepts = buildLocationFilter(config);
      assert.deepEqual([
        accepts('New York, United States', '', 'Software Engineer'),
        accepts('New York, United States', '', 'Software Engineer - Remote'),
        accepts(`${city}, fixture country`, '', 'Software Engineer - Remote'),
      ], [false, flag !== false, true]);
    });
  }
}

test('disabled rescue preserves URL hints, explicitly allowed Remote and precedence', () => {
  const off = { remote_title_fallback: false };
  assert.equal(buildLocationFilter({ ...off, allow: ['Shenzhen'] })(
    '5 Locations', 'https://fixture.wd5.myworkdayjobs.com/en-US/Careers/job/Shenzhen-China/Engineer_R1', 'Engineer'), true);
  assert.equal(buildLocationFilter({ ...off, allow: ['Remote'] })('Remote', '', 'Engineer'), true);
  for (const [tiers, expected] of [
    [{ block_hard: ['Berlin'], always_allow: ['Berlin'], block: ['Berlin'], allow: ['Berlin'] }, false],
    [{ always_allow: ['Berlin'], block: ['Berlin'], allow: ['Shenzhen'] }, true],
    [{ block: ['Berlin'], allow: ['Berlin'] }, false],
    [{ allow: ['Berlin'] }, true],
  ]) {
    assert.equal(buildLocationFilter({ ...off, ...tiers })('Berlin', '', 'Engineer - Remote'), expected);
  }
});

test('disabled rescue preserves missing-location and empty-allow behavior', () => {
  for (const strict of [false, true]) {
    const f = buildLocationFilter({ strict, allow: ['Shenzhen'], remote_title_fallback: false });
    for (const missing of ['', '  ', null, undefined, 42]) {
      assert.equal(f(missing, '', 'Engineer - Remote'), !strict);
    }
    assert.equal(buildLocationFilter({ strict, remote_title_fallback: false })('', '', 'Engineer'), true);
    assert.equal(buildLocationFilter({ strict, allow: [], remote_title_fallback: false })('New York', '', 'Engineer'), true);
    assert.equal(buildLocationFilter({ strict, block: ['Berlin'], remote_title_fallback: false })('Berlin', '', 'Engineer - Remote'), false);
  }
});

test('validator accepts omitted/boolean policy and rejects all non-boolean shapes by path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-remote-validation-'));
  try {
    const file = join(dir, 'portals.yml');
    for (const value of [undefined, true, false, 'false', 'true', 0, 1, null, [], {}]) {
      writeFileSync(file, `title_filter:\n  positive: [Engineer]\nlocation_filter:\n  allow: [Shenzhen]\n${value === undefined ? '' : `  remote_title_fallback: ${JSON.stringify(value)}\n`}tracked_companies:\n  - name: Fixture\n    careers_url: https://job-boards.greenhouse.io/fixture\n`);
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../validate-portals.mjs', import.meta.url)), '--file', file], { encoding: 'utf8', timeout: 10000 });
      const valid = value === undefined || typeof value === 'boolean';
      assert.equal(result.status, valid ? 0 : 1, result.stdout + result.stderr);
      if (!valid) assert.match(result.stdout, /location_filter.remote_title_fallback.*must be a boolean/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
