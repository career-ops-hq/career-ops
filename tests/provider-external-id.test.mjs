// tests/provider-external-id.test.mjs — ATS-native identifiers must be captured
// at ingest and serialized onto the pipeline row.
//
// WHY: dedup used to key only on the URL, so the same requisition posted under a
// second host read as a brand-new role (Adobe R167982, 2026-08-01). The fallback
// added for that — reconstructing an id from the URL string — is lossy in both
// directions: on a real Greenhouse posting the payload carried
// requisition_id "JR103948" while the URL regex recovered NOTHING, and a regex over
// slug text can mint ids that were never in the posting at all.
//
// The providers already receive the id and were discarding it. These checks pin the
// capture (providers/_types.js Job.requisitionId / .externalId) and its serialization
// so a future provider edit cannot silently drop it back to the lossy path.
//
// requisitionId is the schema.org/JobPosting `identifier` concept — "the hiring
// organization's unique identifier for the job" — which is what survives a repost
// or an ATS host move. externalId is the ATS's own posting key.
import { pass, fail } from './helpers.mjs';
import { parseWorkdayResponse } from '../providers/workday.mjs';
import greenhouse from '../providers/greenhouse.mjs';
import ashby from '../providers/ashby.mjs';
import lever from '../providers/lever.mjs';
import eightfold from '../providers/eightfold.mjs';

console.log('\nproviders — ATS-native identifier capture');

// ── PROVIDER-LEVEL: these must fail if the capture is deleted from the provider.
// An earlier version of this file only exercised scan.mjs's formatters with
// hand-built literals, so stripping externalId/requisitionId from all five
// providers left the whole suite green — the exact regression the local-patch
// README warns the updater will cause silently.

// Workday: the req token must be ANCHORED to the trailing path segment. An
// unanchored `externalPath.includes(bulletField)` check certified the LOCATION as
// the requisition id, because externalPath always embeds the location slug.
const wd = parseWorkdayResponse(
  { jobPostings: [
    { title: 'Sr Analyst, Corporate Strategy', externalPath: '/job/Burbank/Sr-Analyst--Corporate-Strategy_10154966', bulletFields: ['Burbank'] },
    { title: 'Sr Analyst, FP&A', externalPath: '/job/Burbank/Sr-Analyst--FP-A_10154999', bulletFields: ['Burbank'] },
  ] },
  { name: 'Disney', careers_url: 'https://disney.wd5.myworkdayjobs.com/disneycareer' },
);
wd[0]?.requisitionId === '10154966' && wd[1]?.requisitionId === '10154999'
  ? pass('workday req id comes from the anchored path token, not bulletFields')
  : fail('workday anchored req token', `got ${wd[0]?.requisitionId} / ${wd[1]?.requisitionId}`);

wd[0].requisitionId !== wd[1].requisitionId
  ? pass('two same-location workday reqs get DIFFERENT ids (no location collision)')
  : fail('workday location collision', `both got ${wd[0].requisitionId}`);

// externalId must be the stable req token, not the title-bearing path — the whole
// point is surviving a title drift (Associate -> Sr. Associate) on a stable req.
const drift = parseWorkdayResponse(
  { jobPostings: [{ title: 'Sr. Associate, Corporate Strategy', externalPath: '/job/San-Francisco/Sr-Associate--Corporate-Strategy_R167982-1', bulletFields: [] }] },
  { name: 'Adobe', careers_url: 'https://adobe.wd5.myworkdayjobs.com/external_experienced' },
);
drift[0]?.externalId === 'R167982'
  ? pass('workday externalId is the stable req token, not the title-bearing path')
  : fail('workday externalId stability', `got ${drift[0]?.externalId}`);

// Greenhouse: requisition_id + id captured off the real fetch path.
const ghFixture = { jobs: [{ id: 7724227003, requisition_id: 'JR103948', title: 'Strategic Finance Analyst II', absolute_url: 'https://job-boards.greenhouse.io/affirm/jobs/7724227003', location: { name: 'New York' }, first_published: '2026-07-01T00:00:00Z' }] };
const ghCtx = { transport: 'http', fetchText: async () => '', fetchJson: async (u) => (/offices/.test(u) ? { offices: [] } : ghFixture) };
const gh = await greenhouse.fetch({ name: 'Affirm', api: 'https://boards-api.greenhouse.io/v1/boards/affirm/jobs' }, ghCtx);
gh[0]?.requisitionId === 'JR103948' && gh[0]?.externalId === '7724227003'
  ? pass('greenhouse captures requisition_id + id from the payload')
  : fail('greenhouse capture', `got req=${gh[0]?.requisitionId} ext=${gh[0]?.externalId}`);

