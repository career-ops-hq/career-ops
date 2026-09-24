// tests/providers/provider-external-id.test.mjs — ATS-native identifiers must be captured
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
import { pass, fail } from '../helpers.mjs';

// helpers' fail() takes one message, so a second argument is silently dropped.
// Every check here names the case AND what it got; keep both in the output.
const failWith = (what, detail) => fail(`${what}: ${detail}`);
import { parseWorkdayResponse, workdayDedupKey } from '../../providers/workday.mjs';
import greenhouse from '../../providers/greenhouse.mjs';
import ashby from '../../providers/ashby.mjs';
import lever from '../../providers/lever.mjs';
import eightfold from '../../providers/eightfold.mjs';

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
  : failWith('workday anchored req token', `got ${wd[0]?.requisitionId} / ${wd[1]?.requisitionId}`);

wd[0].requisitionId !== wd[1].requisitionId
  ? pass('two same-location workday reqs get DIFFERENT ids (no location collision)')
  : failWith('workday location collision', `both got ${wd[0].requisitionId}`);

// requisitionId must be the stable req token, not the title-bearing path — the whole
// point is surviving a title drift (Associate -> Sr. Associate) on a stable req.
// externalId stays unset: the list API has no posting id, and the token is shared
// by every cross-posted copy of the req, so it is not a per-posting key.
const drift = parseWorkdayResponse(
  { jobPostings: [{ title: 'Sr. Associate, Corporate Strategy', externalPath: '/job/San-Francisco/Sr-Associate--Corporate-Strategy_R167982-1', bulletFields: [] }] },
  { name: 'Adobe', careers_url: 'https://adobe.wd5.myworkdayjobs.com/external_experienced' },
);
drift[0]?.requisitionId === 'R167982' && drift[0]?.externalId === undefined
  ? pass('workday requisitionId is the stable req token; externalId stays unset (no posting id in the list API)')
  : failWith('workday id stability', `got req=${drift[0]?.requisitionId} ext=${drift[0]?.externalId}`);

// Greenhouse: requisition_id + id captured off the real fetch path.
const ghFixture = { jobs: [{ id: 7724227003, requisition_id: 'JR103948', title: 'Strategic Finance Analyst II', absolute_url: 'https://job-boards.greenhouse.io/affirm/jobs/7724227003', location: { name: 'New York' }, first_published: '2026-07-01T00:00:00Z' }] };
const ghCtx = { transport: 'http', fetchText: async () => '', fetchJson: async (u) => (/offices/.test(u) ? { offices: [] } : ghFixture) };
const gh = await greenhouse.fetch({ name: 'Affirm', api: 'https://boards-api.greenhouse.io/v1/boards/affirm/jobs' }, ghCtx);
gh[0]?.requisitionId === 'JR103948' && gh[0]?.externalId === '7724227003'
  ? pass('greenhouse captures requisition_id + id from the payload')
  : failWith('greenhouse capture', `got req=${gh[0]?.requisitionId} ext=${gh[0]?.externalId}`);

// A tenant returning a non-string id must abstain, not coerce to "[object Object]".
const efCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ positions: [{ id: 790317599353, name: 'Associate, Content F&S', ats_job_id: {}, canonicalPositionUrl: 'https://explore.jobs.netflix.net/careers/job/790317599353', locations: ['Los Angeles'] }] }) };
const ef = await eightfold.fetch({ name: 'Netflix', careers_url: 'https://netflix.eightfold.ai/careers' }, efCtx).catch((e) => { failWith('provider fetch threw', e.message); return []; });
ef.length === 1 && ef[0].requisitionId === undefined
  ? pass('non-string ats_job_id abstains instead of coercing to "[object Object]"')
  : failWith('eightfold type guard', `got ${ef[0]?.requisitionId}`);

// Ashby and Lever expose only a posting uuid — no employer requisition field —
// so requisitionId must stay UNSET rather than be filled with the posting id.
// Conflating them would make a posting key masquerade as a req key, which is the
// many-to-one hazard documented on requisitionId in providers/_types.js.
const ashbyCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ jobs: [
  { id: '479e06f1-273d-4a1b-af56-6543761ebd75', title: 'Strategy & Ops', jobUrl: 'https://jobs.ashbyhq.com/acme/479e06f1', location: 'Remote' },
  { id: '   ', title: 'Blank Id', jobUrl: 'https://jobs.ashbyhq.com/acme/blank', location: 'Remote' },
] }) };
const ash = await ashby.fetch({ name: 'Acme', careers_url: 'https://jobs.ashbyhq.com/acme' }, ashbyCtx).catch((e) => { failWith('provider fetch threw', e.message); return []; });
ash[0]?.externalId === '479e06f1-273d-4a1b-af56-6543761ebd75' && ash[0]?.requisitionId === undefined
  ? pass('ashby captures the posting uuid as externalId and leaves requisitionId unset')
  : failWith('ashby capture', `ext=${ash[0]?.externalId} req=${ash[0]?.requisitionId}`);

