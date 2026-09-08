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
import { spawnSync } from 'child_process';
import { buildPostingAgeFilter, buildPostedDateFilter } from '../../scan.mjs';

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
  // spawnSync instead of execFileSync so a throwing child produces a fail()
  // line and lets the rest of the suite run, rather than aborting the whole
  // file with an uncaught exception.
  const zones = ['UTC', 'America/New_York', 'Asia/Tokyo'];
  const spawnResults = zones.map((tz) => spawnSync(
    process.execPath, ['--input-type=module', '-e', script],
    { env: { ...process.env, TZ: tz }, encoding: 'utf8', timeout: 30_000 },
  ));
  const tzFailed = spawnResults.findIndex((r) => r.status !== 0 || r.error);
  if (tzFailed !== -1) {
    const r = spawnResults[tzFailed];
    fail(`TZ child (${zones[tzFailed]}) failed: status=${r.status} error=${r.error?.message} stderr=${r.stderr}`);
  } else {
    const results = spawnResults.map((r) => r.stdout);
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

// The cap must bound REQUESTS, not postings. The block above only ever walks
// the happy path, where the two are the same number — so on its own it cannot
// see a retry. A tenant answering 503 retries RETRY_POLICY.retries times per
// posting, which turned the promised 200 GETs into 800 before this was fixed:
// the ceiling failed in exactly the situation it exists for, an unhealthy
// tenant. Measured against the transport, because that is what the tenant
// counts.
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
    const err = new Error('service unavailable');
    err.status = 503; // retryable — isRetryableError() in providers/_http.mjs
    throw err;
  })));
  if (detailRequests <= 200) pass(`retries count against the cap: ${detailRequests} detail requests, not 800`);
  else fail(`workday.fetch() made ${detailRequests} detail requests against a 200-request cap`);
  // The postings the budget could not reach must be reported as capped, and
  // the ones it reached and failed as unreadable — 260 pending, 50 reached at
  // 4 attempts each, so 210 are behind the cap and 50 are unreadable. If those
  // two were folded together the message would blame the wrong thing.
  const line = errors.find((e) => typeof e === 'string' && e.includes('multi-location placeholder'));
  if (line && line.includes('50 detail document(s) unreadable') && line.includes('210 left unresolved by the 200-request cap')) {
    pass('a retry-exhausted run separates "unreadable" from "never reached"');
  } else {
    fail(`wrong accounting on a failing tenant: ${JSON.stringify(line)}`);
  }
  if (jobs.every((j) => j.location === '3 Locations')) pass('every placeholder survives a tenant whose detail endpoint is down');
  else fail('a failed detail fetch changed a location');
}

// Counting alone is not enough: the LAST posting under the cap must not be
// allowed to start a full retry ladder and step over it. The block above cannot
// see this — 260 postings failing 4 times each land on 200 exactly, so nothing
// overshoots. Here the budget is walked to 199 by postings that succeed first
// try, and the 200th fails; unconstrained retries would spend 203.
{
  const many = Array.from({ length: 260 }, (_, i) => ({
    title: `Engineer ${i}`,
    externalPath: `/job/USA---Sunnyvale-CA/Engineer-${i}_R${i}`,
    locationsText: '3 Locations',
    postedOn: 'Posted Today',
  }));
  let detailRequests = 0;
  await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (url, opts) => {
    if (url.endsWith('/jobs')) {
      const offset = JSON.parse(opts?.body || '{}').offset || 0;
      return { total: many.length, jobPostings: many.slice(offset, offset + 20) };
    }
    detailRequests++;
    if (detailRequests <= 199) return DETAIL;
    const err = new Error('service unavailable');
    err.status = 503;
    throw err;
  })));
  if (detailRequests === 200) pass('the last posting under the cap retries only as far as the budget allows');
  else fail(`expected the cap to hold at exactly 200, got ${detailRequests}`);
}