// A tenant returning a non-string id must abstain, not coerce to "[object Object]".
const efCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ positions: [{ id: 790317599353, name: 'Associate, Content F&S', ats_job_id: {}, canonicalPositionUrl: 'https://explore.jobs.netflix.net/careers/job/790317599353', locations: ['Los Angeles'] }] }) };
const ef = await eightfold.fetch({ name: 'Netflix', careers_url: 'https://netflix.eightfold.ai/careers' }, efCtx).catch((e) => { fail('provider fetch threw', e.message); return []; });
ef.length === 1 && ef[0].requisitionId === undefined
  ? pass('non-string ats_job_id abstains instead of coercing to "[object Object]"')
  : fail('eightfold type guard', `got ${ef[0]?.requisitionId}`);

// Ashby and Lever expose only a posting uuid — no employer requisition field —
// so requisitionId must stay UNSET rather than be filled with the posting id.
// Conflating them would make a posting key masquerade as a req key, which is the
// many-to-one hazard documented on requisitionId in providers/_types.js.
const ashbyCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ jobs: [
  { id: '479e06f1-273d-4a1b-af56-6543761ebd75', title: 'Strategy & Ops', jobUrl: 'https://jobs.ashbyhq.com/acme/479e06f1', location: 'Remote' },
  { id: '   ', title: 'Blank Id', jobUrl: 'https://jobs.ashbyhq.com/acme/blank', location: 'Remote' },
] }) };
const ash = await ashby.fetch({ name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' }, ashbyCtx).catch((e) => { fail('provider fetch threw', e.message); return []; });
ash[0]?.externalId === '479e06f1-273d-4a1b-af56-6543761ebd75' && ash[0]?.requisitionId === undefined
  ? pass('ashby captures the posting uuid as externalId and leaves requisitionId unset')
  : fail('ashby capture', `ext=${ash[0]?.externalId} req=${ash[0]?.requisitionId}`);

ash.length === 2 && ash[1].externalId === undefined
  ? pass('ashby whitespace-only id keeps the row but stores no key')
  : fail('ashby blank id', `rows=${ash.length} ext=${JSON.stringify(ash[1]?.externalId)}`);

const leverCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ([
  { id: 'a1b2c3d4-0000-4444-8888-99990000aaaa', text: 'Corporate Strategy', hostedUrl: 'https://jobs.lever.co/acme/a1b2c3d4', categories: { location: 'NYC' } },
]) };
const lev = await lever.fetch({ name: 'Acme', careers_url: 'https://jobs.lever.co/acme' }, leverCtx).catch((e) => { fail('provider fetch threw', e.message); return []; });
lev[0]?.externalId === 'a1b2c3d4-0000-4444-8888-99990000aaaa' && lev[0]?.requisitionId === undefined
  ? pass('lever captures the posting id as externalId and leaves requisitionId unset')
  : fail('lever capture', `ext=${lev[0]?.externalId} req=${lev[0]?.requisitionId}`);


// A tenant that exposes ONLY the upstream req id must not have it doubled into
// externalId: requisitionId is many-to-one with postings, so a consumer asking for
// per-posting identity would silently get a key two sibling postings share.
const reqOnlyCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ positions: [
  { ats_job_id: 'JR103863', name: 'Engineering Manager, ML Platform', canonicalPositionUrl: 'https://careers.example.com/job/1', locations: ['US'] },
] }) };
const reqOnly = await eightfold.fetch({ name: 'Example', careers_url: 'https://example.eightfold.ai/careers' }, reqOnlyCtx).catch((e) => { fail('provider fetch threw', e.message); return []; });
reqOnly[0]?.requisitionId === 'JR103863' && reqOnly[0]?.externalId === undefined
  ? pass('eightfold req-only tenant sets requisitionId but leaves externalId unset')
  : fail('eightfold req/posting separation', `ext=${reqOnly[0]?.externalId} req=${reqOnly[0]?.requisitionId}`);


// A Workday title may itself contain an underscore, so the trailing path segment is
// not necessarily a req id: "/job/Remote/Data_Scientist" ends in the word "Scientist".
// Without a shape check, two unrelated postings whose titles end in the same word
// share a requisition id — the location-slug collision one layer along.
const titleUnderscore = parseWorkdayResponse({ jobPostings: [
  { title: 'Data Scientist', externalPath: '/job/Remote/Data_Scientist', locationsText: 'Remote' },
  { title: 'Sr Manager Ops', externalPath: '/job/NY/Sr_Manager_Ops', locationsText: 'NY' },
  { title: 'Sr Analyst',     externalPath: '/job/Burbank/Sr-Analyst_10154966', locationsText: 'Burbank' },
] }, { name: 'Acme', workday: { host: 'acme.wd1.myworkdayjobs.com', tenant: 'acme', site: 'careers' } });

titleUnderscore[0]?.requisitionId === undefined && titleUnderscore[1]?.requisitionId === undefined
  ? pass('workday title words are not mistaken for req ids (shape check)')
  : fail('workday title-word FP', `got ${titleUnderscore[0]?.requisitionId} / ${titleUnderscore[1]?.requisitionId}`);

titleUnderscore[2]?.requisitionId === '10154966'
  ? pass('workday still captures a real numeric req id')
  : fail('workday real req regression', `got ${titleUnderscore[2]?.requisitionId}`);
