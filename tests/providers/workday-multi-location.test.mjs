// tests/providers/workday-multi-location.test.mjs — Workday's list endpoint
// answers a posting attached to several locations with a COUNT instead of a
// place ("53 Locations"), and the real places only exist in the per-posting
// detail document (#3860).
//
// The fixtures are trimmed from live responses captured 2026-09-07 against
// cvshealth|wd1|CVS_Health_Careers, crowdstrike|wd5|crowdstrikecareers and
// nvidia|wd5|NVIDIAExternalCareerSite. Placeholder shape, key names and the
// `1 + additionalLocations.length === announced count` relation are all as
// those tenants returned them; the location lists are truncated to what the
// assertions need.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { execFileSync } from 'child_process';

console.log('\nProvider — workday multi-location placeholders');

const workdayModule = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);
const workday = workdayModule.default;
const { isMultiLocationPlaceholder, locationsFromDetail, postedAtFromDetail } = workdayModule;

const ENTRY = { name: 'CrowdStrike', careers_url: 'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers' };
const JOB_BASE = 'https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers';
const CXS_BASE = 'https://crowdstrike.wd5.myworkdayjobs.com/wday/cxs/crowdstrike/crowdstrikecareers';

// One placeholder posting and one ordinary one, so every assertion below can
// tell "enriched the right posting" from "enriched every posting".
const PAGE0 = {
  total: 2,
  jobPostings: [
    {
      title: 'Engineer III, Cloud Native',
      externalPath: '/job/USA---Sunnyvale-CA/Engineer-III_R23456',
      locationsText: '3 Locations',
      postedOn: 'Posted Today',
    },
    {
      title: 'Technical Writer',
      externalPath: '/job/USA---Austin-TX/Technical-Writer_R23457',
      locationsText: 'USA - Austin, TX',
      postedOn: 'Posted Today',
    },
  ],
};
// `startDate` is the bare `YYYY-MM-DD` all 11 measured detail documents
// returned; it is what makes a resolved posting exactly datable (#3860).
const DETAIL = {
  jobPostingInfo: {
    id: 'R23456',
    location: 'USA - Sunnyvale, CA',
    additionalLocations: ['USA - Austin, TX', 'USA - Redmond, WA'],
    startDate: '2026-09-04',
  },
};
const DETAIL_STARTED_MS = Date.parse('2026-09-04');

const mkCtx = (fetchJson, extra = {}) => ({
  transport: 'http',
  fetchText: async () => { throw new Error('fetchText should not be called'); },
  fetchJson,
  sleep: async () => {},
  ...extra,
});

// --- the shape predicate -----------------------------------------------------
// Every one of these was observed live except the negatives, which are the
// boundary this regex has to hold: a real place may contain a digit and the
// word "Locations" without being a count.
for (const yes of ['3 Locations', '51 Locations', '2 locations', ' 4 Locations ', '1 Location']) {
  if (isMultiLocationPlaceholder(yes)) pass(`isMultiLocationPlaceholder(${JSON.stringify(yes)})`);
  else fail(`isMultiLocationPlaceholder(${JSON.stringify(yes)}) should be true`);
}
for (const no of ['USA - Austin, TX', '100 Locations Plaza', 'Locations', '3 Locations, TX', '', null, undefined, 51]) {
  if (!isMultiLocationPlaceholder(no)) pass(`isMultiLocationPlaceholder(${JSON.stringify(no)}) is false`);
  else fail(`isMultiLocationPlaceholder(${JSON.stringify(no)}) should be false`);
}

// --- reading the detail document --------------------------------------------
if (locationsFromDetail(DETAIL) === 'USA - Sunnyvale, CA · USA - Austin, TX · USA - Redmond, WA') {
  pass("locationsFromDetail() joins location + additionalLocations with ' · '");
} else {
  fail(`locationsFromDetail() returned ${JSON.stringify(locationsFromDetail(DETAIL))}`);
}