// A retry that SUCCEEDS still costs the tenant two requests. It is the case no
// post-hoc count can see — `err.attempts` exists only on the error withRetry
// rethrows, so a first-try-503-then-200 reports nothing at all.
{
  let detailRequests = 0;
  let firstTry = true;
  const jobs = await workday.fetch(ENTRY, mkCtx(async (url) => {
    if (url.endsWith('/jobs')) return PAGE0;
    detailRequests++;
    if (firstTry) {
      firstTry = false;
      const err = new Error('rate limited');
      err.status = 429;
      throw err;
    }
    return DETAIL;
  }));
  if (detailRequests === 2) pass('a transient failure and its successful retry are both counted');
  else fail(`expected 2 detail requests across the retry, got ${detailRequests}`);
  const enriched = jobs.find((j) => j.title === 'Engineer III, Cloud Native');
  if (enriched.location === 'USA - Sunnyvale, CA · USA - Austin, TX · USA - Redmond, WA') {
    pass('the retried posting is still enriched');
  } else {
    fail(`retry did not enrich: ${enriched.location}`);
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

// ─── ITEM 2: inter-page delay is pinned ──────────────────────────────────────
//
// The line `if (attempted > 1) await sleep(INTER_PAGE_DELAY_MS, ctx)` spaces
// the detail GETs the same way the pagination loop spaces page requests — one
// delay per posting AFTER the first, i.e. `attempted - 1` calls in total.
// Without a counting sleep in the ctx the assertion would stay green even if
// that line were deleted, because the default `sleep: async () => {}` never
// records anything. The ctx `extra` argument carries the counting sleep so the
// assertion is driven by the real production code path.
//
// INTER_PAGE_DELAY_MS is 250 (workday.mjs). That value is not re-exported, but
// the test can infer it from the observed calls: every call must be exactly 250.
{
  const EXPECTED_DELAY_MS = 250; // matches INTER_PAGE_DELAY_MS in workday.mjs
  // Four placeholder postings: first costs zero sleeps, the next three each cost
  // one, for a total of three sleep calls — one fewer than the number attempted.
  const PAGE_WITH_PLACEHOLDERS = {
    total: 4,
    jobPostings: Array.from({ length: 4 }, (_, i) => ({
      title: `Engineer ${i}`,
      externalPath: `/job/USA---Sunnyvale-CA/Engineer-${i}_R2000${i}`,
      locationsText: '3 Locations',
      postedOn: 'Posted Today',
    })),
  };
  const sleepCalls = [];
  await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (url) => {
    if (url.endsWith('/jobs')) return PAGE_WITH_PLACEHOLDERS;
    return DETAIL;
  }, {
    sleep: async (ms) => { sleepCalls.push(ms); },
  })));
  // Four postings attempted → three inter-posting delays (one before each
  // posting after the first). Deleting the `if (attempted > 1) await sleep(...)`
  // production line causes `sleepCalls` to be empty, turning this red.
  if (sleepCalls.length === 3) {
    pass('workday.fetch() sleeps between detail requests: one fewer sleep than postings attempted');
  } else {
    fail(`expected 3 inter-detail sleeps for 4 placeholder postings, got ${sleepCalls.length}`);
  }
  if (sleepCalls.every((ms) => ms === EXPECTED_DELAY_MS)) {
    pass(`each inter-detail sleep is exactly INTER_PAGE_DELAY_MS (${EXPECTED_DELAY_MS}ms)`);
  } else {
    fail(`inter-detail sleep values were ${JSON.stringify(sleepCalls)}, expected all ${EXPECTED_DELAY_MS}`);
  }
}

