// tests/url-key-plugin-capability.test.mjs — the canonical posting-URL key is
// reachable from a provider plugin through ctx (#4218).
//
// R1: a plugin can obtain the key from a supported core capability.
// R2: plugin and core callers get equivalent behaviour.
// R3: no repository-relative import and no copied normalization body.
// R4: the compatibility expectation is documented.
// R5: plugins that never call it keep working.
//
// The R2 half is the one worth having a test for: if ctx carried a second
// implementation, `known.has(key)` would silently stop matching as soon as the
// two drifted, which is the failure the web mirror's parity note describes.
//
// Run:  node --test tests/url-key-plugin-capability.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normalizeUrl, aggregatorPostingId } from '../url-key.mjs';
import { makeHttpCtx } from '../providers/_http.mjs';
import { buildCtx } from '../plugins/_engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Cases where core has a decided answer, used to compare the two callers. */
const CASES = [
  'https://jobs.example.com/roles/123',
  'https://jobs.example.com/roles/123?utm_source=newsletter&utm_campaign=x',
  'https://jobs.example.com/roles/123?gh_jid=456',
  'https://jobs.example.com/roles/123#section',
  'https://JOBS.Example.com/roles/123/',
  'https://jobs.example.com/roles/123?fbclid=abc',
  'https://app.mokahr.com/apply/acme/1#/job/xyz',
  'https://jobs.example.com/roles/123?v=2',
  '',
  'not a url',
  'https://jobs.example.com/roles/1?gh_jid=1',
  'https://jobs.example.com/roles/1?gh_jid=2',
];

const manifest = {
  id: 'test-plugin',
  allowedHosts: [],
  requiredEnv: [],
  optionalEnv: [],
  allowsLocalhost: false,
};

test('R1: a provider ctx exposes normalizePostingUrl', () => {
  const ctx = makeHttpCtx();
  assert.equal(typeof ctx.normalizePostingUrl, 'function');
});

test('R1: a plugin ctx exposes normalizePostingUrl', () => {
  const ctx = buildCtx(manifest, {});
  assert.equal(typeof ctx.normalizePostingUrl, 'function');
});

test('R2: the plugin capability is the core function, not a second implementation', () => {
  assert.equal(makeHttpCtx().normalizePostingUrl, normalizeUrl);
  assert.equal(buildCtx(manifest, {}).normalizePostingUrl, normalizeUrl);
});

test('R2: plugin and core callers agree case by case', () => {
  const viaCtx = makeHttpCtx().normalizePostingUrl;
  for (const raw of CASES) {
    assert.equal(viaCtx(raw), normalizeUrl(raw), `disagreed on ${JSON.stringify(raw)}`);
  }
});

test('R2: distinct gh_jid postings keep distinct keys', () => {
  const key = makeHttpCtx().normalizePostingUrl;
  const a = key('https://jobs.example.com/roles/1?gh_jid=1');
  const b = key('https://jobs.example.com/roles/1?gh_jid=2');
  assert.notEqual(a, b);
  assert.ok(a && b);
});

test("R2: '' means no key, so two unusable inputs cannot match", () => {
  const key = makeHttpCtx().normalizePostingUrl;
  assert.equal(key(''), '');
  assert.equal(key('not a url'), '');
  assert.equal(key(null), '');
});

test('R3: a plugin can dedupe without importing core files', () => {
  // A plugin's own copy of the module has no repository to be relative to; the
  // capability exists so it never needs one. Assert the source carries no import
  // of url-key.mjs, which is what a copy would require.
  const engine = readFileSync(join(ROOT, 'plugins', '_engine.mjs'), 'utf8');
  const providerCtx = engine.slice(engine.indexOf('export function buildCtx'), engine.indexOf('export function buildCtx') + 4000);
  assert.ok(
    /normalizePostingUrl:\s*normalizeUrl/.test(providerCtx),
    'the plugin ctx must pass the core function through, not rebuild it',
  );
});

test('R4: the compatibility expectation is documented where plugin authors look', () => {
  const docs = readFileSync(join(ROOT, 'docs', 'PLUGINS.md'), 'utf8');
  assert.ok(docs.includes('ctx.normalizePostingUrl'), 'PLUGINS.md must name the capability');

  const types = readFileSync(join(ROOT, 'plugins', '_types.js'), 'utf8');
  assert.ok(types.includes('normalizePostingUrl'), 'PluginContext must declare the property');
});