// The announced count is 1 + additionalLocations.length on every tenant measured;
// pinning it keeps a future "primary is also in additionalLocations" tenant from
// silently changing what the field means.
if (locationsFromDetail({ jobPostingInfo: { location: 'A', additionalLocations: ['A', 'B'] } }) === 'A · B') {
  pass('locationsFromDetail() dedupes a primary place repeated in additionalLocations');
} else {
  fail('locationsFromDetail() should dedupe a repeated primary place');
}

for (const [label, doc] of [
  ['no jobPostingInfo', {}],
  ['null', null],
  ['empty info', { jobPostingInfo: {} }],
  ['non-array additionalLocations', { jobPostingInfo: { additionalLocations: 'USA - Austin, TX' } }],
]) {
  const got = locationsFromDetail(doc);
  if (got === '') pass(`locationsFromDetail() returns '' for ${label}`);
  else fail(`locationsFromDetail(${label}) returned ${JSON.stringify(got)}`);
}
if (locationsFromDetail({ jobPostingInfo: { additionalLocations: ['USA - Austin, TX'] } }) === 'USA - Austin, TX') {
  pass('locationsFromDetail() works when only additionalLocations is present');
} else {
  fail('locationsFromDetail() should fall back to additionalLocations alone');
}

// --- fetch(): the behaviour the issue is about -------------------------------
{
  const seen = [];
  const jobs = await workday.fetch(ENTRY, mkCtx(async (url, opts) => {
    seen.push({ url, method: opts?.method || 'GET', opts });
    if (url.startsWith(CXS_BASE) && url.endsWith('/jobs')) return PAGE0;
    if (url === `${CXS_BASE}/job/USA---Sunnyvale-CA/Engineer-III_R23456`) return DETAIL;
    throw new Error(`unexpected url ${url}`);
  }));

  const placeholder = jobs.find((j) => j.url === `${JOB_BASE}/job/USA---Sunnyvale-CA/Engineer-III_R23456`);
  if (placeholder && placeholder.location === 'USA - Sunnyvale, CA · USA - Austin, TX · USA - Redmond, WA') {
    pass('workday.fetch() replaces a "3 Locations" placeholder with the real places');
  } else {
    fail(`workday.fetch() left the placeholder as ${JSON.stringify(placeholder?.location)}`);
  }

  const ordinary = jobs.find((j) => j.url === `${JOB_BASE}/job/USA---Austin-TX/Technical-Writer_R23457`);
  if (ordinary && ordinary.location === 'USA - Austin, TX') {
    pass('workday.fetch() leaves an ordinary single-location posting untouched');
  } else {
    fail(`workday.fetch() changed an ordinary location to ${JSON.stringify(ordinary?.location)}`);
  }

  const details = seen.filter((r) => !r.url.endsWith('/jobs'));
  if (details.length === 1) {
    pass('workday.fetch() spends exactly one detail request — only the placeholder posting');
  } else {
    fail(`workday.fetch() made ${details.length} detail requests: ${JSON.stringify(details)}`);
  }
  if (details[0] && details[0].method === 'GET') {
    pass('the detail request is a GET (the list endpoint is the POST one)');
  } else {
    fail(`detail request used method ${JSON.stringify(details[0]?.method)}`);
  }

  // Both of these are load-bearing and both are invisible in the returned jobs,
  // so without an assertion a refactor can drop either and this file stays
  // green. `redirect: 'error'` is what stops a detail URL from being walked off
  // the tenant origin; `accept-language` is what at least one tenant answers
  // HTTP 500 without (#3860, reproduced 0/5 without it, 5/5 with).
  const detailOpts = details[0]?.opts;
  if (detailOpts?.redirect === 'error') {
    pass("the detail request sets redirect: 'error' (no redirect off the tenant origin)");
  } else {
    fail(`detail request redirect was ${JSON.stringify(detailOpts?.redirect)}`);
  }
  if (detailOpts?.headers?.['accept-language']) {
    pass('the detail request sends accept-language (a tenant 500s without it)');
  } else {
    fail(`detail request headers were ${JSON.stringify(detailOpts?.headers)}`);
  }

  // The date half of #3860: a resolved posting is dated from the detail
  // document, not from the list endpoint's relative prose.
  if (placeholder && placeholder.postedAt === DETAIL_STARTED_MS) {
    pass('workday.fetch() dates a resolved posting from jobPostingInfo.startDate');
  } else {
    fail(`resolved posting postedAt was ${JSON.stringify(placeholder?.postedAt)}, expected ${DETAIL_STARTED_MS}`);
  }
  // The ordinary posting was never fetched in detail, so it must still carry
  // what parsePostedOn derived — proof the enrichment did not redate the board.
  if (ordinary && ordinary.postedAt !== DETAIL_STARTED_MS && typeof ordinary.postedAt === 'number') {
    pass('workday.fetch() leaves an unresolved posting on its parsePostedOn date');
  } else {
    fail(`ordinary posting postedAt was ${JSON.stringify(ordinary?.postedAt)}`);
  }
}

