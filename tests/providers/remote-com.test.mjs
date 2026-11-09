// tests/providers/remote-com.test.mjs — Remote's own ATS (apply.remote.com).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { buildLocationFilter } from '../../scan.mjs';

console.log('\nProvider — remote-com');

const API_URL = 'https://apply.remote.com/api/public/jobs';

// Shape of the live /api/public/jobs payload (trimmed to the fields read, plus
// a couple that are not, so extra keys are proven harmless). Values are
// fictional.
const row = (over) => ({
  status: 'open',
  description: '.',
  title: 'Operations Lead',
  location: 'EMEA',
  tags: [],
  employment_type: 'Full-time',
  department: 'Operations',
  opened_at: '2026-10-30T09:52:09Z',
  accepting_applications: true,
  public_id: 'aaaaaaaa-0000-4000-8000-000000000001',
  workplace: 'remote',
  pay: { rows: [{ code: null, min: 1, max: 2, currency: 'EUR' }] },
  ...over,
});

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/remote-com.mjs')).href);
  const provider = mod.default;
  const { parseRemoteJobs, formatRemoteLocation } = mod;

  if (provider.id === 'remote-com') pass('remote-com.id is "remote-com"');
  else fail(`remote-com.id is ${JSON.stringify(provider.id)}`);

  // ── detect() ──
  const claims = [
    { careers_url: 'https://apply.remote.com/jobs' },
    { careers_url: 'https://apply.remote.com/' },
    { careers_url: 'https://APPLY.remote.com/jobs/aaaaaaaa-0000-4000-8000-000000000001' },
    { api: 'https://apply.remote.com/api/public/jobs' },
  ];
  const claimed = claims.filter((e) => provider.detect(e)?.url === API_URL).length;
  if (claimed === claims.length) pass('detect() claims apply.remote.com board, root, posting and api URLs');
  else fail(`detect() claimed ${claimed}/${claims.length} apply.remote.com entries`);

  const refused = [
    { careers_url: 'http://apply.remote.com/jobs' },          // not https
    { careers_url: 'https://remote.com/careers' },            // marketing site, not the ATS
    { careers_url: 'https://remote.com/jobs/acme-c1/x-j1' },  // Remote's third-party job board
    { careers_url: 'https://apply.remote.com.evil.example/jobs' },
    { careers_url: 'https://evilapply.remote.com/jobs' },
    { careers_url: 'https://remoteok.com/remote-jobs' },
    { careers_url: 'not a url' },
    { careers_url: '' },
    { careers_url: null },
    { careers_url: 42 },
    {},
    null,
    undefined,
  ];
  let detectBad = [];
  for (const e of refused) {
    try {
      if (provider.detect(e) !== null) detectBad.push(JSON.stringify(e));
    } catch (err) {
      detectBad.push(`${JSON.stringify(e)} threw ${err.message}`);
    }
  }
  if (detectBad.length === 0) pass('detect() returns null (no throw) for other hosts, http, malformed and missing URLs');
  else fail(`detect() misfired on: ${detectBad.join('; ')}`);

  // ── location formatting ──
  const cases = [
    ['EMEA', 'remote', 'Remote · EMEA (Europe, Middle East & Africa)'],
    ['EMEA, NORAM', 'remote', 'Remote · EMEA (Europe, Middle East & Africa) / NORAM (North America)'],
    ['LATAM', 'remote', 'Remote · LATAM (Latin America)'],
    ['APAC', 'remote', 'Remote · APAC (Asia-Pacific)'],
    ['emea,  emea ,NORAM', 'remote', 'Remote · EMEA (Europe, Middle East & Africa) / NORAM (North America)'],
    ['MENA', 'remote', 'Remote · MENA'],
    ['', 'remote', 'Remote'],
    ['EMEA', 'spaceship', 'EMEA (Europe, Middle East & Africa)'],
    [null, null, ''],
  ];
  const locBad = cases.filter(([loc, wp, want]) => formatRemoteLocation(loc, wp) !== want);
  if (locBad.length === 0) pass('formatRemoteLocation keeps each region code, spells known ones out, dedupes, passes unknown codes through');
  else fail(`formatRemoteLocation mismatches: ${locBad.map(([l, w, want]) => `${JSON.stringify([l, w])} → ${JSON.stringify(formatRemoteLocation(l, w))}, want ${JSON.stringify(want)}`).join('; ')}`);

  // The point of the provider: through the scanner's own filter, a Spain-based
  // candidate's config admits EMEA (alone or combined) and rejects regions that
  // exclude Europe. always_allow runs before block, so "EMEA, NORAM" survives
  // the NORAM block entry.
  const euFilter = buildLocationFilter({
    always_allow: ['EMEA', 'Europe', 'Spain'],
    allow: ['Remote'],
    block: ['NORAM', 'North America', 'LATAM', 'Latin America', 'APAC'],
  });
  const verdict = (code) => euFilter(formatRemoteLocation(code, 'remote'), 'https://apply.remote.com/jobs/x', 'Operations Lead');
  const expectations = [
    ['EMEA', true], ['EMEA, NORAM', true], ['EMEA, LATAM', true], ['APAC, EMEA, LATAM, NORAM', true],
    ['NORAM', false], ['LATAM', false], ['APAC', false], ['LATAM, NORAM', false],
  ];
  const filterBad = expectations.filter(([code, want]) => verdict(code) !== want);
  if (filterBad.length === 0) pass('scan.mjs location filter: EMEA / EMEA+NORAM pass, NORAM / LATAM / APAC-only blocked');
  else fail(`location filter verdicts wrong for: ${filterBad.map(([c, w]) => `${c} (want ${w})`).join(', ')}`);

  // A filter written in plain region names (no Remote codes) still works.
  const namesOnly = buildLocationFilter({ allow: ['Europe'], block: ['North America'] });
  if (namesOnly(formatRemoteLocation('EMEA', 'remote')) && !namesOnly(formatRemoteLocation('NORAM', 'remote'))) {
    pass('spelled-out region names match a filter that never mentions EMEA / NORAM');
  } else {
    fail('spelled-out region names did not reach a names-only filter');
  }

  // ── parseRemoteJobs ──
  const jobs = parseRemoteJobs({
    jobs: [
      row({ title: '  Operations Lead  ', location: 'EMEA, NORAM' }),
      row({ title: 'Closed Role', public_id: 'aaaaaaaa-0000-4000-8000-000000000002', accepting_applications: false }),
      row({ title: 'Closed Status', public_id: 'aaaaaaaa-0000-4000-8000-000000000005', status: 'closed', accepting_applications: true }),
      row({ title: '', public_id: 'aaaaaaaa-0000-4000-8000-000000000003' }),
      row({ title: 'No Id', public_id: undefined }),
      row({ title: 'Numeric Id', public_id: 7 }),
      null,
      'junk',
      row({ title: 'Bad Date', public_id: 'aaaaaaaa-0000-4000-8000-000000000004', opened_at: 'not a date' }),
    ],
  });
  const first = jobs[0];
  if (
    jobs.length === 2
    && first.title === 'Operations Lead'
    && first.url === 'https://apply.remote.com/jobs/aaaaaaaa-0000-4000-8000-000000000001'
    && first.company === 'Remote'
    && first.location === 'Remote · EMEA (Europe, Middle East & Africa) / NORAM (North America)'
    && first.externalId === 'aaaaaaaa-0000-4000-8000-000000000001'
    && first.postedAt === Date.parse('2026-10-30T09:52:09Z')
    && !('description' in first)
  ) {
    pass('parseRemoteJobs maps title/url/company/location/postedAt/externalId, leaves the opening-paragraph description out');
  } else {
    fail(`parseRemoteJobs first row = ${JSON.stringify(jobs)}`);
  }
  if (jobs.length === 2 && jobs[1].title === 'Bad Date' && !('postedAt' in jobs[1])) {
    pass('parseRemoteJobs drops closed (by either flag), title-less, id-less and non-object rows; an unparseable date is omitted, not NaN');
  } else {
    fail(`parseRemoteJobs filtering = ${JSON.stringify(jobs.map((j) => j.title))}`);
  }

  // Empty vs broken envelope.
  const empty = parseRemoteJobs({ jobs: [] });
  if (Array.isArray(empty) && empty.length === 0) pass('parseRemoteJobs({jobs: []}) → []');
  else fail(`parseRemoteJobs({jobs: []}) = ${JSON.stringify(empty)}`);

  const broken = [{}, { jobs: null }, { jobs: {} }, { results: [] }, '', 0, true, null];
  const notThrown = [];
  for (const b of broken) {
    try { parseRemoteJobs(b); notThrown.push(JSON.stringify(b)); } catch (e) {
      if (!/remote-com: unexpected API response/.test(e.message)) notThrown.push(`${JSON.stringify(b)} (${e.message})`);
    }
  }
  if (notThrown.length === 0) pass('parseRemoteJobs throws a descriptive error on a missing / wrong-typed jobs[] envelope');
  else fail(`parseRemoteJobs did not throw descriptively for: ${notThrown.join(', ')}`);

  // ── fetch() ──
  const seen = [];
  const ctx = {
    fetchJson: async (url, opts) => { seen.push({ url, opts }); return { jobs: [row({})] }; },
  };
  const fetched = await provider.fetch({ name: 'Acme', careers_url: 'https://apply.remote.com/jobs' }, ctx);
  if (
    seen.length === 1
    && seen[0].url === API_URL
    && seen[0].opts?.redirect === 'error'
    && fetched.length === 1
  ) {
    pass('fetch() makes one request to the fixed API URL with redirect: "error"');
  } else {
    fail(`fetch() calls = ${JSON.stringify(seen)}, jobs = ${fetched.length}`);
  }

  // The probe (ctx.maxPages: 1) is the same single request, and a rejection
  // propagates unwrapped so verify-portals can tell a budget cut-off apart.
  class Sentinel extends Error {}
  const sentinel = new Sentinel('budget');
  let caught;
  try {
    await provider.fetch({ name: 'Acme' }, { maxPages: 1, fetchJson: async () => { throw sentinel; } });
  } catch (e) { caught = e; }
  if (caught === sentinel) pass('fetch() propagates a ctx.fetchJson rejection unwrapped');
  else fail(`fetch() rejection was ${caught === undefined ? 'swallowed' : `rewrapped: ${caught?.message}`}`);
} catch (e) {
  fail(`remote-com provider tests crashed: ${e.message}`);
}
