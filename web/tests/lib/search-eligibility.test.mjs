import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import '../helpers/web-ts-alias-loader.mjs';

const { runDiscovery } = await import('@/lib/core/scan');
const { seedExploreFilters } = await import('@/lib/core/portals');
const base = { opportunityType: 'employment', positive: [], negative: [], allow: [], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7, ats: ['greenhouse'], markets: [], limitPerAts: 150 };

function scannerFixture(t, jobs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'search-eligibility-'));
  const previous = { CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT, CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT, NODE_OPTIONS: process.env.NODE_OPTIONS };
  Object.assign(process.env, { CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: root });
  fs.mkdirSync(path.join(root, 'data/cache/ats-companies'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/cache/ats-companies/greenhouse.json'), '["acme"]');
  const scanner = new URL('../../../scan-ats-full.mjs', import.meta.url);
  const preload = path.join(root, 'provider-fixture.mjs');
  fs.writeFileSync(preload, `
    import greenhouse from ${JSON.stringify(new URL('../../../providers/greenhouse.mjs', import.meta.url).href)};
    greenhouse.fetch = async () => ${JSON.stringify(jobs)}.map(job => ({ company:'Acme', location:'London, UK', postedAt:Date.now(), ...job }));
    globalThis.fetch = () => { throw new Error('Network forbidden in fixture'); };`);
  // Keep the real scanner as the entry; its canonical isMainModule guard
  // handles this symlink while --import installs the provider fixture first.
  fs.symlinkSync(fileURLToPath(scanner), path.join(root, 'scan-ats-full.mjs'));
  process.env.NODE_OPTIONS = [previous.NODE_OPTIONS, '--import', JSON.stringify(pathToFileURL(preload).href)].filter(Boolean).join(' ');
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('actual seeded scanner/core preserves canonical title operators in precise and broad eligibility', async t => {
  const cases = [
    { query:'word:agent', titles:['AI Agent Engineer', 'Agentic Engineer', 'Reagents Engineer'], expected:['AI Agent Engineer'] },
    { query:'stem:agent', titles:['Agentic Engineer', 'AI Agent Engineer', 'Reagents Engineer'], expected:['Agentic Engineer', 'AI Agent Engineer'] },
    { query:'Python + SQL', titles:['Python Developer with SQL', 'SQL and Python Engineer', 'Python Developer', 'SQL Analyst'], expected:['Python Developer with SQL', 'SQL and Python Engineer'] },
  ];
  for (const phase of ['precise', 'broad']) for (const { query, titles, expected } of cases) await t.test(`${query}: ${phase}`, async t => {
    const postedAt = Date.now() - (phase === 'broad' ? 10 : 0) * 86_400_000;
    const root = scannerFixture(t, titles.map((title, index) => ({ title, postedAt, url:`https://acme.test/jobs/${index}` })));
    fs.writeFileSync(path.join(root, 'portals.yml'), `title_filter:\n  positive: [${JSON.stringify(query)}]\n`);
    const seeded = seedExploreFilters();
    assert.deepEqual(seeded.filters.positive, [query], 'the real portal seed preserves explicit operator syntax');
    const events = [];
    const offers = await runDiscovery({ ...base, positive:seeded.filters.positive }, event => events.push(event));
    assert.deepEqual(offers.map(offer => offer.title).sort(), [...expected].sort());
    assert.deepEqual(offers.map(offer => [offer.match.components.role, offer.match.total, offer.match.reasons[0], offer.matchedKeyword]),
      expected.map(() => [60, phase === 'broad' ? 70 : 75, `Função pedida: «${query}».`, query]), 'operator evidence must survive eligibility, ranking and the matched-query receipt');
    assert.ok(offers.every(offer => !offer.match.occupation), 'explicit operators must not invent catalog occupation evidence');
    assert.deepEqual(events.filter(event => event.kind === 'offer').map(event => event.offer.title).sort(), [...expected].sort());
    assert.ok(events.filter(event => event.kind === 'offer').every(event => event.offer.matchedKeyword === query));
    assert.deepEqual(events.filter(event => event.kind === 'phaseStart').map(event => event.phase), phase === 'broad' ? ['precise', 'broad'] : ['precise']);
    assert.equal(events.findLast(event => event.kind === 'summary').status, 'ok');
  });
});

test('actual ATS scanner/core rejects Presales Assistant and retains boundary-matched requested roles', async t => {
  scannerFixture(t, ['Presales Assistant', 'Sales Assistant'].map((title, index) => ({ title, url: `https://acme.test/jobs/${index}` })));
  const events = [];
  const offers = await runDiscovery({ ...base, positive: ['Sales Assistant'] }, event => events.push(event));
  assert.deepEqual(offers.map(offer => offer.title), ['Sales Assistant']);
  assert.ok(offers.every(offer => offer.match.components.role > 0));
  assert.deepEqual(events.filter(event => event.kind === 'offer').map(event => event.offer.title), ['Sales Assistant']);
});

test('unknown and ambiguous literal occupations remain eligible without catalog aliases', async t => {
  scannerFixture(t, ['Senior Quantum Mechanic', 'Quantum Mechanics', 'Developer'].map((title, index) => ({ title, url: `https://acme.test/jobs/${index}` })));
  assert.deepEqual((await runDiscovery({ ...base, positive: ['Quantum Mechanic'] }, () => {})).map(offer => offer.title), ['Senior Quantum Mechanic']);
  assert.deepEqual((await runDiscovery({ ...base, positive: ['Developer'] }, () => {})).map(offer => offer.title), ['Developer']);
});

test('occupation aliases enter only after the healthy precise zero broadens', async t => {
  scannerFixture(t, [{ title: 'Sales Assistant', url: 'https://acme.test/jobs/1' }]);
  const events = [];
  const offers = await runDiscovery({ ...base, positive: ['Assistente de Vendas'] }, event => events.push(event));
  assert.deepEqual(events.filter(event => event.kind === 'phaseStart').map(event => event.phase), ['precise', 'broad']);
  assert.deepEqual(offers.map(offer => offer.title), ['Sales Assistant']);
});

test('ATS-only resolved London rejects Ontario without selecting a market', async t => {
  scannerFixture(t, ['London, UK', 'London, Ontario, Canada', 'Moonbase Seven'].map((location, index) => ({ location, title:'Sales Assistant', url:`https://acme.test/jobs/${index}` })));
  const events = [];
  const offers = await runDiscovery({ ...base, positive:['Sales Assistant'], allow:['London'] }, event => events.push(event));
  assert.deepEqual(offers.map(offer => offer.location), ['London, UK']);
  assert.deepEqual(events.filter(event => event.kind === 'offer').map(event => event.offer.location), ['London, UK']);
  assert.deepEqual((await runDiscovery({ ...base, positive:['Sales Assistant'], allow:['Moonbase Seven'] }, () => {})).map(offer => offer.location), ['Moonbase Seven']);
  assert.equal((await runDiscovery({ ...base, positive:['Sales Assistant'] }, () => {})).length, 3, 'no location selection remains permissive');
  assert.deepEqual(base.markets, []);
});