// --- postedAtFromDetail(): the date, strictly ---------------------------------
// Deliberately narrower than Date.parse: an unrecognized format must leave
// postedAt alone rather than produce an implementation-defined timestamp.
for (const [label, doc, want] of [
  ['a bare YYYY-MM-DD', { jobPostingInfo: { startDate: '2026-09-04' } }, Date.parse('2026-09-04')],
  ['an ISO date with time and Z', { jobPostingInfo: { startDate: '2026-09-04T08:30:00Z' } }, Date.parse('2026-09-04T08:30:00Z')],
  ['a padded value', { jobPostingInfo: { startDate: '  2026-09-04  ' } }, Date.parse('2026-09-04')],
  ['an impossible date', { jobPostingInfo: { startDate: '2026-02-30' } }, undefined],
  ['a day-31 rollover', { jobPostingInfo: { startDate: '2026-04-31' } }, undefined],
  ['month 13', { jobPostingInfo: { startDate: '2026-13-01' } }, undefined],
  // Kept, not discarded: its UTC day is the 5th, but the 4th is a real date and
  // the offset form is legitimate. This is the case a naive round-trip loses.
  ['an offset whose UTC day differs', { jobPostingInfo: { startDate: '2026-09-04T23:00:00-05:00' } }, Date.parse('2026-09-04T23:00:00-05:00')],
  ['a leap day that exists', { jobPostingInfo: { startDate: '2028-02-29' } }, Date.parse('2028-02-29')],
  ['a leap day that does not', { jobPostingInfo: { startDate: '2026-02-29' } }, undefined],
  // Rejected on purpose: Date.parse would read this in the scanning machine's
  // local zone, so the day it lands on depends on where the scan runs. See the
  // TZ assertion below, which is what actually pins this down.
  ['a time with no offset', { jobPostingInfo: { startDate: '2026-09-04T08:30:00' } }, undefined],
  ['a time with no offset and no seconds', { jobPostingInfo: { startDate: '2026-09-04T08:30' } }, undefined],
  // A real ISO year below 0100 — Date.UTC would map it onto 19xx.
  // Hard literal, cross-checked against Python's datetime rather than derived
  // from Date.parse — the value this file is asserting about.
  ['a year below 0100', { jobPostingInfo: { startDate: '0026-05-05' } }, -61335964800000],
  ['a US-style date', { jobPostingInfo: { startDate: '09/04/2026' } }, undefined],
  ['prose', { jobPostingInfo: { startDate: 'Posted Today' } }, undefined],
  ['an empty string', { jobPostingInfo: { startDate: '' } }, undefined],
  ['a non-string', { jobPostingInfo: { startDate: 1788652800000 } }, undefined],
  ['a missing startDate', { jobPostingInfo: { location: 'USA - Austin, TX' } }, undefined],
  ['a missing jobPostingInfo', {}, undefined],
  ['null', null, undefined],
]) {
  const got = postedAtFromDetail(doc);
  if (got === want) pass(`postedAtFromDetail() returns ${JSON.stringify(want)} for ${label}`);
  else fail(`postedAtFromDetail(${label}) returned ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
}

// The same detail document must date a posting identically no matter where the
// scan runs. Real child processes with TZ set, because Date.parse reads a
// zoneless date-time in the machine's local zone and an in-process TZ change is
// not reliably picked up once the engine has cached the zone.
{
  const script = `import { postedAtFromDetail } from '${pathToFileURL(join(ROOT, 'providers/workday.mjs')).href}';
process.stdout.write(JSON.stringify([
  postedAtFromDetail({ jobPostingInfo: { startDate: '2026-09-04' } }),
  postedAtFromDetail({ jobPostingInfo: { startDate: '2026-09-04T08:30:00Z' } }),
  postedAtFromDetail({ jobPostingInfo: { startDate: '2026-09-04T08:30:00' } }),
]));`;
  const zones = ['UTC', 'America/New_York', 'Asia/Tokyo'];
  const results = zones.map((tz) => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: tz }, encoding: 'utf8',
  }));
  if (new Set(results).size === 1) {
    pass(`postedAtFromDetail() returns the same timestamps in ${zones.join(', ')}`);
  } else {
    fail(`postedAtFromDetail() is timezone-dependent: ${zones.map((tz, i) => `${tz}=${results[i]}`).join(' ')}`);
  }
  // And specifically: the zoneless form is the one that would have moved, so it
  // must come back unparsed rather than "consistent by luck".
  if (JSON.parse(results[0])[2] === null) {
    pass('postedAtFromDetail() refuses a date-time that states no offset');
  } else {
    fail(`zoneless date-time parsed to ${JSON.parse(results[0])[2]}`);
  }
}

// A detail document can resolve the location and still carry no usable date.
// The location must be taken and the date left alone — an absent startDate is
// not a reason to erase the date parsePostedOn already derived.
{
  const jobs = await workday.fetch(ENTRY, mkCtx(async (url) => {
    if (url.endsWith('/jobs')) return PAGE0;
    return { jobPostingInfo: { location: 'USA - Sunnyvale, CA', additionalLocations: ['USA - Austin, TX'] } };
  }));
  const placeholder = jobs.find((j) => j.url.endsWith('Engineer-III_R23456'));
  if (placeholder && placeholder.location === 'USA - Sunnyvale, CA · USA - Austin, TX'
    && typeof placeholder.postedAt === 'number' && placeholder.postedAt !== DETAIL_STARTED_MS) {
    pass('workday.fetch() keeps the parsePostedOn date when the detail document has no startDate');
  } else {
    fail(`dateless detail left location ${JSON.stringify(placeholder?.location)} / postedAt ${JSON.stringify(placeholder?.postedAt)}`);
  }
}

// A tenant with no placeholder must cost nothing extra — this is the guard the
// maintainer asked for, and the reason the enrichment is not simply "fetch the
// detail of every posting".
{
  let detailRequests = 0;
  await workday.fetch(ENTRY, mkCtx(async (url) => {
    if (url.endsWith('/jobs')) return { total: 1, jobPostings: [PAGE0.jobPostings[1]] };
    detailRequests++;
    return DETAIL;
  }));
  if (detailRequests === 0) pass('workday.fetch() makes no detail request when no posting carries a placeholder');
  else fail(`workday.fetch() made ${detailRequests} unnecessary detail requests`);
}

// Fail-soft: a detail document that errors, or that carries no usable place,
// leaves the placeholder standing. Never an empty location — downstream reads
// '' as "location unknown", which passes filters the count would not, so a
// failed enrichment must not quietly widen the result set.
for (const [label, detailImpl] of [
  ['throws', async () => { throw new Error('403'); }],
  ['returns a document with no places', async () => ({ jobPostingInfo: {} })],
]) {
  const { result: jobs } = await captureConsoleErrors(
    () => workday.fetch(ENTRY, mkCtx(async (url) => (url.endsWith('/jobs') ? PAGE0 : detailImpl()))),
  );
  const placeholder = jobs.find((j) => j.url.endsWith('Engineer-III_R23456'));
  if (placeholder && placeholder.location === '3 Locations') {
    pass(`workday.fetch() keeps the placeholder when the detail request ${label}`);
  } else {
    fail(`workday.fetch() set location to ${JSON.stringify(placeholder?.location)} when the detail request ${label}`);
  }
}

// A malformed `externalPath` (no leading slash) makes `jobBase + externalPath`
// a URL with no site-relative path to recover, so no detail document can be
// addressed for it. It must not be counted against the request cap, and it must
// not be silently dropped from the tally either.
{
  let detailRequests = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (url) => {
    if (url.endsWith('/jobs')) {
      return { total: 1, jobPostings: [{ ...PAGE0.jobPostings[0], externalPath: 'job/USA---Sunnyvale-CA/Engineer-III_R23456' }] };
    }
    detailRequests++;
    return DETAIL;
  })));
  if (detailRequests === 0) pass('workday.fetch() makes no detail request for a posting with no site-relative path');
  else fail(`workday.fetch() made ${detailRequests} detail requests for an unroutable posting`);
  if (jobs[0] && jobs[0].location === '3 Locations') pass('an unroutable posting keeps its placeholder');
  else fail(`an unroutable posting ended up with ${JSON.stringify(jobs[0]?.location)}`);
  if (errors.some((e) => typeof e === 'string' && e.includes('1 with no site-relative path'))) {
    pass('an unroutable posting is reported as such, not as a cap or a read failure');
  } else {
    fail(`unroutable posting was not reported: ${JSON.stringify(errors)}`);
  }
}

// The per-entry request cap. nvidia ran 29 placeholders in 60 postings, so a
// large tenant reaches this; the cap must actually bind, and — because a silent
// cap reads as "all locations resolved" — it must say what it left behind.
{
  const many = Array.from({ length: 260 }, (_, i) => ({
    title: `Engineer ${i}`,
    externalPath: `/job/USA---Sunnyvale-CA/Engineer-${i}_R${i}`,
    locationsText: '3 Locations',
    postedOn: 'Posted Today',
  }));
  let detailRequests = 0;
  const { result: jobs, errors } = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (url, opts) => {
    if (url.endsWith('/jobs')) {
      const offset = JSON.parse(opts?.body || '{}').offset || 0;
      return { total: many.length, jobPostings: many.slice(offset, offset + 20) };
    }
    detailRequests++;
    return DETAIL;
  })));
  if (detailRequests === 200) pass('workday.fetch() stops at the 200-request detail cap');
  else fail(`workday.fetch() made ${detailRequests} detail requests, expected the cap to bind at 200`);
  const resolvedCount = jobs.filter((j) => j.location !== '3 Locations').length;
  if (resolvedCount === 200) pass('exactly the 200 resolved postings carry real places; the rest keep the placeholder');
  else fail(`${resolvedCount} postings were enriched, expected 200`);
  const capLine = errors.find((e) => typeof e === 'string' && e.includes('left unresolved by the 200-request cap'));
  if (capLine && capLine.includes('60 left unresolved')) {
    pass('the cap is reported out loud, with the number it left behind');
  } else {
    fail(`the cap was not reported: ${JSON.stringify(errors)}`);
  }
}

// A probe (verify-portals / discover-ats set ctx.maxPages) asks whether the
// board answers. Charging it one GET per multi-location posting would make a
// liveness check cost scale with the board.
{
  let detailRequests = 0;
  await workday.fetch(ENTRY, mkCtx(async (url) => {
    if (url.endsWith('/jobs')) return PAGE0;
    detailRequests++;
    return DETAIL;
  }, { maxPages: 1 }));
  if (detailRequests === 0) pass('workday.fetch() skips placeholder resolution for a ctx.maxPages probe');
  else fail(`a ctx.maxPages probe spent ${detailRequests} detail requests`);
}