// ─── ITEM 1: "Posted 30+ Days Ago" dating tradeoff is pinned ─────────────────
//
// Background: parsePostedOn returns `undefined` for "Posted 30+ Days Ago" (the
// label is unbounded, so no usable date can be derived from it). Without
// enrichment the posting carries no `postedAt` and passes any age-based filter
// in scan.mjs — the "don't penalize missing data" rule is a fallback for
// IGNORANCE, not a policy of inclusion. Once startDate is fetched from the
// detail document, the real date is available and filters apply correctly.
//
// The acknowledged asymmetry: a posting with `locationsText: "3 Locations"` and
// `postedOn: "Posted 30+ Days Ago"` gets its detail fetched (because of the
// placeholder) and ends up accurately dated. An otherwise-identical posting on
// the SAME board with a single location never gets its detail fetched, so it
// stays undated (postedAt: undefined) and passes every age filter. The
// inconsistency is one of KNOWLEDGE, not policy — we only know the 30+ posting's
// real date because we were already paying for a detail GET for the location.
//
// Flipping this behaviour (keeping postedAt undefined even when startDate is
// present) is a one-assertion change in workday.mjs's enrichment block; the
// comment there and the assertion below are the record of why the current
// semantics were chosen over that alternative.
{
  const OLD_DATE = '2026-05-01'; // well outside a 30-day window from 2026-09-08
  const OLD_DATE_MS = Date.parse(OLD_DATE);

  // A board with one "30+ Days Ago" placeholder and one ordinary single-location
  // posting that also has a stale postedOn. The ordinary posting is never fetched
  // in detail, so it stays undated (postedAt: undefined).
  const PAGE_WITH_OLD_PLACEHOLDER = {
    total: 2,
    jobPostings: [
      {
        title: 'Engineer III, Cloud Native',
        externalPath: '/job/USA---Sunnyvale-CA/Engineer-III_R23456',
        locationsText: '3 Locations',
        postedOn: 'Posted 30+ Days Ago', // parsePostedOn returns undefined for this
      },
      {
        title: 'Technical Writer',
        externalPath: '/job/USA---Austin-TX/Technical-Writer_R23457',
        locationsText: 'USA - Austin, TX',
        postedOn: 'Posted 30+ Days Ago', // single location — detail never fetched
      },
    ],
  };
  const OLD_DETAIL = {
    jobPostingInfo: {
      id: 'R23456',
      location: 'USA - Sunnyvale, CA',
      additionalLocations: ['USA - Austin, TX', 'USA - Redmond, WA'],
      startDate: OLD_DATE,
    },
  };

  // (b) Assert that before enrichment, a "30+ Days Ago" label yields undefined.
  // parsePostedOn is not exported (and the brief says not to export it just for
  // this), so we confirm the behaviour via the actual posting object produced by
  // a board where the detail document carries NO date — the posting stays undated.
  {
    const noDateDetail = { jobPostingInfo: { location: 'USA - Sunnyvale, CA', additionalLocations: [] } };
    const jobs = await workday.fetch(ENTRY, mkCtx(async (url) => {
      if (url.endsWith('/jobs')) return PAGE_WITH_OLD_PLACEHOLDER;
      return noDateDetail;
    }));
    const old = jobs.find((j) => j.url.endsWith('Engineer-III_R23456'));
    if (old && old.postedAt === undefined) {
      pass('a "Posted 30+ Days Ago" posting carries no postedAt before startDate enrichment (parsePostedOn returns undefined for the 30+ bucket)');
    } else {
      fail(`expected postedAt undefined for un-enriched 30+ posting, got ${JSON.stringify(old?.postedAt)}`);
    }
  }

  // (a+c) Drive through the real workday.fetch() with a detail document carrying
  // the old startDate. Assert postedAt comes out as Date.parse('2026-05-01').
  const jobs = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (url) => {
    if (url.endsWith('/jobs')) return PAGE_WITH_OLD_PLACEHOLDER;
    if (url.endsWith('Engineer-III_R23456')) return OLD_DETAIL;
    throw new Error(`unexpected url: ${url}`);
  }))).then(({ result }) => result);

  const oldPlaceholder = jobs.find((j) => j.url.endsWith('Engineer-III_R23456'));
  if (oldPlaceholder && oldPlaceholder.postedAt === OLD_DATE_MS) {
    pass(`workday.fetch() dates a "30+ Days Ago" placeholder from jobPostingInfo.startDate (${OLD_DATE} → ${OLD_DATE_MS})`);
  } else {
    fail(`"30+ Days Ago" posting postedAt was ${JSON.stringify(oldPlaceholder?.postedAt)}, expected ${OLD_DATE_MS}`);
  }

  const singleLoc = jobs.find((j) => j.url.endsWith('Technical-Writer_R23457'));
  if (singleLoc && singleLoc.postedAt === undefined) {
    pass('the single-location "30+ Days Ago" posting stays undated (detail never fetched — the knowledge asymmetry)');
  } else {
    fail(`single-location 30+ posting had unexpected postedAt: ${JSON.stringify(singleLoc?.postedAt)}`);
  }

  // (d) Pin the downstream consequence explicitly so the tradeoff is recorded
  // rather than implied. The real filters from scan.mjs are used here, not stubs.
  //
  // The "undated passes" rule is a fallback for ignorance: a posting with no
  // postedAt is not penalized because the scanner does not know its date. Once
  // the real date is in hand, the filter decision is accurate — and a posting
  // dated accurately to four months ago is legitimately outside a 30-day window.
  //
  // Accepted inconsistency: the single-location 30+ posting (above) stays
  // undated and therefore passes the same filter. That posting's real date may
  // also be outside the window, but we never fetched its detail, so the fallback
  // rule applies. The inconsistency is one of knowledge, not policy.
  {
    const NOW_MS = Date.now();
    const ageFilter30 = buildPostingAgeFilter(30, NOW_MS);
    // Accurately dated 30+ posting — OUTSIDE the 30-day window.
    if (!ageFilter30(OLD_DATE_MS)) {
      pass('an accurately dated 30+ posting is excluded from a 30-day window (deliberate: see comment — the "undated passes" rule is a fallback for ignorance, not a policy of inclusion)');
    } else {
      fail(`buildPostingAgeFilter(30) passed a posting from ${OLD_DATE}, which is outside a 30-day window`);
    }
    // Undated posting (undefined postedAt) — passes because missing data is not penalized.
    if (ageFilter30(undefined)) {
      pass('an undated posting passes a 30-day window filter (missing data is not penalized)');
    } else {
      fail('buildPostingAgeFilter(30) rejected an undated posting — that breaks the "undated passes" contract');
    }
    // Confirm via buildPostedDateFilter too, since scan.mjs can use either.
    const cutoffDate = new Date(NOW_MS - 30 * 86_400_000).toISOString().split('T')[0];
    const dateFilter = buildPostedDateFilter(cutoffDate, null);
    if (!dateFilter(OLD_DATE_MS)) {
      pass('buildPostedDateFilter also excludes the accurately dated 30+ posting from a 30-day window');
    } else {
      fail(`buildPostedDateFilter(${cutoffDate}) passed a posting from ${OLD_DATE}`);
    }
    if (dateFilter(undefined)) {
      pass('buildPostedDateFilter passes an undated posting (missing data is not penalized)');
    } else {
      fail('buildPostedDateFilter rejected an undated posting — that breaks the "undated passes" contract');
    }
  }
}

