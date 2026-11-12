// Both real scanner entry points, isolated data roots and a fictional provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = [
  { title: 'Software Engineer - Remote', location: 'New York, United States', url: 'https://job-boards.greenhouse.io/fixture/jobs/1' },
  { title: 'Platform Engineer - Remote', location: 'Shenzhen, China', url: 'https://job-boards.greenhouse.io/fixture/jobs/2' },
  { title: 'Software Engineer', location: '5 Locations', url: 'https://fixture.wd5.myworkdayjobs.com/en-US/Careers/job/Shenzhen-China/Engineer_R3' },
];

for (const script of ['scan.mjs', 'scan-ats-full.mjs']) {
  for (const flag of [undefined, true, false]) {
    test(`${script} uses shared remote-title policy ${flag}`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'co-remote-policy-'));
      try {
        mkdirSync(join(dir, 'data', 'cache', 'ats-companies'), { recursive: true });
        writeFileSync(join(dir, 'data', 'cache', 'ats-companies', 'greenhouse.json'), JSON.stringify(['fixture']));
        writeFileSync(join(dir, 'portals.yml'), `title_filter:\n  positive: [Engineer]\nlocation_filter:\n  strict: true\n  allow: [Shenzhen]\n${flag === undefined ? '' : `  remote_title_fallback: ${flag}\n`}tracked_companies:\n  - name: Fixture\n    careers_url: https://job-boards.greenhouse.io/fixture\n`);
        const preload = join(dir, 'preload.mjs');
        writeFileSync(preload, `
import provider from ${JSON.stringify(pathToFileURL(join(root, 'providers/greenhouse.mjs')).href)};
provider.fetchListing = undefined;
provider.fetch = async () => ${JSON.stringify(fixtures)};
// Fail closed if the fixture ever starts making real requests.
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
`);
        const args = script === 'scan-ats-full.mjs' ? ['--ats', 'greenhouse', '--include-undated', '--json'] : [];
        const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, join(root, script), ...args], {
          cwd: dir, encoding: 'utf8', timeout: 20000,
          env: { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_DATA_DIR: '', CAREER_OPS_PORTALS: join(dir, 'portals.yml') },
        });
        assert.equal(result.status, 0, result.stderr || result.error?.message);
        if (script === 'scan-ats-full.mjs') assert.equal(JSON.parse(result.stdout).unreachableBoards, 0, result.stderr);
        // Assert persisted output as well as successful CLI exit, not a copied predicate.
        const pipeline = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
        assert.equal(pipeline.includes(fixtures[0].url), flag !== false, pipeline);
        assert.ok(pipeline.includes(fixtures[1].url), pipeline);
        assert.ok(pipeline.includes(fixtures[2].url), pipeline);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
}