ash.length === 2 && ash[1].externalId === undefined
  ? pass('ashby whitespace-only id keeps the row but stores no key')
  : failWith('ashby blank id', `rows=${ash.length} ext=${JSON.stringify(ash[1]?.externalId)}`);

const leverCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ([
  { id: 'a1b2c3d4-0000-4444-8888-99990000aaaa', text: 'Corporate Strategy', hostedUrl: 'https://jobs.lever.co/acme/a1b2c3d4', categories: { location: 'NYC' } },
]) };
const lev = await lever.fetch({ name: 'Acme', careers_url: 'https://jobs.lever.co/acme' }, leverCtx).catch((e) => { failWith('provider fetch threw', e.message); return []; });
lev[0]?.externalId === 'a1b2c3d4-0000-4444-8888-99990000aaaa' && lev[0]?.requisitionId === undefined
  ? pass('lever captures the posting id as externalId and leaves requisitionId unset')
  : failWith('lever capture', `ext=${lev[0]?.externalId} req=${lev[0]?.requisitionId}`);


// A tenant that exposes ONLY the upstream req id must not have it doubled into
// externalId: requisitionId is many-to-one with postings, so a consumer asking for
// per-posting identity would silently get a key two sibling postings share.
const reqOnlyCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ positions: [
  { ats_job_id: 'JR103863', name: 'Engineering Manager, ML Platform', canonicalPositionUrl: 'https://careers.example.com/job/1', locations: ['US'] },
] }) };
const reqOnly = await eightfold.fetch({ name: 'Example', careers_url: 'https://example.eightfold.ai/careers' }, reqOnlyCtx).catch((e) => { failWith('provider fetch threw', e.message); return []; });
reqOnly[0]?.requisitionId === 'JR103863' && reqOnly[0]?.externalId === undefined
  ? pass('eightfold req-only tenant sets requisitionId but leaves externalId unset')
  : failWith('eightfold req/posting separation', `ext=${reqOnly[0]?.externalId} req=${reqOnly[0]?.requisitionId}`);


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
  : failWith('workday title-word FP', `got ${titleUnderscore[0]?.requisitionId} / ${titleUnderscore[1]?.requisitionId}`);

titleUnderscore[2]?.requisitionId === '10154966'
  ? pass('workday still captures a real numeric req id')
  : failWith('workday real req regression', `got ${titleUnderscore[2]?.requisitionId}`);

// ── hyphenated requisition ids survive the token match (CodeRabbit, #4076) ────
// `_R-2593225` used to yield "R": the old regex treated everything after the
// hyphen as Workday's cross-site suffix, and the 3-char check then dropped BOTH
// ids. The table pins each shape, including the cross-site suffix that must
// still be stripped, and asserts the dedup key agrees with the captured id.
const REQ_TOKEN_CASES = [
  // externalPath                                        expected externalId   why
  ['/job/Bentonville/Sr-Analyst_R-2593225',              'R-2593225',          'Walmart: hyphen is part of the id'],
  ['/job/NY/Analyst_JR-10423',                           'JR-10423',           'two-letter prefix, hyphenated'],
  ['/job/SF/Sr-Associate--Corporate-Strategy_R167982-1', 'R167982',            'cross-site -1 stripped'],
  ['/job/SF/Sr-Associate_R167982-12',                    'R167982',            'cross-site -12 stripped'],
  ['/job/Burbank/Sr-Analyst_10154966',                   '10154966',           'bare numeric req'],
  ['/job/Remote/Data_Scientist',                         undefined,            'title word: no digit, abstain'],
  ['/job/NY/Sr_Manager_Ops',                             undefined,            'title word: no digit, abstain'],
  ['/job/NY/Analyst_R2',                                 undefined,            'under 3 chars, abstain'],
  ['/job/NY/Analyst_ABC-12',                             'ABC-12',             'prefix is not req-shaped: the -12 IS the id'],
  ['/job/Bentonville/Sr-Analyst_R-2593225-1',            'R-2593225-1',        'hyphenated id + cross-site suffix: kept whole (shape rule sees the hyphen)'],
  ['/job/NY/Analyst_JR_2024_00123',                      'JR_2024_00123',      'underscored id: the FIRST underscore is the boundary, as in workdayDedupKey'],
];
const reqRows = parseWorkdayResponse(
  { jobPostings: REQ_TOKEN_CASES.map(([externalPath], i) => ({ title: `Role ${i}`, externalPath, bulletFields: [] })) },
  { name: 'Walmart', careers_url: 'https://walmart.wd5.myworkdayjobs.com/walmartexternal' },
);
let reqTokenFailures = 0;
REQ_TOKEN_CASES.forEach(([externalPath, expected, why], i) => {
  const got = reqRows[i]?.requisitionId;
  if (got !== expected) {
    reqTokenFailures++;
    failWith('workday req token', `${externalPath} -> ${got}, expected ${expected} (${why})`);
  }
  if (reqRows[i]?.externalId !== undefined) {
    reqTokenFailures++;
    failWith('workday externalId', `${externalPath} -> ${reqRows[i]?.externalId}, expected unset (no posting id in the list API)`);
  }
});
reqTokenFailures === 0
  ? pass(`workday req tokens keep hyphens and strip only the cross-site suffix (${REQ_TOKEN_CASES.length} shapes)`)
  : failWith('workday req token table', `${reqTokenFailures} case(s) wrong`);

