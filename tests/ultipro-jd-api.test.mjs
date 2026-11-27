// Offline UltiPro (UKG Pro Recruiting) JD coverage. No browser or real board:
// fetch is stubbed, and the detail pages are built the way UKG's own page
// embeds the posting record, or taken from the anonymized page fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeUltiproJob, fetchJdViaKnownApi, JD_FETCHERS } from '../browser-extract.mjs';
import { JD_TEXT_API_ATS } from '../liveness-api.mjs';
import { fetchJdText } from '../jd-years.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

const ID = '5e0c2b9a-7f41-4d2e-8b6a-1c9d3e7f2a10';
const DETAIL = `https://recruiting2.ultipro.com/EXA1000EXCO/JobBoard/0c8a6f9e-2b1d-4e57-9a3c-5d7f1e2b4c60/OpportunityDetail?opportunityId=${ID}`;

const record = (over = {}) => ({
  Id: ID,
  Title: 'Store Associate',
  FullTime: true,
  JobCategoryName: 'Store',
  Locations: [{ LocalizedName: 'Main Street', Address: { City: 'Springfield', State: { Name: 'Illinois', Code: 'IL' }, Country: { Name: 'United States', Code: 'USA' } } }],
  PostedDate: '2026-10-09T22:47:25.736Z',
  RequisitionNumber: 'STORE001234',
  Description: '<p>You&rsquo;ll help guests {in store} &amp; online.</p><ul><li>Stock shelves</li><li>Run the till</li></ul>',
  JobLocationType: 1,
  PayRangeVisible: false,
  PayRange: { PayRangeMinimum: null, PayRangeMaximum: null },
  PayRangeCurrencyCode: 'USD',
  CompensationAmount: null,
  PublishingStatus: 1,
  OpportunityIsClosed: false,
  EducationCriteria: [],
  WorkExperienceCriteria: [],
  LicenseAndCertificationCriteria: [],
  SkillCriteria: [],
  BehaviorCriteria: [],
  MotivationCriteria: [],
  ...over,
});
const page = (rec) => `<html><body><script>\r\n    $(function () {\r\n        var opportunity = new US.Opportunity.CandidateOpportunityDetail(${JSON.stringify(rec)});\r\n    });\r\n</script></body></html>`;

const HEADER = 'Location: Springfield, IL\nWork model: On-site\nJob type: Full time\nJob category: Store\nPosted: 2026-10-09\nReq ID: STORE001234';
const BODY = 'You’ll help guests {in store} & online.\n\n- Stock shelves\n- Run the till';

async function mocked(fetcher, run) {
  const previous = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await run(); } finally { globalThis.fetch = previous; }
}

test('an open posting reads as its description, under the header the page shows', () => {
  const jd = normalizeUltiproJob(page(record()), ID, DETAIL);
  assert.equal(jd.url, DETAIL);
  assert.equal(jd.title, 'Store Associate');
  assert.equal(jd.text, `${HEADER}\n\n${BODY}`);
});

test('a closed posting keeps its description and says it is closed', () => {
  const jd = normalizeUltiproJob(page(record({ OpportunityIsClosed: true, PublishingStatus: 4 })), ID, DETAIL);
  assert.equal(jd.text, `${HEADER}\nApplications closed (OpportunityIsClosed: true)\n\n${BODY}`);
});

test('part time reads as such, and fields the record leaves empty stay out of the header', () => {
  assert.match(normalizeUltiproJob(page(record({ FullTime: false })), ID, DETAIL).text, /\nJob type: Part time\n/);
  const bare = normalizeUltiproJob(page(record({ FullTime: null, Locations: [], JobLocationType: null, JobCategoryName: '', PostedDate: null, RequisitionNumber: ' ' })), ID, DETAIL);
  assert.equal(bare.text, BODY);
});

test('the work model reads as the board labels it, and an unknown value is left out', () => {
  const model = (JobLocationType) => normalizeUltiproJob(page(record({ JobLocationType })), ID, DETAIL).text.match(/\nWork model: (.+)\n/)?.[1] ?? null;
  assert.deepEqual([0, 1, 2, 3, null].map(model), ['Hybrid', 'On-site', 'Remote', null, null]);
});

