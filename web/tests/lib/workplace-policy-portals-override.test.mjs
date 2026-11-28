// The workplace geography policy lives in portals.yml, which CAREER_OPS_PORTALS
// can move outside the data root. What's New (loadWorkplacePolicy) and the
// Add-to-Inbox gate (core/pipeline.ts) must read that file, not <root>/portals.yml.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { loadWorkplacePolicy } from '../../src/lib/core/workplace-policy.mjs';
import { describeSpawn } from '../../../tests/helpers/describe-spawn.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const policy = { onsite_locations: ['Barcelona'], remote_countries: ['Spain'], remote_regions: ['Europe', 'EU', 'EMEA', 'Worldwide'] };

function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-override-'));
  const root = path.join(temp, 'data');
  const lane = path.join(temp, 'lane');
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(lane);
  const portals = path.join(lane, 'portals.yml');
  fs.writeFileSync(portals, yaml.dump({ location_filter: { workplace_policy: policy } }));
  return { temp, root, portals };
}

test('loadWorkplacePolicy reads the CAREER_OPS_PORTALS file, and a missing one is still policy_absent', async () => {
  const { temp, root, portals } = fixture();
  const saved = process.env.CAREER_OPS_PORTALS;
  try {
    assert.equal(fs.existsSync(path.join(root, 'portals.yml')), false);
    process.env.CAREER_OPS_PORTALS = portals;
    const check = await loadWorkplacePolicy(root, ROOT);
    assert.equal(check('Remote Australia', 'Sales Engineer').eligible, false);
    assert.equal(check('Barcelona', 'Sales Engineer').eligible, true);
    process.env.CAREER_OPS_PORTALS = path.join(temp, 'missing.yml');
    assert.deepEqual((await loadWorkplacePolicy(root, ROOT))('Remote Australia', 'Sales Engineer'), { eligible: true, reason: 'policy_absent' });
  } finally {
    if (saved === undefined) delete process.env.CAREER_OPS_PORTALS;
    else process.env.CAREER_OPS_PORTALS = saved;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Add to Inbox applies the CAREER_OPS_PORTALS policy', () => {
  const { temp, root, portals } = fixture();
  try {
    const adapter = pathToFileURL(path.join(ROOT, 'web/src/lib/core/pipeline.ts')).href;
    const loader = pathToFileURL(path.join(ROOT, 'web/tests/helpers/web-ts-alias-loader.mjs')).href;
    const code = `
      const { addOffersToPipeline } = await import(${JSON.stringify(adapter)});
      console.log(JSON.stringify(await addOffersToPipeline(${JSON.stringify([{ company: 'Fixture', title: 'Sales Engineer', source: 'fixture', url: 'https://jobs.example/perth', location: 'Remote Australia' }])})));
    `;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('CAREER_OPS_')) delete env[key];
    Object.assign(env, { CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: ROOT, CAREER_OPS_PORTALS: portals });
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--import', loader, '--input-type=module', '-e', code], { cwd: root, env, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, describeSpawn(result, 'Add to Inbox with a portals override'));
    const outcome = JSON.parse(result.stdout);
    assert.equal(outcome.added, 0, result.stdout);
    assert.match(outcome.error, /workplace geography policy/);
    assert.equal(fs.existsSync(path.join(root, 'data/pipeline.md')), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
