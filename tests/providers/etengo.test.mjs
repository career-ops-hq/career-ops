// tests/providers/etengo.test.mjs — provider-contract tests for the Etengo
// IT project list provider (providers/etengo.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — etengo');

/** @param {string} id @param {string} title @param {Record<string,string>} fields */
function card(id, title, fields) {
  const cells = Object.entries(fields)
    .map(([k, v]) => `<div class="col col-1-2">\n  <small>${k}</small>\n  <span>${v}</span>\n</div>`)
    .join('\n');
  return `<div class="col col-1-3">\n<div class="card card-project">\n<div class="card-content">\n`
    + `<h3 class="headline-4"><a href="https://www.etengo.de/it-projektsuche/${id}/" target="_blank" title="${title}">${title}</a></h3>\n`
    + `<div class="grid">\n${cells}\n</div></div></div></div>`;
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/etengo.mjs')).href);
  const provider = mod.default;
  const { parseEtengoFilter } = mod;

  if (provider.id === 'etengo') pass('etengo.id is "etengo"');
  else fail(`etengo.id is ${JSON.stringify(provider.id)}`);

  const hit = provider.detect({ name: 'Acme', provider: 'etengo' });
  if (hit && hit.url === 'https://www.etengo.de/it-projektsuche/') pass('detect() claims provider:etengo with no careers_url');
  else fail(`detect() returned ${JSON.stringify(hit)}`);
  if (provider.detect({ careers_url: 'https://www.etengo.de/it-projektsuche/' }) === null && provider.detect(null) === null) pass('detect() is explicit-only');
  else fail('detect() should be explicit-only');

  const sample = {
    totalCount: 4,
    items: [
      card('103656', 'Microsoft KI &amp; Agent Governance Experte', { 'Projekt-ID': 'CA-103656', PLZ: 'DE 7XXXX', Laufzeit: '5 Monate', Start: '01.12.2026', Branche: 'Healthcare' }),
      card('103644', 'VDI Consultant', { 'Projekt-ID': 'CA-103644', PLZ: 'DE XXXXX' }),
      '<div class="card card-project"><h3>No link</h3></div>',
      card('103600', '', { PLZ: 'DE 1XXXX' }),
      42,
    ],
  };
  const { jobs, total } = parseEtengoFilter(sample);
  if (jobs.length === 2 && total === 4) pass('parseEtengoFilter keeps 2 cards; drops link-less, title-less and non-string items');
  else fail(`parsed ${jobs.length} jobs, total ${total}`);
  const [a, b] = jobs;
  if (a?.title === 'Microsoft KI & Agent Governance Experte' && a.url === 'https://www.etengo.de/it-projektsuche/103656/') pass('title entity-decoded; canonical project URL');
  else fail(`row 0 = ${JSON.stringify(a)}`);
  if (a?.company === 'Etengo (agency, end client not named)' && a.location === 'Germany (postal area 7XXXX)') pass('agency label for the unnamed end client; masked postcode kept as given');
  else fail(`row 0 company/location = ${JSON.stringify([a?.company, a?.location])}`);
  if (a?.description === 'Engagement: freelance (via Etengo AG) · Projekt-ID: CA-103656 · Laufzeit: 5 Monate · Start: 01.12.2026 · Branche: Healthcare · PLZ: DE 7XXXX') pass('description: engagement first, then only the card\'s own fields');
  else fail(`row 0 description = ${JSON.stringify(a?.description)}`);
  if (b?.location === 'Germany' && !('postedAt' in b)) pass('fully masked postcode → "Germany"; no invented date');
  else fail(`row 1 = ${JSON.stringify(b)}`);

  // Empty vs broken
  if (parseEtengoFilter({ items: [], totalCount: 0 }).jobs.length === 0) pass('present-and-empty items[] → []');
  else fail('empty items[] should yield []');
  for (const [label, body] of [['{}', {}], ['items:null', { items: null }], ['items:string', { items: '<div>' }], ['null', null]]) {
    try { parseEtengoFilter(body); fail(`parseEtengoFilter(${label}) should throw`); }
    catch (e) {
      if (/etengo: unexpected response/.test(e.message)) pass(`parseEtengoFilter(${label}) throws a descriptive error`);
      else fail(`parseEtengoFilter(${label}) threw ${e.message}`);
    }
  }
  try {
    parseEtengoFilter({ items: ['<div class="tile"><a class="x" data-href="1" href="https://www.etengo.de/it-projektsuche/1/"></a></div>'] });
    fail('project links with no parsed card should throw');
  } catch (e) {
    if (/markup changed/.test(e.message)) pass('project links present but zero cards parsed → markup-change throw');
    else fail(e.message);
  }

  // fetch(): exactly one request, fixed host, redirect:'error'
  {
    const calls = [];
    const out = await provider.fetch({ name: 'Acme', provider: 'etengo' }, {
      sleep: async () => {},
      fetchJson: async (url, opts) => { calls.push({ url, opts }); return sample; },
    });
    if (calls.length === 1 && out.length === 2) pass('fetch() makes one request and returns parsed jobs');
    else fail(`fetch() calls ${calls.length}, jobs ${out.length}`);
    if (calls[0]?.url === 'https://www.etengo.de/?action=etengo/project/filter&zip=&branch=&text=' && calls[0].opts?.redirect === 'error') pass('the request goes to the fixed filter URL with redirect:\'error\'');
    else fail(`call = ${JSON.stringify(calls[0])}`);
  }

  // Probe: still one request; a rejection propagates unwrapped
  {
    const sentinel = new Error('ProbePageBudgetReached');
    try {
      await provider.fetch({ name: 'Acme', provider: 'etengo' }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw sentinel; } });
      fail('probe rejection should propagate');
    } catch (e) {
      if (e === sentinel) pass('a ctx.fetch* rejection under the probe propagates unwrapped');
      else fail(`probe rejection rewrapped: ${e?.message}`);
    }
  }

  // Truncated list (items < totalCount) warns
  {
    const origWarn = console.warn; const warns = [];
    console.warn = (m) => warns.push(String(m));
    try { await provider.fetch({ name: 'Acme', provider: 'etengo' }, { fetchJson: async () => ({ totalCount: 50, items: [sample.items[0]] }) }); }
    finally { console.warn = origWarn; }
    if (warns.some(w => /1 of 50/.test(w))) pass('fewer items than totalCount warns about a truncated list');
    else fail(`warns = ${JSON.stringify(warns)}`);
  }
} catch (e) {
  fail(`etengo provider tests crashed: ${e.stack || e.message}`);
}
