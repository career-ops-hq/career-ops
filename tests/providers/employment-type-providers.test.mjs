// tests/providers/employment-type-providers.test.mjs — every provider that
// reads an employment type from its source sets `Job.employmentType` to the
// normalized value, and leaves the key off when the source gives none or gives
// one _employment-type.mjs does not know.
//
// The fixtures copy the shape of each source's live payload (fetched
// 2026-11-10), with fictional companies and URLs: the field names, value
// spellings and neighbouring keys are the real ones, so a parser that reads the
// wrong key or drops the field fails here.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProviders — employmentType');

const load = (file) => import(pathToFileURL(join(ROOT, 'providers', file)).href);
const types = (jobs) => jobs.map((j) => ('employmentType' in j ? j.employmentType : '<absent>'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const expect = (label, got, want) => {
  if (same(got, want)) pass(label);
  else fail(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};

// ── Himalayas (/jobs/api) ───────────────────────────────────────────
{
  const { parseHimalayasResponse } = await load('himalayas.mjs');
  const item = (slug, employmentType) => ({
    title: `Role ${slug}`,
    excerpt: 'Fixture excerpt.',
    companyName: 'Fixture Labs',
    companySlug: 'fixture-labs',
    ...(employmentType === undefined ? {} : { employmentType }),
    minSalary: null,
    maxSalary: null,
    salaryPeriod: 'annual',
    seniority: ['Mid-level'],
    currency: null,
    locationRestrictions: ['Austria'],
    timezoneRestrictions: [1],
    categories: ['Community-Manager'],
    parentCategories: ['Marketing'],
    pubDate: 1794316578,
    expiryDate: 1799500578,
    applicationLink: `https://himalayas.app/companies/fixture-labs/jobs/${slug}?utm_source=api`,
    guid: `https://himalayas.app/companies/fixture-labs/jobs/${slug}`,
  });
  const jobs = parseHimalayasResponse({
    totalCount: 6,
    jobs: [
      item('a', 'Full Time'),
      item('b', 'Part Time'),
      item('c', 'Contractor'),
      item('d', 'Temporary'),
      item('e', 'Volunteer'),
      item('f'),
    ],
  });
  expect('himalayas: employmentType normalized; Volunteer and a missing field leave it off',
    types(jobs), ['full_time', 'part_time', 'contract', 'temporary', '<absent>', '<absent>']);
}

// ── We Work Remotely (RSS <type>) ───────────────────────────────────
{
  const { parseWwrFeed } = await load('weworkremotely.mjs');
  const item = (slug, type) => [
    '<item>',
    '<media:content url="https://wwr-pro.s3.amazonaws.com/logos/0000/0000/logo.gif" type="image/png"/>',
    `<title>Fixture Labs: Role ${slug}</title>`,
    '<region>Anywhere in the World</region>',
    '<country></country>',
    '<state></state>',
    '<skills>SQL, API</skills>',
    '<category>Product</category>',
    type === undefined ? '' : `<type>${type}</type>`,
    '<description>&lt;p&gt;Fixture body.&lt;/p&gt;</description>',
    '<pubDate>Mon, 09 Nov 2026 09:06:54 +0000</pubDate>',
    '<expires_at>Wed, 09 Dec 2026 09:06:46 +0000</expires_at>',
    `<guid>https://weworkremotely.com/remote-jobs/fixture-labs-${slug}</guid>`,
    `<link>https://weworkremotely.com/remote-jobs/fixture-labs-${slug}</link>`,
    '</item>',
  ].join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>${[
    item('a', 'Full-Time'),
    item('b', 'Contract'),
    item('c', '<![CDATA[Part-Time]]>'),
    item('d'),
  ].join('')}</channel></rss>`;
  const jobs = parseWwrFeed(xml);
  expect('weworkremotely: <type> normalized (CDATA too); no <type> leaves it off',
    types(jobs), ['full_time', 'contract', 'part_time', '<absent>']);
}

// ── Remotive (job_type) ─────────────────────────────────────────────
{
  const remotive = (await load('remotive.mjs')).default;
  const job = (id, jobType) => ({
    id,
    url: `https://remotive.com/remote-jobs/software-dev/role-${id}`,
    title: `Role ${id}`,
    company_name: 'Fixture Labs',
    company_logo: '',
    category: 'Software Development',
    tags: ['python'],
    ...(jobType === undefined ? {} : { job_type: jobType }),
    publication_date: '2026-11-09T12:56:13',
    candidate_required_location: 'Worldwide',
    salary: '',
    description: '<p>Fixture body.</p>',
  });
  const jobs = await remotive.fetch({ provider: 'remotive' }, {
    fetchJson: async () => ({
      'job-count': 6,
      jobs: [job(1, 'full_time'), job(2, 'part_time'), job(3, 'contract'), job(4, 'freelance'), job(5, 'other'), job(6)],
    }),
  });
  expect('remotive: job_type normalized, freelance as contract; other and missing leave it off',
    types(jobs), ['full_time', 'part_time', 'contract', 'contract', '<absent>', '<absent>']);
}

// ── Ashby (posting API and embed source) ────────────────────────────
{
  const ashby = (await load('ashby.mjs')).default;
  const posting = (id, employmentType) => ({
    id: `00000000-0000-4000-8000-00000000000${id}`,
    title: `Role ${id}`,
    location: 'Remote',
    secondaryLocations: [],
    department: 'Engineering',
    team: 'Platform',
    isListed: true,
    isRemote: true,
    workplaceType: 'Remote',
    descriptionPlain: 'Fixture body.',
    publishedAt: '2026-11-01T10:00:00.000+00:00',
    ...(employmentType === undefined ? {} : { employmentType }),
    jobUrl: `https://jobs.ashbyhq.com/fixture/00000000-0000-4000-8000-00000000000${id}`,
    applyUrl: `https://jobs.ashbyhq.com/fixture/00000000-0000-4000-8000-00000000000${id}/application`,
  });
  const body = { apiVersion: '1', jobs: [posting(1, 'FullTime'), posting(2, 'PartTime'), posting(3, 'Contract'), posting(4, 'Intern'), posting(5, 'Temporary'), posting(6)] };
  const ctx = { transport: 'http', sleep: async () => {}, fetchJson: async () => body, fetchText: async () => JSON.stringify(body) };
  const jobs = await ashby.fetch({ name: 'Fixture', careers_url: 'https://jobs.ashbyhq.com/fixture' }, ctx);
  expect('ashby posting API: employmentType normalized; missing leaves it off',
    types(jobs), ['full_time', 'part_time', 'contract', 'internship', 'temporary', '<absent>']);

  const appData = {
    organization: { name: 'Fixture' },
    jobBoard: {
      jobPostings: [
        { id: 'a1', title: 'Embed A', locationName: 'Remote', workplaceType: 'Remote', employmentType: 'Contract', secondaryLocations: [], compensationTierSummary: null },
        { id: 'a2', title: 'Embed B', locationName: 'Remote', workplaceType: 'Remote', secondaryLocations: [], compensationTierSummary: null },
      ],
    },
  };
  const html = `<!doctype html><script>window.__appData = ${JSON.stringify(appData)};\n</script>`;
  const embedJobs = await ashby.fetch(
    { name: 'Fixture', careers_url: 'https://jobs.ashbyhq.com/fixture', ashby: { embed: true } },
    { transport: 'http', sleep: async () => {}, fetchText: async () => html, fetchJson: async () => { throw new Error('embed must not call fetchJson'); } },
  );
  expect('ashby embed source: same employmentType as the API path',
    types(embedJobs), ['contract', '<absent>']);
}

// ── Lever (categories.commitment) ───────────────────────────────────
{
  const lever = (await load('lever.mjs')).default;
  const posting = (id, commitment) => ({
    id: `1111-${id}`,
    text: `Role ${id}`,
    hostedUrl: `https://jobs.lever.co/fixture/1111-${id}`,
    applyUrl: `https://jobs.lever.co/fixture/1111-${id}/apply`,
    createdAt: 1793000000000,
    categories: {
      ...(commitment === undefined ? {} : { commitment }),
      department: 'Engineering',
      location: 'Remote',
      team: 'Platform',
      allLocations: ['Remote'],
    },
    workplaceType: 'remote',
    descriptionPlain: 'Fixture body.',
    lists: [],
  });
  const jobs = await lever.fetch(
    { name: 'Fixture', careers_url: 'https://jobs.lever.co/fixture' },
    { fetchJson: async () => [
      posting(1, 'Full-time'),
      posting(2, 'Internship'),
      posting(3, 'Fixed-Term'),
      posting(4, 'Contractor'),
      posting(5, 'Permanent'),
      posting(6),
    ] },
  );
  expect('lever: categories.commitment normalized; Permanent and missing leave it off',
    types(jobs), ['full_time', 'internship', 'temporary', 'contract', '<absent>', '<absent>']);
}

// ── Workable (widget API) ───────────────────────────────────────────
{
  const { parseWorkableWidget } = await load('workable.mjs');
  const row = (shortcode, employment_type, experience) => ({
    title: `Role ${shortcode}`,
    shortcode,
    shortlink: `https://apply.workable.com/j/${shortcode}`,
    url: `https://apply.workable.com/fixture-labs/j/${shortcode}/`,
    country: 'Spain',
    city: 'Madrid',
    telecommuting: false,
    department: 'Engineering',
    ...(employment_type === undefined ? {} : { employment_type }),
    ...(experience === undefined ? {} : { experience }),
    published_on: '2026-11-10',
  });
  const jobs = parseWorkableWidget(
    { name: 'Fixture Labs', jobs: [row('AAA111', 'Full-time'), row('BBB222', 'Contract'), row('CCC333')] },
    'Fixture Labs',
    'fixture-labs',
  );
  expect('workable: employment_type normalized; a missing field leaves it off',
    types(jobs), ['full_time', 'contract', '<absent>']);
  // Workable states an internship in `experience`, on a "Full-time" row.
  const levels = parseWorkableWidget(
    { name: 'Fixture Labs', jobs: [row('DDD444', 'Full-time', 'Internship'), row('EEE555', 'Full-time', 'Mid-Senior level')] },
    'Fixture Labs',
    'fixture-labs',
  );
  expect('workable: an Internship experience level makes the row an internship; another level leaves employment_type in charge',
    types(levels), ['internship', 'full_time']);
}

// ── SmartRecruiters (/v1/companies/<slug>/postings) ─────────────────
{
  const { parseSmartRecruitersResponse } = await load('smartrecruiters.mjs');
  const item = (id, type, level) => ({
    id,
    name: `Role ${id}`,
    ...(level ? { experienceLevel: { id: level, label: level } } : {}),
    ref: `https://api.smartrecruiters.com/v1/companies/fixturelabs/postings/${id}`,
    releasedDate: '2026-11-10T09:00:00.000Z',
    location: { city: 'Madrid', country: 'es', remote: false, fullLocation: 'Madrid, Spain' },
    ...(type === undefined ? {} : { typeOfEmployment: type }),
  });
  const jobs = parseSmartRecruitersResponse(
    // the live pairs: the id names the term ("permanent"), only the label names the type
    {
      content: [
        item('744000000000001', { id: 'permanent', label: 'Full-time' }),
        item('744000000000002', { id: 'intern', label: 'Intern' }),
        item('744000000000003'),
        // the live BoschGroup shape: an internship labelled Full-time
        item('744000000000004', { id: 'permanent', label: 'Full-time' }, 'internship'),
        item('744000000000005', { id: 'permanent', label: 'Full-time' }, 'mid_senior_level'),
      ],
    },
    'Fixture Labs',
    'fixturelabs',
  );
  expect('smartrecruiters: typeOfEmployment.label normalized; an internship experienceLevel decides; a missing field leaves it off',
    types(jobs), ['full_time', 'internship', '<absent>', 'internship', 'full_time']);
}

// ── Recruitee (/api/offers) ─────────────────────────────────────────
{
  const { parseRecruiteeResponse } = await load('recruitee.mjs');
  const offer = (id, employment_type_code) => ({
    id,
    title: `Role ${id}`,
    careers_url: `https://fixturelabs.recruitee.com/o/role-${id}`,
    location: 'Madrid, Spain',
    published_at: '2026-11-10 09:00:00 UTC',
    ...(employment_type_code === undefined ? {} : { employment_type_code }),
  });
  const jobs = parseRecruiteeResponse(
    { offers: [offer(1, 'fulltime_permanent'), offer(2, 'parttime_fixed_term'), offer(3)] },
    'Fixture Labs',
  );
  expect('recruitee: employment_type_code normalized (a fixed term is temporary); a missing field leaves it off',
    types(jobs), ['full_time', 'temporary', '<absent>']);
}

// ── Personio (/xml) ─────────────────────────────────────────────────
{
  const { parsePersonioXml } = await load('personio.mjs');
  const position = (id, employmentType, schedule) =>
    `<position><id>${id}</id><office>Madrid</office><name>Role ${id}</name>` +
    (employmentType ? `<employmentType>${employmentType}</employmentType>` : '') +
    (schedule ? `<schedule>${schedule}</schedule>` : '') +
    `<createdAt>2026-11-10T09:00:00+00:00</createdAt></position>`;
  const jobs = parsePersonioXml(
    `<workzag-jobs>${position(1, 'permanent', 'full-time')}${position(2, 'intern', 'full-time')}${position(3)}`
      + `${position(4, 'permanent', 'full-or-part-time')}${position(5, 'intern', 'full-or-part-time')}`
      + `${position(6, 'trainee', 'full-time')}${position(7, 'working_student', 'part-time')}</workzag-jobs>`,
    'Fixture Labs',
    'fixturelabs.jobs.personio.de',
  );
  expect('personio: <employmentType> and <schedule> normalized ("permanent" says nothing, the schedule does; "full-or-part-time" and "trainee" give no type)',
    types(jobs), ['full_time', 'internship', '<absent>', '<absent>', 'internship', '<absent>', 'part_time']);
}

// ── Welcome to the Jungle (Algolia hit) ─────────────────────────────
{
  const { normalizeWttjHit } = await load('wttj.mjs');
  const hit = (slug, contract_type) => ({
    name: `Role ${slug}`,
    slug,
    organization: { name: 'Fixture Labs', slug: 'fixture-labs' },
    offices: [{ city: 'Paris', country: 'France' }],
    published_at_timestamp: 1794316578,
    ...(contract_type === undefined ? {} : { contract_type }),
  });
  expect('wttj: contract_type normalized; an unknown one (apprenticeship) or a missing field leaves it off',
    types([hit('a', 'full_time'), hit('b', 'internship'), hit('c', 'apprenticeship'), hit('d')].map(normalizeWttjHit)),
    ['full_time', 'internship', '<absent>', '<absent>']);
}
