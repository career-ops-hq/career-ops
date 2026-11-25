import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as yaml from 'js-yaml';
import { formatLiveOfferLine } from '../../../scan-ats-full.mjs';
import { buildWorkplacePolicy, captureWorkplaceEvidence, workplacePolicyFromConfig } from '../../../providers/_country.mjs';
import { workplacePolicyConfig, loadWorkplacePolicy } from '../../src/lib/core/workplace-policy.mjs';
import { exitedNonZero, describeSpawn } from '../../../tests/helpers/describe-spawn.mjs';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const policy = { onsite_locations: ['Barcelona'], remote_countries: ['Spain'], remote_regions: ['Europe', 'EU', 'EMEA', 'Worldwide'] };
test('web config shape mirror agrees with the core and only a missing file is absent', async () => {
  const cases = [undefined, null, [], false, '', 42, new Date(0), {}, { location_filter: [] }, { location_filter: null }, { location_filter: {} }, { location_filter: { workplace_policy: null } }, { location_filter: { workplace_policy: policy } }];
  for (const config of cases) {
    const outcome = fn => {
      try { return { value: fn(config) }; } catch (error) { return { error: error.message }; }
    };
    assert.deepEqual(outcome(workplacePolicyConfig), outcome(workplacePolicyFromConfig));
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-config-'));
  try {
    assert.equal((await loadWorkplacePolicy(root, ROOT))('Remote Australia').eligible, true);
    for (const text of ['- location_filter: {}\n', 'location_filter: { workplace_policy: null }\n', '# only comments\n']) {
      fs.writeFileSync(path.join(root, 'portals.yml'), text);
      await assert.rejects(loadWorkplacePolicy(root, ROOT), /mapping|must be an object|expected a document/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('live scanner evidence survives JSON for review and repeated Inbox admission', () => {
  const job = { company: 'Fixture', title: 'Sales Engineer', url: 'https://jobs.example/eligible', location: 'Remote', eligibleCountries: ['Spain'], workplaceType: 'Remote' };
  const packet = JSON.parse(formatLiveOfferLine({ ...job, geographyEvidence: captureWorkplaceEvidence(job) }, 'fixture'));
  assert.equal(buildWorkplacePolicy(policy)(packet.location, packet.title, packet).eligible, true);
  const blocked = { ...packet, location: 'Remote Europe', geographyEvidence: captureWorkplaceEvidence({ description: 'This role is restricted to UK residents.' }) };
  assert.equal(buildWorkplacePolicy(policy)(blocked.location, blocked.title, blocked).eligible, false);
});
test('actual Add-to-Inbox adapter rejects a mixed selection before either writer', () => {
  const adapter = pathToFileURL(path.join(ROOT, 'web/src/lib/core/pipeline.ts')).href;
  const loader = pathToFileURL(path.join(ROOT, 'web/tests/helpers/web-ts-alias-loader.mjs')).href;
  const code = `
    const { addOffersToPipeline } = await import(${JSON.stringify(adapter)});
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    console.log(JSON.stringify(await addOffersToPipeline(JSON.parse(text))));
  `;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-workplace-'));
  try {
    fs.mkdirSync(path.join(temp, 'data'));
    fs.writeFileSync(path.join(temp, 'portals.yml'), yaml.dump({ location_filter: { workplace_policy: policy } }));
    const offer = (id, location, evidence) => ({ company: 'Fixture', title: 'Sales Engineer ' + id, source: 'fixture', url: 'https://jobs.example/' + id, location, geographyEvidence: evidence });
    const input = [offer('spain', 'Remote', { eligibleCountries: ['Spain'] }), offer('perth', 'Remote Australia'), offer('uk', 'Remote Europe', { description: 'This role is restricted to UK residents.' })];
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('CAREER_OPS_')) delete env[key];
    Object.assign(env, { CAREER_OPS_ROOT: temp, CAREER_OPS_CODE_ROOT: ROOT });
    const run = offers => spawnSync(process.execPath, ['--experimental-strip-types', '--import', loader, '--input-type=module', '-e', code], { cwd: temp, input: JSON.stringify(offers), env, encoding: 'utf8', timeout: 15_000 });
    const result = run(input);
    assert.equal(result.status, 0, describeSpawn(result, 'Add to Inbox rejects a mixed selection'));
    const outcome = JSON.parse(result.stdout);
    assert.equal(outcome.added, 0, result.stdout);
    assert.match(outcome.error, /Nothing was added.*allowed location separately/);
    assert.equal(fs.existsSync(path.join(temp, 'data/pipeline.md')), false, 'mixed selection writes nothing');
    assert.equal(fs.existsSync(path.join(temp, 'data/scan-history.tsv')), false, 'mixed selection records no success');
    const valid = run([input[0]]);
    assert.equal(valid.status, 0, describeSpawn(valid, 'Add to Inbox accepts eligible evidence'));
    assert.equal(JSON.parse(valid.stdout).added, 1, valid.stdout);
    const pipeline = fs.readFileSync(path.join(temp, 'data/pipeline.md'), 'utf8');
    assert.match(pipeline, /jobs.example\/spain/);
    assert.doesNotMatch(pipeline, /jobs.example\/(?:perth|uk)/);
    const history = fs.readFileSync(path.join(temp, 'data/scan-history.tsv'), 'utf8');
    const malformed = ['- location_filter: {}\n', 'location_filter: { workplace_policy: null }\n', 'location_filter: []\n', 'location_filter: [\n'];
    for (let i = 0; i < malformed.length; i++) {
      fs.writeFileSync(path.join(temp, 'portals.yml'), malformed[i]);
      const rejected = run([offer(`invalid-${i}`, 'Remote Spain')]);
      assert.equal(rejected.status, 0, describeSpawn(rejected, 'Add to Inbox reports invalid configuration'));
      const outcome = JSON.parse(rejected.stdout);
      assert.equal(outcome.added, 0);
      assert.ok(outcome.error);
      assert.equal(fs.readFileSync(path.join(temp, 'data/pipeline.md'), 'utf8'), pipeline);
      assert.equal(fs.readFileSync(path.join(temp, 'data/scan-history.tsv'), 'utf8'), history);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Discover retains saved policy and geography evidence with a separate data root', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-workplace-'));
  try {
    const engine = path.join(temp, 'engine');
    const data = path.join(temp, 'data-only');
    fs.mkdirSync(engine);
    fs.mkdirSync(data);
    const portals = yaml.dump({ location_filter: { workplace_policy: policy } });
    fs.writeFileSync(path.join(data, 'portals.yml'), portals);
    const evidence = { eligibleCountries: ['Spain'], workplaceType: 'Remote' };
    const offer = { company: 'Fixture', title: 'Sales Engineer', url: 'https://jobs.example/1', location: 'Remote', geographyEvidence: evidence };
    // Only the external scanner transport is a fixture. Exercise the actual
    // writeTempPortals, JSON/live ingestion and DiscoveredOffer adaptation.
    fs.writeFileSync(path.join(engine, 'scan-ats-full.mjs'), `
      // --json capHit
      import fs from 'node:fs';
      const filters = fs.readFileSync(process.env.CAREER_OPS_PORTALS, 'utf8');
      if (!filters.includes('workplace_policy:') || !filters.includes('Spain')) throw new Error('saved policy was dropped');
      const offer = ${JSON.stringify(offer)};
      console.error(JSON.stringify({ kind: 'offer', ...offer }));
      console.log(JSON.stringify({ offers: [offer], companiesScanned: 1, companiesAvailable: 1, capHit: false }));
    `);
    const loader = pathToFileURL(path.join(ROOT, 'web/tests/helpers/web-ts-alias-loader.mjs')).href;
    const source = pathToFileURL(path.join(ROOT, 'web/src/lib/core/scan.ts')).href;
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith('CAREER_OPS_')) delete env[key];
    Object.assign(env, { CAREER_OPS_ROOT: data, CAREER_OPS_CODE_ROOT: engine });
    const code = `
      const { runDiscovery } = await import(${JSON.stringify(source)});
      const filters = { positive: ['Sales Engineer'], negative: [], allow: [], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7, ats: ['ashby'], limitPerAts: 10 };
      const events = [];
      const offers = await runDiscovery(filters, event => events.push(event));
      console.log(JSON.stringify({ offers, events }));
    `;
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--import', loader, '--input-type=module', '-e', code], { cwd: engine, env, encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0, describeSpawn(result, 'Discover preserves policy and evidence'));
    const outcome = JSON.parse(result.stdout);
    assert.equal(outcome.events.some(e => e.kind === 'error'), false, result.stdout);
    assert.equal(outcome.offers.length, 1);
    assert.deepEqual(outcome.offers[0].geographyEvidence, evidence);
    assert.equal(buildWorkplacePolicy(policy)(outcome.offers[0].location, outcome.offers[0].title, outcome.offers[0]).eligible, true);
    assert.equal(fs.readFileSync(path.join(data, 'portals.yml'), 'utf8'), portals, 'saved config was not rewritten');
    for (const text of ['- location_filter: {}\n', 'location_filter: { workplace_policy: null }\n']) {
      fs.writeFileSync(path.join(data, 'portals.yml'), text);
      const rejected = spawnSync(process.execPath, ['--experimental-strip-types', '--import', loader, '--input-type=module', '-e', code], { cwd: engine, env, encoding: 'utf8', timeout: 15_000 });
      assert.ok(exitedNonZero(rejected), describeSpawn(rejected, 'Discover must reject malformed saved geography config'));
      assert.match(rejected.stderr, /mapping|must be an object/);
      assert.equal(fs.readFileSync(path.join(data, 'portals.yml'), 'utf8'), text);
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
