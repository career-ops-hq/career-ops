// tests/providers/freelancermap.test.mjs — provider-contract tests for the
// freelancermap project search provider (providers/freelancermap.mjs).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — freelancermap');

function row(over = {}) {
  return {
    id: 1,
    slug: 'ai-engineer-m-w-d',
    title: 'AI Engineer (m/w/d)',
    company: 'Acme Consulting GmbH',
    city: 'Exampleburg',
    country: { nameDe: 'Deutschland', nameEn: 'Germany' },
    created: '2026-10-28T14:41:58+01:00',
    beginningMonth: '12',
    beginningYear: '2026',
    durationText: '6 Monate',
    projectContractType: { type: 'contracting', remoteInPercent: 100 },
    skills: [{ de: 'Python', en: 'Python (Programming Language)' }],
    links: { project: '/projekt/ai-engineer-m-w-d' },
    description: '<div><span>Für unseren Kunden &amp; Partner</span></div>',
    ...over,
  };
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/freelancermap.mjs')).href);
  const provider = mod.default;
  const { parseFreelancermapSearch, buildSearchUrl, resolveSite, parseQueries } = mod;

  if (provider.id === 'freelancermap') pass('freelancermap.id is "freelancermap"');
  else fail(`freelancermap.id is ${JSON.stringify(provider.id)}`);

  const hitDe = provider.detect({ name: 'Acme', provider: 'freelancermap' });
  const hitCom = provider.detect({ name: 'Acme', provider: 'freelancermap', site: 'com' });
  if (hitDe?.url === 'https://www.freelancermap.de/project/search/ajax' && hitCom?.url === 'https://www.freelancermap.com/project/search/ajax') pass('detect() claims provider:freelancermap (de default, com on site:com)');
  else fail(`detect() = ${JSON.stringify([hitDe, hitCom])}`);
  if (provider.detect({ careers_url: 'https://www.freelancermap.de/projekte' }) === null && provider.detect(null) === null) pass('detect() is explicit-only');
  else fail('detect() should be explicit-only');

  if (resolveSite({}) === 'de' && resolveSite({ site: 'com' }) === 'com') pass('resolveSite defaults to de, accepts com');
  else fail('resolveSite');
  try { resolveSite({ name: 'X', site: 'evil.example' }); fail('resolveSite should reject an unknown site'); }
  catch (e) { if (/use 'de' or 'com'/.test(e.message)) pass('resolveSite rejects an unknown site loudly'); else fail(e.message); }
  if (JSON.stringify(parseQueries({ queries: ['KI', ' KI ', ''] })) === '["KI"]' && JSON.stringify(parseQueries({})) === '[""]') pass('parseQueries trims/dedups and defaults to one unfiltered pass');
  else fail('parseQueries');

  const u = new URL(buildSearchUrl('com', 'machine learning', true));
  if (u.origin === 'https://www.freelancermap.com' && u.pathname === '/project/search/ajax' && u.searchParams.get('query') === 'machine learning' && u.searchParams.get('remoteInPercent[0]') === '100' && u.searchParams.get('sort') === '1') {
    pass('buildSearchUrl: fixed host per site, query, 100 % remote filter, newest first');
  } else fail(`buildSearchUrl = ${u.href}`);
  if (!new URL(buildSearchUrl('de', '', false)).searchParams.has('remoteInPercent[0]')) pass('buildSearchUrl omits the remote filter unless remote_only');
  else fail('remote filter should be opt-in');

  // parseFreelancermapSearch
  const sample = {
    count: 5,
    projects: [
      row(),
      row({ id: 2, slug: 'leasing', links: { project: '/projekt/leasing' }, title: 'Admin &amp; Ops', company: '', poster: { company: 'Poster Co' }, city: 'Germany', country: { nameEn: 'Germany' }, projectContractType: { type: 'employee_leasing', remoteInPercent: 60 }, created: 'garbage', beginningMonth: null, beginningText: 'ab sofort', durationText: null }),
      row({ id: 3, slug: 'paused', links: { project: '/projekt/paused' }, applicationsPaused: true }),
      row({ id: 4, slug: '\uD800', links: {} }),
      row({ id: 5, title: '   ', slug: 'no-title', links: {} }),
      null,
    ],
    topProjects: [row()],
  };
  const jobs = parseFreelancermapSearch(sample, 'de');
  if (jobs.length === 2) pass('parse keeps 2 rows: drops paused, bad-slug, title-less and null rows; top duplicate merged');
  else fail(`parse returned ${jobs.length}: ${JSON.stringify(jobs.map(j => j.url))}`);
  const [a, b] = jobs;
  if (a?.url === 'https://www.freelancermap.de/projekt/ai-engineer-m-w-d' && a.company === 'Acme Consulting GmbH' && a.location === 'Exampleburg, Germany · Remote (100%)') pass('row 0: project URL, company, English country + remote share');
  else fail(`row 0 = ${JSON.stringify(a)}`);
  if (a?.description.startsWith('Engagement: freelance (contracting)') && a.description.includes('Start: 12/2026') && a.description.includes('Duration: 6 Monate') && a.description.includes('Skills: Python') && a.description.includes('Für unseren Kunden & Partner')) {
    pass('row 0 description: engagement first, start, duration, skills, decoded plain-text snippet');
  } else fail(`row 0 description = ${JSON.stringify(a?.description)}`);
  if (a?.postedAt === Date.parse('2026-10-28T14:41:58+01:00')) pass('row 0 postedAt from created');
  else fail(`row 0 postedAt = ${a?.postedAt}`);
  if (b?.title === 'Admin & Ops' && b.company === 'Poster Co' && b.location === 'Germany · Remote 60%' && b.postedAt === undefined && b.description.startsWith('Engagement: employee leasing (ANÜ)') && b.description.includes('Start: ab sofort')) {
    pass('row 1: entity-decoded title, poster company fallback, no duplicated country, partial remote, bad date dropped');
  } else fail(`row 1 = ${JSON.stringify(b)}`);
  const com = parseFreelancermapSearch({ projects: [row({ links: { project: '/project/go-developer-3066146' }, slug: 'go-developer-3066146' })] }, 'com');
  if (com[0]?.url === 'https://www.freelancermap.com/project/go-developer-3066146' && com[0].description.includes('Skills: Python (Programming Language)')) pass('com site: /project/ path and English skill names');
  else fail(`com row = ${JSON.stringify(com[0])}`);

  // Empty vs broken
  if (parseFreelancermapSearch({ projects: [], count: 0 }).length === 0) pass('present-and-empty projects[] → []');
  else fail('empty projects[] should yield []');
  for (const [label, body] of [['{}', {}], ['projects:null', { projects: null }], ['html string', '<html>'], ['null', null]]) {
    try { parseFreelancermapSearch(body); fail(`parse(${label}) should throw`); }
    catch (e) {
      if (/freelancermap: unexpected response/.test(e.message)) pass(`parse(${label}) throws a descriptive error`);
      else fail(`parse(${label}) threw ${e.message}`);
    }
  }

  // fetch(): one POST per query, redirect:'error', fixed host
  {
    const calls = [];
    const ctx = {
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        const q = new URL(url).searchParams.get('query');
        return { projects: [row({ slug: `p-${q}`, links: { project: `/projekt/p-${q}` } }), row()] };
      },
    };
    const out = await provider.fetch({ name: 'Acme', provider: 'freelancermap', queries: ['KI', 'LLM'], remote_only: true, max_pages: 9 }, ctx);
    if (calls.length === 2 && out.length === 3) pass('fetch(): one request per query (max_pages has no effect), results de-duplicated');
    else fail(`fetch() calls ${calls.length}, jobs ${out.length}`);
    if (calls.every(c => c.opts?.redirect === 'error' && c.opts?.method === 'POST' && c.url.startsWith('https://www.freelancermap.de/project/search/ajax?'))) pass('every request is a POST to the fixed host with redirect:\'error\'');
    else fail(`calls = ${JSON.stringify(calls)}`);
  }

  // Probe: one request; rejection propagates unwrapped
  {
    let n = 0;
    await provider.fetch({ name: 'Acme', provider: 'freelancermap', queries: ['a', 'b', 'c'] }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { n++; return { projects: [] }; } });
    if (n === 1) pass('ctx.maxPages:1 → exactly one list request');
    else fail(`probe made ${n} requests`);
    const sentinel = new Error('ProbePageBudgetReached');
    try {
      await provider.fetch({ name: 'Acme', provider: 'freelancermap' }, { maxPages: 1, sleep: async () => {}, fetchJson: async () => { throw sentinel; } });
      fail('probe rejection should propagate');
    } catch (e) {
      if (e === sentinel) pass('a ctx.fetch* rejection under the probe propagates unwrapped');
      else fail(`probe rejection rewrapped: ${e?.message}`);
    }
  }

  // One query failing keeps the others; all failing is loud
  {
    let n = 0;
    const origWarn = console.warn; const warns = [];
    console.warn = (m) => warns.push(String(m));
    let out;
    try {
      out = await provider.fetch({ name: 'Acme', provider: 'freelancermap', queries: ['a', 'b'] }, { sleep: async () => {}, fetchJson: async () => { n++; if (n === 1) return { error: 'x' }; return { projects: [row()] }; } });
    } finally { console.warn = origWarn; }
    if (out.length === 1 && warns.some(w => /failed/.test(w))) pass('one failing query is warned about; the rest stand');
    else fail(`partial: ${out?.length} jobs, warns ${JSON.stringify(warns)}`);
    console.warn = () => {};
    try { await provider.fetch({ name: 'Acme', provider: 'freelancermap' }, { sleep: async () => {}, fetchJson: async () => ({}) }); fail('all-failed should throw'); }
    catch (e) { if (/unexpected response/.test(e.message)) pass('every query failing throws instead of returning []'); else fail(e.message); }
    finally { console.warn = origWarn; }
  }
} catch (e) {
  fail(`freelancermap provider tests crashed: ${e.stack || e.message}`);
}
