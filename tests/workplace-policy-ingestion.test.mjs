import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { buildLocationFilter } from '../scan.mjs';
import { passesFilters } from '../scan-ats-full.mjs';
import { createAdmissionGate } from '../lib/admission-gate.mjs';
import { validatePortalsConfig } from '../validate-portals.mjs';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const POLICY = { onsite_locations: ['Barcelona'], remote_countries: ['Spain'], remote_regions: ['Europe', 'European Union', 'EU', 'EMEA', 'Worldwide', 'Anywhere'] };
const CONFIG = { title_filter: { positive: ['Sales Engineer'] }, location_filter: { allow: ['Barcelona', 'Remote', 'Europe', 'Spain'], always_allow: ['Barcelona'], workplace_policy: POLICY }, tracked_companies: [{ name: 'Policy Fixture', careers_url: 'https://boards.example.com/workplace', parser: { command: 'node', script: 'tests/fixtures/workplace-policy-board.mjs' } }] };
test('the conditional policy is opt-in and does not change legacy remote matching', () => {
  assert.equal(buildLocationFilter({ allow: ['Remote'] })('Remote — Perth, Australia'), true);
  assert.equal(buildLocationFilter(CONFIG.location_filter)('Remote — Perth, Australia'), false);
});
test('portals validator accepts a complete policy and reports malformed user config', async () => {
  const valid = await validatePortalsConfig(CONFIG);
  assert.deepEqual(valid.errors, []);
  for (const workplace_policy of [[], { onsite_locations: ['Barcelona'] }, { onsite_locations: ['Barcelona'], remote_countries: ['Neverland'] }]) {
    const result = await validatePortalsConfig({ location_filter: { workplace_policy } });
    assert.ok(result.errors.some(error => error.path === 'location_filter.workplace_policy'));
  }
});
test('all shared admission paths reject a remote Australia and narrower JD eligibility', () => {
  const filter = buildLocationFilter(CONFIG.location_filter);
  const job = { title: 'Sales Engineer', location: 'Remote Europe', url: 'https://jobs.example/1', description: 'Applicants must be based in the UK.' };
  assert.equal(filter('Remote — Perth, Australia', '', 'Sales Engineer - Remote'), false);
  assert.equal(filter(job.location, job.url, job.title, job), false);
  assert.equal(passesFilters(job, { titleFilter: () => true, locationFilter: filter }), false);
  assert.equal(createAdmissionGate({ config: CONFIG, seen: new Set(), blacklist: new Map() }).check(job), 'location');
  assert.equal(filter('Barcelona', '', 'Sales Engineer'), true);
});
test('a real offline scanner run writes only policy-compatible jobs to Inbox and records rejects', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-policy-'));
  try {
    fs.mkdirSync(path.join(temp, 'data'));
    fs.writeFileSync(path.join(temp, 'portals.yml'), yaml.dump(CONFIG));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('CAREER_OPS_')) delete env[key];
    const result = spawnSync(process.execPath, [path.join(ROOT, 'scan.mjs'), '--quiet'], { cwd: ROOT, env: { ...env, CAREER_OPS_ROOT: temp }, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const pipeline = fs.readFileSync(path.join(temp, 'data/pipeline.md'), 'utf8');
    assert.match(pipeline, /workplace\/barcelona/);
    assert.match(pipeline, /workplace\/spain/);
    for (const id of ['madrid', 'perth', 'unknown', 'uk-restricted']) assert.doesNotMatch(pipeline, new RegExp('workplace/' + id));
    const history = fs.readFileSync(path.join(temp, 'data/scan-history.tsv'), 'utf8');
    assert.match(history, /workplace\/perth\t[^\n]*skipped_location/);
    assert.match(history, /workplace\/uk-restricted\t[^\n]*skipped_location/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
