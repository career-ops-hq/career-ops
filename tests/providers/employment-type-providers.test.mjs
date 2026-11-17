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