test('pay reads only as the page shows it', () => {
  const text = (over) => normalizeUltiproJob(page(record(over)), ID, DETAIL).text;
  const range = { PayRangeMinimum: '22.71', PayRangeMaximum: '29.53' };
  assert.match(text({ PayRangeVisible: true, PayRange: range }), /\nJob category: Store\nPay range: 22\.71 to 29\.53 USD\nPosted: /);
  // The page hides a range it isn't asked to show, and says "Not specified" for one without both ends.
  assert.doesNotMatch(text({ PayRangeVisible: false, PayRange: range }), /Pay range/);
  assert.doesNotMatch(text({ PayRangeVisible: true, PayRange: { PayRangeMinimum: '22.71', PayRangeMaximum: null } }), /Pay range/);
  // A single amount is shown whenever the record has one.
  assert.match(text({ Salaried: true, CompensationAmount: { Code: 'USD', Value: '58682.00' } }), /\nJob category: Store\nSalary: 58682\.00 USD per year\nPosted: /);
  assert.match(text({ Salaried: false, CompensationAmount: { Code: 'USD', Value: '17.50' } }), /\nPay: 17\.50 USD\n/);
  assert.doesNotMatch(text({ CompensationAmount: { Code: 'USD', Value: null } }), /Salary|Pay:/);
});

test('travel reads when the record says either way', () => {
  const text = (over) => normalizeUltiproJob(page(record(over)), ID, DETAIL).text;
  assert.match(text({ TravelRequired: true, TravelDescription: 'Travel up to 20%' }), /\nTravel required: Yes \(Travel up to 20%\)\nPosted: /);
  assert.match(text({ TravelRequired: false, TravelDescription: null }), /\nTravel required: No\nPosted: /);
  assert.doesNotMatch(text({ TravelRequired: null, TravelDescription: 'Travel up to 20%' }), /Travel/);
});

test('the qualifications read between the header and the description, required before preferred', () => {
  const jd = normalizeUltiproJob(page(record({
    BehaviorCriteria: [
      { BehaviorName: 'Dedicated', BehaviorDescription: 'Devoted to a task or purpose with loyalty or integrity', Required: false, IsArchived: false },
      { BehaviorName: 'Team Player', BehaviorDescription: 'Works well as a member of a group', Required: true, IsArchived: false },
    ],
    MotivationCriteria: [{ MotivationName: 'Self-Starter', MotivationDescription: 'Inspired to perform without outside help', Required: false, IsArchived: false }],
    EducationCriteria: [
      { Required: true, Related: true, DegreeName: 'High School', MajorName: null },
      { Required: false, Related: true, DegreeName: 'Bachelor of Engineering', MajorName: 'Systems Engineering' },
    ],
    WorkExperienceCriteria: [
      { Required: true, MinimumRequiredYears: 8, MaximumRequiredYears: 10, Description: 'Relevant work experience.' },
      { Required: false, MinimumRequiredYears: null, MaximumRequiredYears: null, Description: ' Military, Security, Airline experience  \n      \n\n' },
      { Required: true, MinimumRequiredYears: 5, MaximumRequiredYears: null, Description: 'Program management' },
    ],
    LicenseAndCertificationCriteria: [{ Required: true, LicenseAndCertificationName: 'Drivers - Non CDL' }],
    SkillCriteria: [
      { Required: false, SkillName: 'Bookkeeping', SkillDescription: null, MinimumScaleValueCode: 'Expert', MinimumScaleValueDescription: 'Expert' },
      { Required: false, SkillName: 'Payroll', SkillDescription: 'Weekly runs', MinimumScaleValueCode: 'NONE', MinimumScaleValueDescription: 'None' },
    ],
  })), ID, DETAIL);
  assert.equal(jd.text, `${HEADER}\n\nQualifications:\n${[
    '- Skill (preferred): Bookkeeping: Expert',
    '- Skill (preferred): Payroll: Weekly runs',
    '- Behavior (required): Team Player: Works well as a member of a group',
    '- Behavior (preferred): Dedicated: Devoted to a task or purpose with loyalty or integrity',
    '- Motivation (preferred): Self-Starter: Inspired to perform without outside help',
    '- Education (required): High School or better',
    '- Education (preferred): Bachelor of Engineering or better in Systems Engineering or related field',
    '- Experience (required): 8-10 years: Relevant work experience.',
    '- Experience (required): 5 years: Program management',
    '- Experience (preferred): Military, Security, Airline experience',
    '- License or certification (required): Drivers - Non CDL',
  ].join('\n')}\n\n${BODY}`);
  // compactText cuts the tail, so a long description cannot push them out.
  const long = normalizeUltiproJob(page(record({
    LicenseAndCertificationCriteria: [{ Required: true, LicenseAndCertificationName: 'Drivers - Non CDL' }],
    Description: `<p>${'word '.repeat(5000)}</p>`,
  })), ID, DETAIL, 400);
  assert.ok(long.text.includes('\n\nQualifications:\n- License or certification (required): Drivers - Non CDL\n\nword word'));
});