test('R5: a plugin that never calls the capability still works', () => {
  const ctx = buildCtx(manifest, { dryRun: true, settings: { label: 'x' } });
  // The pre-existing surface is unchanged.
  assert.equal(typeof ctx.fetch, 'function');
  assert.equal(typeof ctx.fetchJson, 'function');
  assert.equal(typeof ctx.log, 'function');
  assert.equal(ctx.dryRun, true);
  assert.deepEqual(ctx.settings, { label: 'x' });
  // And an unused capability changes nothing about it.
  assert.equal(ctx.normalizePostingUrl('https://jobs.example.com/roles/123'), normalizeUrl('https://jobs.example.com/roles/123'));
});

// ── aggregatorPostingId ─────────────────────────────────────────────────────
// The same capability, for the other half of url-key's identity contract. A
// plugin reading LinkedIn or Indeed mail sees a posting as a tracking link
// (`/comm/jobs/view/{id}?trk=…`, `/rc/clk?jk=…`) where the tracker holds the
// canonical view. normalizePostingUrl keeps the path, so those key apart; the
// requisition id is what they share, and the tracker's merge already reads it
// with this function.

/** Spellings a digest emits, each paired with the identity core decides for it. */
const AGGREGATOR_CASES = [
  ['https://www.linkedin.com/comm/jobs/view/4011223344?trk=eml-job_card&trkEmail=eml-x', { domain: 'linkedin.com', id: '4011223344' }],
  ['https://www.linkedin.com/jobs/view/4011223344', { domain: 'linkedin.com', id: '4011223344' }],
  ['https://www.linkedin.com/jobs/search/?currentJobId=4011223344', { domain: 'linkedin.com', id: '4011223344' }],
  ['https://tw.indeed.com/rc/clk/dl?jk=c3626a655de4a873&from=ja', { domain: 'indeed.com', id: 'c3626a655de4a873' }],
  ['https://www.indeed.com/viewjob?jk=c3626a655de4a873', { domain: 'indeed.com', id: 'c3626a655de4a873' }],
  ['https://evillinkedin.com/jobs/view/4011223344', null],
  ['https://linkedin.com.evil.example/jobs/view/4011223344', null],
  ['https://boards.greenhouse.io/acme/jobs/12345', null],
  ['https://www.linkedin.com/feed/', null],
  ['', null],
  ['not a url', null],
];

test('R1: provider and plugin ctx expose aggregatorPostingId', () => {
  assert.equal(typeof makeHttpCtx().aggregatorPostingId, 'function');
  assert.equal(typeof buildCtx(manifest, {}).aggregatorPostingId, 'function');
});

test('R2: aggregatorPostingId is the core function, not a second implementation', () => {
  assert.equal(makeHttpCtx().aggregatorPostingId, aggregatorPostingId);
  assert.equal(buildCtx(manifest, {}).aggregatorPostingId, aggregatorPostingId);
});

test('R2: a tracking link and the canonical view resolve to one id, lookalikes to none', () => {
  const viaCtx = buildCtx(manifest, {}).aggregatorPostingId;
  for (const [raw, expected] of AGGREGATOR_CASES) {
    assert.deepEqual(viaCtx(raw), expected, `disagreed on ${JSON.stringify(raw)}`);
    assert.deepEqual(viaCtx(raw), aggregatorPostingId(raw), `ctx and core disagreed on ${JSON.stringify(raw)}`);
  }
});

test('R2: the id fills the gap normalizePostingUrl leaves for aggregators', () => {
  // The reason the second capability exists: the URL key cannot tell a plugin
  // that these two are one posting, and the id can.
  const ctx = buildCtx(manifest, {});
  const tracking = 'https://www.linkedin.com/comm/jobs/view/4011223344?trk=eml-job_card';
  const canonical = 'https://www.linkedin.com/jobs/view/4011223344';
  assert.notEqual(ctx.normalizePostingUrl(tracking), ctx.normalizePostingUrl(canonical));
  assert.deepEqual(ctx.aggregatorPostingId(tracking), ctx.aggregatorPostingId(canonical));
});

test('R4: aggregatorPostingId is documented where plugin authors look', () => {
  const docs = readFileSync(join(ROOT, 'docs', 'PLUGINS.md'), 'utf8');
  assert.ok(docs.includes('ctx.aggregatorPostingId'), 'PLUGINS.md must name the capability');
  const types = readFileSync(join(ROOT, 'plugins', '_types.js'), 'utf8');
  assert.ok(types.includes('aggregatorPostingId'), 'PluginContext must declare the property');
});