// ─── ITEM 3: enrichment runs on the FINAL job list, after the split/dedup ────
//
// The comment at workday.mjs:827 claims enrichment runs after the facet split
// has deduped its overlapping slices, so the same posting is only enriched once
// regardless of how many slices it appeared in. This test pins that claim: a
// board that clamps and splits into two facet slices where the same placeholder
// posting appears in both slices must cause the detail endpoint to be called
// exactly once for that posting.
//
// If enrichment were moved before the split/dedup (i.e., `placeholders` built
// from `root.jobs` instead of the final `jobs`), the duplicate posting would not
// be in root.jobs (it only appears in the slices), so the detail endpoint would
// be called zero times — and the assertion below would go red.
//
// Fixture design: the root query reports total=20 (one page, terminates quickly)
// with facets that sum to 3002 (> WORKDAY_OFFSET_CEILING=2000), triggering the
// clamp. Two facet slices are produced: sliceA has the duplicate placeholder
// and one ordinary posting; sliceB also has the duplicate placeholder. Root's
// jobPostings contain only the ordinary posting (no placeholder), so the
// duplicate is absent from root.jobs.
{
  const DUPE_PATH = '/job/USA---Sunnyvale-CA/Engineer-Dupe_R99999';
  // The job's public URL (jobBase + externalPath) is what appears in the returned
  // job objects. The detail GET is issued against the CXS host instead, so the
  // transport URL differs from the job URL — the count lookup below uses the CXS
  // detail URL, and the job lookup uses the public URL.
  const DUPE_JOB_URL = `${JOB_BASE}${DUPE_PATH}`;
  const DUPE_DETAIL_URL = `${CXS_BASE}${DUPE_PATH}`;

  // A facet with two values whose counts sum to 3002 > 2000. Both values need
  // an `id` (string) and a `count` (integer) for chooseSplitFacet to pick them.
  const CLAMPED_FACETS = [{
    facetParameter: 'jobFamily',
    descriptor: 'Job Family',
    values: [
      { id: 'f1', descriptor: 'Engineering', count: 1501 },
      { id: 'f2', descriptor: 'Operations', count: 1501 },
    ],
  }];

  const ROOT_PAGE = {
    total: 20, // one page, clamped (total<=2000 and facets sum=3002>2000)
    facets: CLAMPED_FACETS,
    jobPostings: [{
      title: 'Ordinary Posting',
      externalPath: '/job/USA---Austin-TX/Ordinary_R88888',
      locationsText: 'USA - Austin, TX',
      postedOn: 'Posted Today',
    }],
  };

  const SLICE_A_PAGE = {
    total: 20,
    facets: [], // no further split
    jobPostings: [
      {
        title: 'Engineer Dupe',
        externalPath: DUPE_PATH,
        locationsText: '3 Locations',
        postedOn: 'Posted Today',
      },
      {
        title: 'Other A',
        externalPath: '/job/USA---Seattle-WA/Other-A_R77777',
        locationsText: 'USA - Seattle, WA',
        postedOn: 'Posted Today',
      },
    ],
  };

  const SLICE_B_PAGE = {
    total: 20,
    facets: [],
    jobPostings: [
      {
        title: 'Engineer Dupe', // same posting as in slice A
        externalPath: DUPE_PATH,
        locationsText: '3 Locations',
        postedOn: 'Posted Today',
      },
    ],
  };

  const DUPE_DETAIL = {
    jobPostingInfo: {
      id: 'R99999',
      location: 'USA - Sunnyvale, CA',
      additionalLocations: ['USA - Austin, TX', 'USA - Seattle, WA'],
      startDate: '2026-09-05',
    },
  };

  // Count detail GETs per URL in the mock transport.
  const detailGetsByUrl = {};
  const { result: splitJobs } = await captureConsoleErrors(() => workday.fetch(
    ENTRY,
    mkCtx(async (url, opts) => {
      if (url.endsWith('/jobs')) {
        // Distinguish root query from slice queries by the request body.
        const body = JSON.parse(opts?.body || '{}');
        const appliedFacets = body.appliedFacets || {};
        if (Object.keys(appliedFacets).length === 0) return ROOT_PAGE;
        if (appliedFacets.jobFamily?.[0] === 'f1') return SLICE_A_PAGE;
        if (appliedFacets.jobFamily?.[0] === 'f2') return SLICE_B_PAGE;
        throw new Error(`unexpected facets: ${JSON.stringify(appliedFacets)}`);
      }
      // Detail GET — count by URL.
      detailGetsByUrl[url] = (detailGetsByUrl[url] || 0) + 1;
      return DUPE_DETAIL;
    }),
  ));

  const dupeDetailCount = detailGetsByUrl[DUPE_DETAIL_URL] || 0;
  // The duplicate placeholder appeared in both sliceA and sliceB, but the
  // final deduplicated job list contains it only once. Enrichment runs on that
  // deduplicated list, so the detail endpoint is called exactly once.
  // If enrichment ran on root.jobs instead (the "moved before split/dedup"
  // mutation), root.jobs does not contain this posting and the count would be
  // zero — this assertion would go red.
  if (dupeDetailCount === 1) {
    pass('workday.fetch() calls the detail endpoint exactly once for a posting that appeared in multiple facet slices (enrichment runs after split/dedup)');
  } else {
    fail(`expected 1 detail GET for the duplicate placeholder, got ${dupeDetailCount} (detailGetsByUrl: ${JSON.stringify(detailGetsByUrl)})`);
  }

  const dupeJob = splitJobs.find((j) => j.url === DUPE_JOB_URL);
  if (dupeJob && dupeJob.location === 'USA - Sunnyvale, CA · USA - Austin, TX · USA - Seattle, WA') {
    pass('the deduplicated placeholder is enriched with the real places from its one detail fetch');
  } else {
    fail(`deduplicated placeholder location was ${JSON.stringify(dupeJob?.location)}`);
  }
}