test("the board's pages read, with braces and escaped quotes in the description intact", () => {
  const open = normalizeUltiproJob(fixture('ultipro-detail-open.html'), ID, DETAIL);
  assert.equal(open.text, 'Job type: Full time\nJob category: Store\nPosted: 2026-10-09\nReq ID: STORE001234\n\nHelp guests {in store} and online, and keep the "back room" tidy.');
  const closed = normalizeUltiproJob(fixture('ultipro-detail-closed.html'), ID, DETAIL);
  assert.match(closed.text, /\nApplications closed \(OpportunityIsClosed: true\)\n\nHelp guests \{in store\}/);
});

test("no JD from the empty page, the internal-only page, another posting's record or a broken one", () => {
  const broken = page(record()).replace('});', ');');
  for (const html of [
    fixture('ultipro-detail-unavailable.html'),
    fixture('ultipro-detail-internal.html'),
    page(record({ Id: '9d1e4c2b-3a5f-4e6d-8c7b-0a1f2e3d4c5b' })),
    broken,
    page(record({ Description: '<p> </p>' })),
    page(record({ Description: null })),
    '',
    null,
  ]) {
    assert.equal(normalizeUltiproJob(html, ID, DETAIL), null);
  }
});

test('the text cap applies', () => {
  const capped = normalizeUltiproJob(page(record({ Description: `<p>${'word '.repeat(5000)}</p>` })), ID, DETAIL, 400).text;
  assert.equal(capped.length, 401);
  assert.ok(capped.endsWith('…'));
});

test('fetchJdViaKnownApi makes one request for the posting page, asking for HTML and refusing redirects', async () => {
  assert.ok(JD_TEXT_API_ATS.has('ultipro'));
  assert.deepEqual(Object.keys(JD_FETCHERS).sort(), [...JD_TEXT_API_ATS].sort());
  const calls = [];
  // UKG reads the id in any case and answers with its lower-case id; the rung
  // requests the lower-case id and drops the other query parameters.
  const shared = `${DETAIL.replace(ID, ID.toUpperCase())}&source=LinkedIn`;
  const jd = await mocked(async (url, opts) => {
    calls.push({ url: String(url), accept: opts.headers.accept, redirect: opts.redirect });
    return new Response(page(record()));
  }, () => fetchJdViaKnownApi(shared));
  assert.deepEqual(calls, [{ url: DETAIL, accept: 'text/html', redirect: 'error' }]);
  assert.equal(jd.ats, 'ultipro');
  assert.equal(jd.url, shared);
  assert.equal(jd.title, 'Store Associate');
  assert.ok(jd.text.endsWith(BODY));
  const short = await mocked(async () => new Response(page(record())), () => fetchJdViaKnownApi(DETAIL, 60));
  assert.equal(short.text.length, 61);
});

test('a failed request is a miss, even when the error page carries a record', async () => {
  for (const reply of [
    async () => new Response(page(record()), { status: 503 }),
    async () => new Response('Not Found', { status: 404 }),
    async () => { throw new TypeError('fetch failed'); },
  ]) {
    assert.equal(await mocked(reply, () => fetchJdViaKnownApi(DETAIL)), null);
  }
});

test("the scan's experience filter reads the JD, and a posting without one falls back to the listing", async () => {
  const text = await mocked(async () => new Response(page(record({ Description: '<p>3+ years of retail experience.</p>' }))), () => fetchJdText(DETAIL));
  assert.ok(text.endsWith('3+ years of retail experience.'));
  // A throw is what makes applyExperienceFilter label the row from its listing.
  await assert.rejects(mocked(async () => new Response(fixture('ultipro-detail-unavailable.html')), () => fetchJdText(DETAIL)), /ultipro JD fetch returned nothing/);
});
