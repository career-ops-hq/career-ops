import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { isDeepStrictEqual } from 'util';

console.log('\nProviders — department and team');

const load = (file) => import(pathToFileURL(join(ROOT, 'providers', file)).href);
const labels = (jobs) => jobs.map((j) => [
  'department' in j ? j.department : '<absent>',
  'team' in j ? j.team : '<absent>',
]);
const strip = (jobs) => jobs.map(({ department, team, ...rest }) => rest);
const expect = (label, got, want) => {
  if (isDeepStrictEqual(got, want)) pass(label);
  else fail(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
};
const unchanged = (label, withMeta, withoutMeta) => {
  if (withMeta.length === withoutMeta.length && isDeepStrictEqual(strip(withMeta), withoutMeta)) pass(label);
  else fail(`${label}: ${JSON.stringify(strip(withMeta))} !== ${JSON.stringify(withoutMeta)}`);
};
const omit = (obj, ...keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));

{
  const { sourceLabel, sourceLabels, departmentTeamFields } = await load('_department-team.mjs');
  expect('helper: whitespace runs collapse to one space and the ends are trimmed',
    [sourceLabel('  Platform \n\t Infrastructure  '), sourceLabel('Data\u00a0Science'), sourceLabel('Ops\u0000Team')],
    ['Platform Infrastructure', 'Data Science', 'Ops Team']);
  expect('helper: empty, whitespace-only and non-string values give no label',
    ['', '   \n', null, undefined, 42, true, {}, ['Engineering']].map(sourceLabel),
    [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  expect('helper: a list gives its distinct labels sorted and joined; an empty list or a non-list gives none',
    [sourceLabels(['Platform', ' Engineering ', 'Platform', '', null, 7]), sourceLabels([]), sourceLabels(['  ']), sourceLabels('Engineering')],
    ['Engineering · Platform', undefined, undefined, undefined]);
  expect('helper: departmentTeamFields sets only the keys that have a label and never reads a list',
    [departmentTeamFields('Engineering', 'Platform'), departmentTeamFields('Engineering'), departmentTeamFields(undefined, 'Platform'), departmentTeamFields(' ', null), departmentTeamFields(['Engineering'], ['Platform'])],
    [{ department: 'Engineering', team: 'Platform' }, { department: 'Engineering' }, { team: 'Platform' }, {}, {}]);
}

{
  const ashby = (await load('ashby.mjs')).default;
  const posting = (id, meta) => ({
    id: `00000000-0000-4000-8000-00000000000${id}`,
    title: `Role ${id}`,
    ...meta,
    employmentType: 'FullTime',
    location: 'Remote',
    secondaryLocations: [],
    isListed: true,
    isRemote: true,
    workplaceType: 'Remote',
    descriptionPlain: 'Fixture body.',
    publishedAt: '2026-11-01T10:00:00.000+00:00',
    jobUrl: `https://jobs.ashbyhq.com/fixture/00000000-0000-4000-8000-00000000000${id}`,
    applyUrl: `https://jobs.ashbyhq.com/fixture/00000000-0000-4000-8000-00000000000${id}/application`,
  });
  const rows = [
    posting(1, { department: 'Engineering', team: 'Platform' }),
    posting(2, { department: 'Sales' }),
    posting(3, { team: 'Design Systems' }),
    posting(4, {}),
    posting(5, { department: '   ', team: 12 }),
    posting(6, { department: ' Customer \n Success ', team: null }),
  ];
  const run = (jobs) => ashby.fetch(
    { name: 'Fixture', careers_url: 'https://jobs.ashbyhq.com/fixture' },
    { transport: 'http', sleep: async () => {}, fetchJson: async () => ({ apiVersion: '1', jobs }), fetchText: async () => JSON.stringify({ jobs }) },
  );
  const withMeta = await run(rows);
  expect('ashby posting API: department and team from their own fields',
    labels(withMeta), [
      ['Engineering', 'Platform'],
      ['Sales', '<absent>'],
      ['<absent>', 'Design Systems'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['Customer Success', '<absent>'],
    ]);
  unchanged('ashby posting API: every other field is the same with or without department and team',
    withMeta, await run(rows.map((r) => omit(r, 'department', 'team'))));
  expect('ashby posting API: employmentType still normalized next to them',
    withMeta.map((j) => j.employmentType), Array(6).fill('full_time'));
}

{
  const lever = (await load('lever.mjs')).default;
  const posting = (id, meta) => ({
    id: `1111-${id}`,
    text: `Role ${id}`,
    hostedUrl: `https://jobs.lever.co/fixture/1111-${id}`,
    applyUrl: `https://jobs.lever.co/fixture/1111-${id}/apply`,
    createdAt: 1793000000000,
    categories: {
      commitment: 'Full-time',
      location: 'Remote',
      allLocations: ['Remote'],
      ...meta,
    },
    workplaceType: 'remote',
    descriptionPlain: 'Fixture body.',
    lists: [],
  });
  const rows = [
    posting(1, { department: 'Engineering', team: 'Platform' }),
    posting(2, { department: 'Engineering' }),
    posting(3, { team: 'Platform' }),
    posting(4, {}),
    posting(5, { department: '', team: ['Platform'] }),
    posting(6, { department: 'Research\t&  Development', team: '  ' }),
  ];
  const run = (jobs) => lever.fetch({ name: 'Fixture', careers_url: 'https://jobs.lever.co/fixture' }, { fetchJson: async () => jobs });
  const withMeta = await run(rows);
  expect('lever: department and team from categories.department and categories.team',
    labels(withMeta), [
      ['Engineering', 'Platform'],
      ['Engineering', '<absent>'],
      ['<absent>', 'Platform'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['Research & Development', '<absent>'],
    ]);
  unchanged('lever: every other field is the same with or without department and team',
    withMeta, await run(rows.map((r) => ({ ...r, categories: omit(r.categories, 'department', 'team') }))));
  expect('lever: employmentType still normalized next to them',
    withMeta.map((j) => j.employmentType), Array(6).fill('full_time'));
}

{
  const greenhouse = (await load('greenhouse.mjs')).default;
  const posting = (id, departments) => ({
    id,
    title: `Role ${id}`,
    absolute_url: `https://job-boards.greenhouse.io/fixture/jobs/${id}`,
    location: { name: 'Berlin, Germany' },
    requisition_id: `REQ-${id}`,
    first_published: '2026-11-01T09:00:00-04:00',
    content: '&lt;p&gt;Fixture body.&lt;/p&gt;',
    offices: [{ id: 9, name: 'Berlin, Germany' }],
    ...(departments === undefined ? {} : { departments }),
  });
  const rows = [
    posting(1, [{ id: 10, name: 'Engineering', parent_id: null, child_ids: [11] }]),
    posting(2, [
      { id: 11, name: 'Platform', parent_id: 10, child_ids: [] },
      { id: 10, name: 'Engineering', parent_id: null, child_ids: [11] },
      { id: 12, name: ' Engineering ', parent_id: null, child_ids: [] },
    ]),
    posting(3, []),
    posting(4),
    posting(5, [{ id: 13, name: '' }, { id: 14, name: null }, null, 'Engineering', { id: 15 }]),
    posting(6, { name: 'Engineering' }),
    posting(7, [{ id: 16, name: 'Sales', parent_id: null }, { id: 17, name: '\u00a0' }]),
  ];
  const run = (jobs) => greenhouse.fetch(
    { name: 'Fixture', careers_url: 'https://job-boards.greenhouse.io/fixture' },
    { fetchJson: async () => ({ jobs, meta: { total: jobs.length } }) },
  );
  const withMeta = await run(rows);
  expect('greenhouse: department from departments[].name; several give distinct names sorted and joined; no team',
    labels(withMeta), [
      ['Engineering', '<absent>'],
      ['Engineering · Platform', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['Sales', '<absent>'],
    ]);
  const reordered = await run([posting(2, [...rows[1].departments].reverse())]);
  expect('greenhouse: the joined department does not depend on the order of departments[]',
    reordered[0]?.department, 'Engineering · Platform');
  unchanged('greenhouse: every other field is the same with or without departments[]',
    withMeta, await run(rows.map((r) => omit(r, 'departments'))));
}

{
  const { parseWorkableWidget } = await load('workable.mjs');
  const row = (code, meta) => ({
    title: `Role ${code}`,
    shortcode: code,
    code: '',
    employment_type: 'Full-time',
    telecommuting: false,
    ...meta,
    url: `https://apply.workable.com/j/${code}`,
    shortlink: `https://apply.workable.com/j/${code}`,
    application_url: `https://apply.workable.com/j/${code}/apply`,
    published_on: '2026-11-01',
    created_at: '2026-10-30',
    country: 'Germany',
    city: 'Berlin',
    state: 'Berlin',
    education: '',
    experience: 'Mid-Senior level',
    function: 'Engineering',
    industry: 'Computer Software',
    locations: [{ country: 'Germany', countryCode: 'DE', city: 'Berlin', region: 'Berlin', hidden: false }],
    description: '<p>Fixture body.</p>',
  });
  const rows = [
    row('AAA111', { department: 'Engineering' }),
    row('BBB222', {}),
    row('CCC333', { department: '  ' }),
    row('DDD444', { department: 17 }),
    row('EEE555', { department: ' Product\n Design ' }),
  ];
  const run = (jobs) => parseWorkableWidget({ name: 'Fixture', description: null, jobs }, 'Fixture', 'fixture');
  const withMeta = run(rows);
  expect('workable widget: department from its own field; Workable has no team field',
    labels(withMeta), [
      ['Engineering', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['Product Design', '<absent>'],
    ]);
  unchanged('workable widget: every other field is the same with or without department',
    withMeta, run(rows.map((r) => omit(r, 'department'))));
  expect('workable widget: `function` is not read as a department or team',
    labels(run([row('FFF666', {})])), [['<absent>', '<absent>']]);
}

{
  const smartrecruiters = (await load('smartrecruiters.mjs')).default;
  const posting = (id, department) => ({
    id: `74400000${id}`,
    name: `Role ${id}`,
    uuid: `00000000-0000-4000-8000-00000000000${id}`,
    refNumber: `REF${id}`,
    company: { identifier: 'FixtureCo', name: 'Fixture' },
    releasedDate: '2026-11-01T10:00:00.000Z',
    location: { city: 'Berlin', country: 'de', remote: false, fullLocation: 'Berlin, Germany' },
    industry: { id: 'computer_software', label: 'Computer Software' },
    ...(department === undefined ? {} : { department }),
    function: { id: 'engineering', label: 'Engineering' },
    typeOfEmployment: { id: 'permanent', label: 'Full-time' },
    experienceLevel: { id: 'mid_senior_level', label: 'Mid-Senior Level' },
    customField: [],
    language: { code: 'en', label: 'English' },
    ref: `https://api.smartrecruiters.com/v1/companies/FixtureCo/postings/74400000${id}`,
  });
  const rows = [
    posting(1, { id: '2294038', label: 'Engineering, Infrastructure and Operations' }),
    posting(2, {}),
    posting(3),
    posting(4, { id: '2294039', label: '   ' }),
    posting(5, { id: '2294040' }),
    posting(6, 'Sales'),
    posting(7, { id: '2294041', label: '  Sales \t Operations ' }),
  ];
  const run = (content) => smartrecruiters.fetch(
    { name: 'Fixture', careers_url: 'https://jobs.smartrecruiters.com/FixtureCo' },
    { fetchJson: async () => ({ offset: 0, limit: 100, totalFound: content.length, content }) },
  );
  const withMeta = await run(rows);
  expect('smartrecruiters: department from department.label; function is not read; no team field',
    labels(withMeta), [
      ['Engineering, Infrastructure and Operations', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['Sales Operations', '<absent>'],
    ]);
  unchanged('smartrecruiters: every other field is the same with or without department',
    withMeta, await run(rows.map((r) => omit(r, 'department'))));
}

{
  const { parseRecruiteeResponse } = await load('recruitee.mjs');
  const offer = (id, meta) => ({
    id,
    slug: `role-${id}`,
    title: `Role ${id}`,
    status: 'published',
    ...meta,
    careers_url: `https://fixture.recruitee.com/o/role-${id}`,
    url: `https://fixture.recruitee.com/o/role-${id}`,
    location: 'Amsterdam, Netherlands',
    city: 'Amsterdam',
    country: 'Netherlands',
    remote: false,
    published_at: '2026-11-01 10:00:00 UTC',
    description: '<p>Fixture body.</p>',
    category_code: 'it',
    employment_type_code: 'fulltime_permanent',
    tags: ['Platform'],
    translations: { en: { title: `Role ${id}`, description: '<p>Fixture body.</p>' } },
  });
  const rows = [
    offer(1, { department: 'People & Operations' }),
    offer(2, {}),
    offer(3, { department: null }),
    offer(4, { department: '' }),
    offer(5, { department: { name: 'Engineering' } }),
    offer(6, { department: '\n Partnerships  ' }),
  ];
  const run = (offers) => parseRecruiteeResponse({ offers }, 'Fixture', { boardSlug: 'fixture' });
  const withMeta = run(rows);
  expect('recruitee: department from its own field; tags and category_code are not read; no team field',
    labels(withMeta), [
      ['People & Operations', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['<absent>', '<absent>'],
      ['Partnerships', '<absent>'],
    ]);
  unchanged('recruitee: every other field is the same with or without department',
    withMeta, run(rows.map((r) => omit(r, 'department'))));
}
