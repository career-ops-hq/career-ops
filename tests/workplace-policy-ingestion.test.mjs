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
import { scanBoard } from '../scan-dayforce.mjs';
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
  for (const key of ['onsite_locations', 'onsite_countries', 'remote_countries', 'remote_regions']) {
    const result = await validatePortalsConfig({ ...CONFIG, location_filter: { workplace_policy: { ...POLICY, [key]: 'Spain' } } });
    assert.ok(result.errors.some(error => error.path === 'location_filter.workplace_policy' && error.message.includes(`${key} must be a list`)), key);
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

test('policy-only detail checks keep legacy location matching unchanged', () => {
  const legacy = buildLocationFilter({ allow: ['Barcelona'] });
  assert.equal(legacy.workplacePolicyOnly('Madrid', '', '', {}), true);
  assert.equal(legacy('Madrid'), false);
  const policy = buildLocationFilter(CONFIG.location_filter);
  assert.equal(policy.workplacePolicyOnly('Remote Europe', '', '', { description: 'Candidates must be based in UK.' }), false);
});

test('Dayforce rechecks only workplace policy against the actual detail JD', async () => {
  const response = json => ({ ok: () => true, status: () => 200, json: async () => json });
  for (const { config, callback, listLocation, detailLocation, description, expected } of [
    { config: CONFIG.location_filter, listLocation: 'Remote Europe', detailLocation: 'Remote Europe', description: 'Candidates must be based in UK.', expected: 0 },
    { config: CONFIG.location_filter, listLocation: 'Remote Europe', detailLocation: 'Remote Spain', description: 'Candidates must be based in Spain.', expected: 1 },
    { config: { allow: ['Barcelona'] }, listLocation: 'Barcelona', detailLocation: 'Madrid', description: 'Office role in Madrid.', expected: 1 },
    { callback: location => location === 'Barcelona', listLocation: 'Barcelona', detailLocation: 'Madrid', description: 'Generic legacy location callback.', expected: 1 },
  ]) {
    const page = {
      goto: async () => {}, url: () => 'https://jobs.dayforcehcm.com/en-US/fixture/CANDIDATEPORTAL',
      title: async () => 'Careers', locator: () => ({ count: async () => 0 }),
      request: {
        post: async () => response({ jobPostings: [{ jobPostingId: 1, jobTitle: 'Engineer', jobDescription: 'List summary', postingLocations: [{ formattedAddress: listLocation }] }], offset: 0, count: 1, maxCount: 1 }),
        get: async url => String(url).endsWith('/api/auth/csrf') ? response({ csrfToken: 'fictional' })
          : response({ jobTitle: 'Engineer', jobPostingContent: { jobDescription: description }, postingLocations: [{ formattedAddress: detailLocation }] }),
      },
    };
    const calls = [];
    const locationFilter = callback ? location => { calls.push(location); return callback(location); } : buildLocationFilter(config);
    const result = await scanBoard(page, { name: 'Fictional Company', tenant: 'fixture', board: 'CANDIDATEPORTAL', culture: 'en-US', jobBoardId: '1' }, { locationFilter });
    assert.equal(result.found.length, expected, description);
    assert.equal(result.locationSkipped.length, 1 - expected, description);
    if (callback) assert.deepEqual(calls, [listLocation], 'a generic legacy callback is not repeated on detail data');
  }
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