// The captured id and the dedup key must derive the requisition the SAME way —
// they used to disagree, which is how "R" reached the id while the dedup key
// still keyed on "r-2593225".
const walmartUrl = 'https://walmart.wd5.myworkdayjobs.com/walmartexternal/job/Bentonville/Sr-Analyst_R-2593225';
workdayDedupKey({ url: walmartUrl }) === `workday:walmart.wd5.myworkdayjobs.com:${String(reqRows[0]?.requisitionId).toLowerCase()}`
  ? pass('workday dedup key and captured requisitionId derive the same requisition')
  : failWith('workday dedup/id agreement', `key=${workdayDedupKey({ url: walmartUrl })} id=${reqRows[0]?.requisitionId}`);

// Underscored ids used to split the two derivations: the id took the text after
// the LAST underscore ("00123") while the key took it after the FIRST
// ("jr_2024_00123"). The key is lowercased; the captured id keeps the ATS casing.
const underscoredUrl = 'https://walmart.wd5.myworkdayjobs.com/walmartexternal/job/NY/Analyst_JR_2024_00123';
const underscoredRow = reqRows[REQ_TOKEN_CASES.findIndex(([p]) => p === '/job/NY/Analyst_JR_2024_00123')];
workdayDedupKey({ url: underscoredUrl }) === 'workday:walmart.wd5.myworkdayjobs.com:jr_2024_00123'
  && underscoredRow?.requisitionId === 'JR_2024_00123'
  ? pass('workday underscored req id: dedup key lowercases, captured id keeps its case, same requisition')
  : failWith('workday underscored id agreement', `key=${workdayDedupKey({ url: underscoredUrl })} id=${underscoredRow?.requisitionId}`);

// ── eightfold: a bad `id` must not mask a good `position_id` (CodeRabbit) ─────
const efFallbackCtx = { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ positions: [
  { id: {}, position_id: '123456', name: 'Strategy Manager', canonicalPositionUrl: 'https://acme.eightfold.ai/careers/job/123456', locations: ['NY'] },
  { id: '', position_id: '789012', name: 'BizOps Lead', canonicalPositionUrl: 'https://acme.eightfold.ai/careers/job/789012', locations: ['SF'] },
] }) };
const efFallback = await eightfold
  .fetch({ name: 'Acme', careers_url: 'https://acme.eightfold.ai/careers' }, efFallbackCtx)
  .catch((e) => { failWith('provider fetch threw', e.message); return []; });
efFallback[0]?.externalId === '123456' && efFallback[1]?.externalId === '789012'
  ? pass('eightfold falls back to position_id when id is present but unusable')
  : failWith('eightfold id fallback', `got ${efFallback[0]?.externalId} / ${efFallback[1]?.externalId}`);

// Agreement again, on the shape where the suffix IS stripped — the Walmart case
// above cannot see a dedup key that skips the shared helper, because nothing is
// stripped there.
const adobeUrl = 'https://adobe.wd5.myworkdayjobs.com/external_experienced/job/SF/Sr-Associate--Corporate-Strategy_R167982-1';
workdayDedupKey({ url: adobeUrl }) === 'workday:adobe.wd5.myworkdayjobs.com:r167982'
  ? pass('workday dedup key strips the cross-site suffix through the shared helper')
  : failWith('workday dedup cross-site', `got ${workdayDedupKey({ url: adobeUrl })}`);
