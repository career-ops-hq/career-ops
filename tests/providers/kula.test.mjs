// tests/providers/kula.test.mjs — Kula per-tenant RSS feed provider.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — kula');

// Minimal item builder mirroring the live feed shape: one <item>
// per posting or per office, a CDATA <description>, and `job:` extension tags.
function item({ title, link, pubDate = 'Thu, 24 Sep 2026 15:06:30 +0000', category = 'Engineering', description = '<p>Build things.</p>', extra = '' }) {
  return [
    '<item>',
    title === undefined ? '' : `<title>${title}</title>`,
    link === undefined ? '' : `<link>${link}</link>`,
    link === undefined ? '' : `<guid isPermaLink="true">${link}</guid>`,
    pubDate === null ? '' : `<pubDate>${pubDate}</pubDate>`,
    `<category>${category}</category>`,
    description === null ? '' : `<description><![CDATA[${description}]]></description>`,
    extra,
    '</item>',
  ].join('\n');
}
function office({ name = '', city = '', state = '', country = '', remote = 'false' } = {}) {
  return [
    '<job:location>',
    `<job:officeName>${name}</job:officeName>`,
    `<job:remote>${remote}</job:remote>`,
    city ? `<job:city>${city}</job:city>` : '',
    state ? `<job:state>${state}</job:state>` : '',
    country ? `<job:country>${country}</job:country>` : '',
    '<job:isHQ>false</job:isHQ>',
    '</job:location>',
  ].join('');
}
function salary({ currency = 'USD', min = '', max = '', interval = 'YEARLY', type = 'BASE' } = {}) {
  return `<job:salary><job:currency>${currency}</job:currency><job:minAmount>${min}</job:minAmount><job:maxAmount>${max}</job:maxAmount><job:interval>${interval}</job:interval><job:type>${type}</job:type></job:salary>`;
}
function feed(items, title = 'Acme Corp') {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:job="https://kula.ai/rss" version="2.0">',
    '<channel>',
    `<title>${title}</title>`,
    '<link>https://careers.kula.ai/acme</link>',
    `<description>Job openings at ${title}</description>`,
    '<atom:link href="https://careers.kula.ai/acme/feed" rel="self" type="application/rss+xml"/>',
    `<image><url>https://assets.kula.ai/images/career/x</url><title>${title}</title><link>https://careers.kula.ai/acme</link></image>`,
    ...items,
    '</channel>',
    '</rss>',
  ].join('\n');
}

const FEED_URL = 'https://careers.kula.ai/acme/feed';
const ENTRY = { name: 'Acme', careers_url: 'https://careers.kula.ai/acme' };

try {
  const kulaModule = await import(pathToFileURL(join(ROOT, 'providers/kula.mjs')).href);
  const kula = kulaModule.default;
  const { parseKulaFeed, MAX_FEED_ITEMS } = kulaModule;

  if (kula.id === 'kula') pass('kula.id is "kula"');
  else fail(`kula.id is ${JSON.stringify(kula.id)}`);

  // --- detect() ------------------------------------------------------------
  const detectCases = [
    ['board root', { careers_url: 'https://careers.kula.ai/acme' }],
    ['trailing slash', { careers_url: 'https://careers.kula.ai/acme/' }],
    ['a posting page under the board', { careers_url: 'https://careers.kula.ai/acme/123-staff-engineer' }],
    ['upper-case slug (Kula slugs are case-insensitive)', { careers_url: 'https://careers.kula.ai/ACME' }],
    ['api: pointing at the feed', { api: 'https://careers.kula.ai/acme/feed' }],
    ['api: on the feed while careers_url is the employer site', { careers_url: 'https://acme.example/careers', api: 'https://careers.kula.ai/acme/feed' }],
  ];
  for (const [label, fields] of detectCases) {
    const hit = kula.detect({ name: 'Acme', ...fields });
    if (hit && hit.url === FEED_URL) pass(`kula.detect() claims ${label} → /acme/feed`);
    else fail(`kula.detect() ${label} returned ${JSON.stringify(hit)}`);
  }

  const rejectCases = [
    ['a non-Kula host', 'https://example.com/acme'],
    ['a path-spoofed URL', 'https://evil.example/careers.kula.ai/acme'],
    ['a host-suffix spoof', 'https://careers.kula.ai.evil.example/acme'],
    ['another kula.ai subdomain', 'https://api.kula.ai/acme'],
    ['non-https', 'http://careers.kula.ai/acme'],
    ['a malformed URL', 'not a url'],
    ['an empty path (no slug)', 'https://careers.kula.ai/'],
    ['the reserved /api route', 'https://careers.kula.ai/api/jobs'],
    ['the /_next asset route', 'https://careers.kula.ai/_next/static/x.js'],
    ['a dotted segment', 'https://careers.kula.ai/robots.txt'],
    ['an encoded space in the slug', 'https://careers.kula.ai/a%20b'],
    ['a leading-hyphen slug', 'https://careers.kula.ai/-acme'],
    ['an underscore slug', 'https://careers.kula.ai/ac_me'],
  ];
  for (const [label, url] of rejectCases) {
    const hit = kula.detect({ name: 'X', careers_url: url });
    if (hit === null) pass(`kula.detect() rejects ${label}`);
    else fail(`kula.detect() should reject ${label}, got ${JSON.stringify(hit)}`);
  }
  let junkOk = true;
  for (const junk of [{ name: 'X', careers_url: null }, { name: 'X', careers_url: 7 }, { name: 'X' }, {}, null, undefined]) {
    try {
      if (kula.detect(/** @type {any} */ (junk)) !== null) junkOk = false;
    } catch {
      junkOk = false;
    }
  }
  if (junkOk) pass('kula.detect() returns null (no throw) for null / non-string / missing careers_url and a null entry');
  else fail('kula.detect() must return null without throwing on junk entries');

  // --- parseKulaFeed(): per-office variant (one item per office, /apply links)
  const perOffice = feed([
    item({
      title: 'Research &amp; Development Engineer',
      link: 'https://careers.kula.ai/acme/101/apply',
      pubDate: 'Fri, 25 Sep 2026 15:19:35 +0000',
      description: '<p>Own the <strong>fuzzing</strong> pipeline &amp; triage.</p><ul><li>Rust</li></ul>',
      extra: '<job:referencenumber>101-7</job:referencenumber><job:workplace>OFFICE</job:workplace>'
        + office({ name: 'HQ', city: 'Springfield', state: 'Illinois', country: 'United States' })
        + salary({ min: '150000.0', max: '190000.0' }),
    }),
    item({
      title: 'Research &amp; Development Engineer',
      link: 'https://careers.kula.ai/acme/101/apply',
      pubDate: 'Fri, 25 Sep 2026 15:19:35 +0000',
      description: '<p>Own the <strong>fuzzing</strong> pipeline &amp; triage.</p><ul><li>Rust</li></ul>',
      extra: '<job:referencenumber>101-8</job:referencenumber><job:workplace>OFFICE</job:workplace>'
        + office({ name: 'Jakarta Office', city: 'Jakarta', state: 'Jakarta', country: 'Indonesia' })
        + salary({ min: '160000.0', max: '200000.0' }),
    }),
    item({
      title: 'Support Engineer',
      link: 'https://careers.kula.ai/acme/102/apply',
      extra: '<job:referencenumber>102-9</job:referencenumber><job:workplace>REMOTE</job:workplace>'
        + office({ name: 'United States', country: 'United States', remote: 'true' })
        + salary({ min: '40.0', max: '50.0', interval: 'HOURLY' }),
    }),
    item({
      title: 'Backend Engineer',
      link: 'https://careers.kula.ai/acme/103/apply',
      extra: '<job:workplace>OFFICE</job:workplace>' + office({ name: 'United Kingdom', country: 'United Kingdom', remote: 'true' }),
    }),
  ]);
  const jobs = parseKulaFeed(perOffice, 'acme', 'Acme');

  if (jobs.length === 3) pass('parseKulaFeed merges per-office items sharing a job id (4 items → 3 postings)');
  else fail(`parseKulaFeed returned ${jobs.length} postings, expected 3: ${JSON.stringify(jobs.map((j) => j.url))}`);

  const rd = jobs.find((j) => j.url === 'https://careers.kula.ai/acme/101');
  if (rd?.title === 'Research & Development Engineer' && rd.company === 'Acme') {
    pass('parseKulaFeed decodes title entities (&amp; → &) before any keyword match, sets company, builds the id-only posting URL');
  } else {
    fail(`posting 101 = ${JSON.stringify(rd)}`);
  }
  if (rd?.location === 'Springfield, Illinois, United States; Jakarta, Indonesia') {
    pass('parseKulaFeed joins every office of a posting, city/state/country first, repeats dropped');
  } else {
    fail(`posting 101 location = ${JSON.stringify(rd?.location)}`);
  }
  if (rd?.postedAt === Date.parse('Fri, 25 Sep 2026 15:19:35 +0000')) pass('parseKulaFeed maps <pubDate> → postedAt epoch ms');
  else fail(`posting 101 postedAt = ${JSON.stringify(rd?.postedAt)}`);
  if (rd?.description === 'Own the fuzzing pipeline & triage. Rust') {
    pass('parseKulaFeed unwraps the CDATA description to plain text with entities decoded');
  } else {
    fail(`posting 101 description = ${JSON.stringify(rd?.description)}`);
  }
  if (rd?.salary?.min === 150000 && rd?.salary?.max === 200000 && rd?.salary?.currency === 'USD') {
    pass('parseKulaFeed takes the salary envelope across a posting\'s office items');
  } else {
    fail(`posting 101 salary = ${JSON.stringify(rd?.salary)}`);
  }

  const support = jobs.find((j) => j.url === 'https://careers.kula.ai/acme/102');
  if (support?.location === 'United States (Remote)' && support?.salary?.min === 40 * 2080 && support?.salary?.max === 50 * 2080) {
    pass('parseKulaFeed marks a REMOTE posting "(Remote)" and annualizes an HOURLY range');
  } else {
    fail(`posting 102 = ${JSON.stringify(support)}`);
  }
  const backend = jobs.find((j) => j.url === 'https://careers.kula.ai/acme/103');
  if (backend?.location === 'United Kingdom (Remote)' && backend.salary === undefined) {
    pass('parseKulaFeed marks a remote office "(Remote)" on an OFFICE posting (as Kula\'s board does); no salary block → no salary');
  } else {
    fail(`posting 103 = ${JSON.stringify(backend)}`);
  }

  // --- identity, employment / workplace type, locations[], salary period
  if (rd?.externalId === '101' && support?.externalId === '102' && jobs.every((j) => !('listingIdentity' in j))) {
    pass('parseKulaFeed sets externalId to the link id and never returns a URL-derived listingIdentity');
  } else {
    fail(`externalId / listingIdentity: ${JSON.stringify(jobs.map((j) => [j.externalId, j.listingIdentity]))}`);
  }
  if (rd?.workplaceType === 'onsite' && support?.workplaceType === 'remote') {
    pass('parseKulaFeed maps <job:workplace> OFFICE → onsite and REMOTE → remote');
  } else {
    fail(`workplaceType = ${JSON.stringify([rd?.workplaceType, support?.workplaceType])}`);
  }
  if (JSON.stringify(rd?.locations) === JSON.stringify(['Springfield, Illinois, United States', 'Jakarta, Indonesia'])
      && JSON.stringify(support?.locations) === JSON.stringify(['United States'])) {
    pass('parseKulaFeed lists places in locations[] without the "(Remote)" suffix');
  } else {
    fail(`locations[] = ${JSON.stringify([rd?.locations, support?.locations])}`);
  }
  if (rd?.salary?.period === 'year' && JSON.stringify(rd.salary.posted) === JSON.stringify({ min: 150000, max: 200000 })
      && support?.salary?.period === 'hour' && JSON.stringify(support.salary.posted) === JSON.stringify({ min: 40, max: 50 })) {
    pass('parseKulaFeed reports the salary period and the as-posted bounds (not annualized)');
  } else {
    fail(`salary period/posted = ${JSON.stringify([rd?.salary, support?.salary])}`);
  }
  const typed = parseKulaFeed(feed([
    item({ title: 'FT', link: 'https://careers.kula.ai/acme/701', extra: '<job:employmentType>FULL_TIME</job:employmentType><job:workplace>HYBRID</job:workplace>' }),
    item({ title: 'PT', link: 'https://careers.kula.ai/acme/702', extra: '<job:employmentType>PART_TIME</job:employmentType>' }),
    item({ title: 'Contract', link: 'https://careers.kula.ai/acme/703', extra: '<job:employmentType>CONTRACT</job:employmentType>' }),
    item({ title: 'Unknown', link: 'https://careers.kula.ai/acme/704', extra: '<job:employmentType>VOLUNTEER</job:employmentType><job:workplace>ELSEWHERE</job:workplace>' }),
    item({ title: 'Disagree', link: 'https://careers.kula.ai/acme/705/apply', extra: '<job:workplace>OFFICE</job:workplace>' }),
    item({ title: 'Disagree', link: 'https://careers.kula.ai/acme/705/apply', extra: '<job:workplace>REMOTE</job:workplace>' }),
  ]), 'acme', 'Acme');
  const typedBy = Object.fromEntries(typed.map((j) => [j.title, j]));
  if (typedBy.FT.employmentType === 'full_time' && typedBy.FT.workplaceType === 'hybrid'
      && typedBy.PT.employmentType === 'part_time' && typedBy.Contract.employmentType === 'contract'
      && !('employmentType' in typedBy.Unknown) && !('workplaceType' in typedBy.Unknown)
      && !('workplaceType' in typedBy.Disagree)) {
    pass('parseKulaFeed normalizes employmentType; unknown or conflicting employment / workplace values are omitted, not guessed');
  } else {
    fail(`typed = ${JSON.stringify(typed)}`);
  }
  const mixedPeriod = parseKulaFeed(feed([
    item({ title: 'Mixed', link: 'https://careers.kula.ai/acme/801/apply', extra: salary({ min: '100000', max: '120000' }) }),
    item({ title: 'Mixed', link: 'https://careers.kula.ai/acme/801/apply', extra: salary({ min: '5000', max: '6000', interval: 'MONTHLY' }) }),
    item({ title: 'OneSided', link: 'https://careers.kula.ai/acme/802', extra: salary({ min: '90000', max: '' }) }),
  ]), 'acme', 'Acme');
  const mixedBy = Object.fromEntries(mixedPeriod.map((j) => [j.title, j.salary]));
  if (mixedBy.Mixed?.min === 60000 && mixedBy.Mixed.max === 120000 && !('period' in mixedBy.Mixed) && !('posted' in mixedBy.Mixed)) {
    pass('a posting whose ranges use different intervals keeps the annualized envelope but no period / posted');
  } else {
    fail(`mixed-interval salary = ${JSON.stringify(mixedBy.Mixed)}`);
  }
  if (mixedBy.OneSided?.min === 90000 && mixedBy.OneSided.max === 90000 && mixedBy.OneSided.period === 'year' && !('posted' in mixedBy.OneSided)) {
    pass('a one-sided range keeps its annualized fill and period but reports no as-posted bounds');
  } else {
    fail(`one-sided salary = ${JSON.stringify(mixedBy.OneSided)}`);
  }

  // --- per-posting variant (one item, several <job:location>, id-only link)
  const perPosting = feed([
    item({
      title: 'Staff Engineer',
      link: 'https://careers.kula.ai/acme/4315',
      extra: '<job:workplace>REMOTE</job:workplace>'
        + office({ name: 'Canada', city: 'Vancouver', state: 'British Columbia', country: 'Canada', remote: 'true' })
        + office({ name: 'United States', country: 'United States', remote: 'true' }),
    }),
    item({
      title: 'Office Name Only',
      link: 'https://careers.kula.ai/acme/4316',
      extra: '<job:workplace>OFFICE</job:workplace>' + office({ name: 'Bengaluru Main' }),
    }),
    item({
      title: 'Remote Office Name',
      link: 'https://careers.kula.ai/acme/4317',
      extra: '<job:workplace>REMOTE</job:workplace>' + office({ name: 'Remote', remote: 'true' }),
    }),
    item({
      title: 'No Offices Remote',
      link: 'https://careers.kula.ai/acme/4318',
      extra: '<job:workplace>REMOTE</job:workplace>',
    }),
  ]);
  const pp = parseKulaFeed(perPosting, 'acme', 'Acme');
  const byUrl = Object.fromEntries(pp.map((j) => [j.url, j]));
  if (byUrl['https://careers.kula.ai/acme/4315']?.location === 'Vancouver, British Columbia, Canada (Remote); United States (Remote)') {
    pass('parseKulaFeed reads every <job:location> of a single-item posting (per-posting variant)');
  } else {
    fail(`posting 4315 = ${JSON.stringify(byUrl['https://careers.kula.ai/acme/4315'])}`);
  }
  if (byUrl['https://careers.kula.ai/acme/4316']?.location === 'Bengaluru Main'
      && byUrl['https://careers.kula.ai/acme/4317']?.location === 'Remote'
      && byUrl['https://careers.kula.ai/acme/4318']?.location === 'Remote') {
    pass('parseKulaFeed falls back to the office name, and never prints "Remote (Remote)"');
  } else {
    fail(`fallback locations = ${JSON.stringify(pp.map((j) => j.location))}`);
  }

  // --- merge rules across one posting's per-office items
  const merging = feed([
    // Later pubDate first in feed order, so neither "first wins" nor "latest
    // wins" can pass for "earliest wins".
    item({
      title: 'Platform Engineer',
      link: 'https://careers.kula.ai/acme/501/apply',
      pubDate: 'Sat, 26 Sep 2026 09:00:00 +0000',
      extra: '<job:referencenumber>501-1</job:referencenumber>' + office({ name: 'Jakarta Office', city: 'Jakarta', country: 'Indonesia' }),
    }),
    item({
      title: 'Platform Engineer',
      link: 'https://careers.kula.ai/acme/501/apply',
      pubDate: 'Tue, 22 Sep 2026 09:00:00 +0000',
      // A second office that geocodes to the same place (different office
      // name, same city/country, different case) must not repeat the label.
      extra: '<job:referencenumber>501-2</job:referencenumber>' + office({ name: 'Jakarta HQ', city: 'JAKARTA', country: 'indonesia' }),
    }),
    item({
      title: 'Platform Engineer',
      link: 'https://careers.kula.ai/acme/501/apply',
      pubDate: 'Thu, 24 Sep 2026 09:00:00 +0000',
      extra: '<job:referencenumber>501-3</job:referencenumber>' + office({ name: 'Singapore', country: 'Singapore' }),
    }),
    // <guid> but no <link>: the id comes from the guid.
    '<item><title>Guid Only</title><guid isPermaLink="true">https://careers.kula.ai/acme/502</guid><pubDate>Thu, 24 Sep 2026 15:06:30 +0000</pubDate></item>',
  ]);
  const merged = Object.fromEntries(parseKulaFeed(merging, 'acme', 'Acme').map((j) => [j.url, j]));
  const p501 = merged['https://careers.kula.ai/acme/501'];
  if (p501?.postedAt === Date.parse('Tue, 22 Sep 2026 09:00:00 +0000')) {
    pass('parseKulaFeed takes the EARLIEST pubDate across a posting\'s items (not the first or the latest)');
  } else {
    fail(`posting 501 postedAt = ${p501?.postedAt && new Date(p501.postedAt).toISOString()}`);
  }
  if (p501?.location === 'Jakarta, Indonesia; Singapore') {
    pass('parseKulaFeed lists a place once when two of a posting\'s offices resolve to the same label (case-insensitive)');
  } else {
    fail(`posting 501 location = ${JSON.stringify(p501?.location)}`);
  }
  if (merged['https://careers.kula.ai/acme/502']?.title === 'Guid Only') {
    pass('parseKulaFeed falls back to <guid> for the job id when an item has no <link>');
  } else {
    fail(`guid-only item → ${JSON.stringify(Object.keys(merged))}`);
  }

  // --- salary intervals: annual figures filed under a payroll frequency.
  // Observed live: BI_WEEKLY / SEMI_MONTHLY ranges that carry annual amounts
  // (e.g. BI_WEEKLY 164100–222100, matching the JD's yearly figures); ×26
  // would read as $4.3M and salary_filter would drop the posting. Such ranges
  // must yield no salary, never a guess.
  const salaryCase = (n, blocks) => item({ title: `Pay ${n}`, link: `https://careers.kula.ai/acme/${600 + n}`, extra: blocks });
  const pay = Object.fromEntries(parseKulaFeed(feed([
    salaryCase(1, salary({ min: '164100.0', max: '222100.0', interval: 'BI_WEEKLY' })),
    salaryCase(2, salary({ min: '55000.0', max: '79000.0', interval: 'SEMI_MONTHLY' })),
    salaryCase(3, salary({ min: '4000.0', max: '6000.0', interval: 'BI_WEEKLY' })),
    salaryCase(4, salary({ min: '80000.0', max: '100000.0', interval: 'HOURLY' })),
    salaryCase(5, salary({ min: '60000.0', max: '90000.0', interval: 'MONTHLY' })),
    salaryCase(6, salary({ min: '1000.0', max: '1500.0', interval: 'HOURLY' })),
    salaryCase(7, salary({ min: '0.0', max: '1.0', interval: 'HOURLY' })),
    salaryCase(8, salary({ min: '0.0', max: '1.0', interval: 'YEARLY' })),
    salaryCase(9, salary({ currency: 'EUR', min: '3000.0', max: '4000.0', interval: 'MONTHLY' })),
    salaryCase(10, salary({ min: '15000.0', max: '19000.0', interval: 'MONTHLY' })),
    salaryCase(11, salary({ min: '164100.0', max: '222100.0', interval: 'YEARLY' }) + salary({ min: '164100.0', max: '222100.0', interval: 'BI_WEEKLY' })),
    salaryCase(12, salary({ min: '250000.0', max: '400000.0', interval: 'YEARLY' })),
    salaryCase(13, salary({ min: '4000.0', max: '6000.0', interval: 'SEMI_MONTHLY' })),
    salaryCase(14, salary({ min: '18000.0', max: '20000.0', interval: 'QUARTERLY' })),
  ]), 'acme', 'Acme').map((j) => [j.title, j.salary]));
  const noSalary = [
    ['Pay 1', 'a BI_WEEKLY range with annual figures (164100–222100)'],
    ['Pay 2', 'a SEMI_MONTHLY range with annual figures (55000–79000)'],
    ['Pay 3', 'any BI_WEEKLY range, even per-period-sized (the unit is unknowable)'],
    ['Pay 13', 'any SEMI_MONTHLY range, even per-period-sized (the unit is unknowable)'],
    ['Pay 4', 'an HOURLY range with annual figures (80000–100000)'],
    ['Pay 5', 'a MONTHLY range whose raw figures are annual-sized (60000–90000; ×12 would still be under the ceiling)'],
    ['Pay 6', 'an HOURLY range whose annualized upper bound passes MAX_ANNUALIZED (1500 × 2080)'],
    ['Pay 7', 'the "0.0–1.0" hidden-pay placeholder under HOURLY'],
    ['Pay 8', 'the "0.0–1.0" hidden-pay placeholder under YEARLY'],
    ['Pay 14', 'a sub-annual range whose upper bound is exactly ANNUAL_SIZED_AMOUNT (QUARTERLY 18000–20000)'],
  ];
  for (const [title, label] of noSalary) {
    if (title in pay && pay[title] === undefined) pass(`parseKulaFeed emits no salary for ${label}`);
    else fail(`${title} (${label}) salary = ${JSON.stringify(pay[title])}`);
  }
  const kept = [
    ['Pay 9', { min: 36000, max: 48000, currency: 'EUR' }, 'a per-period MONTHLY range (EUR 3000–4000 → 36000–48000)'],
    ['Pay 10', { min: 180000, max: 228000, currency: 'USD' }, 'a MONTHLY range just under ANNUAL_SIZED_AMOUNT (15000–19000 → 180000–228000)'],
    ['Pay 11', { min: 164100, max: 222100, currency: 'USD' }, 'the YEARLY range of a posting whose BI_WEEKLY twin is dropped'],
    ['Pay 12', { min: 250000, max: 400000, currency: 'USD' }, 'a YEARLY range at annual magnitude (YEARLY is exempt from the sub-annual guard)'],
  ];
  for (const [title, want, label] of kept) {
    const { min, max, currency } = pay[title] || {};
    if (JSON.stringify({ min, max, currency }) === JSON.stringify(want)) pass(`parseKulaFeed keeps ${label}`);
    else fail(`${title} (${label}) salary = ${JSON.stringify(pay[title])}, want ${JSON.stringify(want)}`);
  }

  // Company falls back to the channel <title> when the entry has no name.
  const noName = parseKulaFeed(perPosting, 'acme', '');
  if (noName[0]?.company === 'Acme Corp') pass('parseKulaFeed falls back to the channel <title> for company');
  else fail(`channel-title fallback company = ${JSON.stringify(noName[0]?.company)}`);

  // --- bad rows are skipped, never fatal
  const messy = feed([
    item({ title: 'No Link' }),
    item({ title: 'Off Host', link: 'https://evil.example/acme/201' }),
    item({ title: 'Path Spoof', link: 'https://evil.example/careers.kula.ai/acme/202' }),
    item({ title: 'Other Tenant', link: 'https://careers.kula.ai/globex/203/apply' }),
    item({ title: 'Plain HTTP', link: 'http://careers.kula.ai/acme/204' }),
    item({ title: 'Not Numeric', link: 'https://careers.kula.ai/acme/abc/apply' }),
    item({ title: '', link: 'https://careers.kula.ai/acme/205' }),
    item({ title: 'Bad Date', link: 'https://careers.kula.ai/acme/206', pubDate: 'not a date', description: null,
      extra: salary({ min: '0', max: '', interval: 'YEARLY' }) + salary({ min: '5000', max: '6000', interval: 'ONE_TIME' }) + salary({ min: '1', max: '2', type: 'BONUS' }) }),
    item({ title: 'Mixed Currency', link: 'https://careers.kula.ai/acme/207',
      extra: salary({ currency: 'USD', min: '100', max: '200' }) + salary({ currency: 'EUR', min: '100', max: '200' }) }),
    item({ title: 'Good One', link: 'https://careers.kula.ai/ACME/208/apply' }),
  ]);
  let messyJobs = [];
  try {
    messyJobs = parseKulaFeed(messy, 'acme', 'Acme');
  } catch (err) {
    fail(`parseKulaFeed threw on a feed with bad rows: ${err.message}`);
  }
  const messyUrls = messyJobs.map((j) => j.url).sort();
  if (JSON.stringify(messyUrls) === JSON.stringify([
    'https://careers.kula.ai/acme/206',
    'https://careers.kula.ai/acme/207',
    'https://careers.kula.ai/acme/208',
  ])) {
    pass('parseKulaFeed skips items with no link, an off-host / path-spoofed / other-tenant / http / non-numeric link, or no title');
  } else {
    fail(`messy feed kept ${JSON.stringify(messyUrls)}`);
  }
  const badDate = messyJobs.find((j) => j.url.endsWith('/206'));
  if (badDate && badDate.postedAt === undefined && badDate.description === undefined && badDate.salary === undefined) {
    pass('an unparseable pubDate, missing description, and zero / ONE_TIME / non-BASE salary are omitted, not guessed');
  } else {
    fail(`posting 206 = ${JSON.stringify(badDate)}`);
  }
  if (messyJobs.find((j) => j.url.endsWith('/207'))?.salary === undefined) pass('ranges in two currencies yield no salary envelope');
  else fail('mixed-currency salary should be omitted');

  // --- empty / contentless / wrong-shape bodies
  try {
    const out = parseKulaFeed(feed([]), 'acme', 'Acme');
    if (Array.isArray(out) && out.length === 0) pass('parseKulaFeed → [] for an RSS channel with no items (an honest empty board)');
    else fail(`parseKulaFeed(empty channel) returned ${JSON.stringify(out)}`);
  } catch (err) {
    fail(`parseKulaFeed(empty channel) threw: ${err.message}`);
  }
  for (const [label, body] of [['an empty string', ''], ['whitespace', '  \n '], ['null', null], ['a number', 42], ['an RSS root with no channel', '<rss version="2.0"></rss>'], ['a JSON error body', '{"errors":["err_account_not_found"]}']]) {
    try {
      parseKulaFeed(body, 'acme', 'Acme');
      fail(`parseKulaFeed must throw for ${label}`);
    } catch (err) {
      if (/^kula: Acme: /.test(err.message)) pass(`parseKulaFeed throws a descriptive error for ${label} (not an empty board)`);
      else fail(`parseKulaFeed(${label}) error message: ${err.message}`);
    }
  }
  try {
    parseKulaFeed('<!DOCTYPE html><html><body>Not found</body></html>', 'acme', 'Acme');
    fail('parseKulaFeed must throw on a non-RSS (HTML) body');
  } catch (err) {
    if (/not RSS/.test(err.message) && /DOCTYPE/.test(err.message)) pass('parseKulaFeed throws a descriptive error on a non-RSS body');
    else fail(`non-RSS error message: ${err.message}`);
  }
  try {
    parseKulaFeed(feed([item({ title: 'A', link: 'https://careers.kula.ai/acme/jobs/301' }), item({ title: 'B', link: 'https://careers.kula.ai/acme/jobs/302' })]), 'acme', 'Acme');
    fail('parseKulaFeed must throw when no item carries a recognisable job link');
  } catch (err) {
    if (/2 feed item\(s\) but none links/.test(err.message) && /acme\/jobs\/301/.test(err.message)) {
      pass('parseKulaFeed throws (naming the link it got) when every item\'s link is unrecognised — a format change, not an empty board');
    } else {
      fail(`format-change error message: ${err.message}`);
    }
  }

  // --- a body cut off mid-transfer is a broken response, not an empty board
  const whole201 = feed([item({ title: 'Cut Test', link: 'https://careers.kula.ai/acme/901' })]);
  const truncatedBodies = [
    ['opening tags only, cut inside an item', '<rss version="2.0"><channel><item><title>Engineer'],
    ['cut after a complete item, before </channel>', whole201.slice(0, whole201.indexOf('</channel>'))],
    ['cut between </channel> and </rss>', whole201.slice(0, whole201.indexOf('</rss>'))],
    ['an <item> that is never closed', whole201.replace('</item>', '')],
    ['cut inside a CDATA description', whole201.slice(0, whole201.indexOf('Build things') + 5)],
  ];
  for (const [label, body] of truncatedBodies) {
    try {
      const out = parseKulaFeed(body, 'acme', 'Acme');
      fail(`parseKulaFeed must throw for a truncated body (${label}), returned ${JSON.stringify(out)}`);
    } catch (err) {
      if (/incomplete or truncated/.test(err.message)) pass(`parseKulaFeed throws on a truncated body: ${label}`);
      else fail(`truncated body (${label}) error message: ${err.message}`);
    }
  }
  // Markup-looking text inside a CDATA description must not unbalance the count.
  const cdataItems = parseKulaFeed(feed([item({
    title: 'Mentions Items',
    link: 'https://careers.kula.ai/acme/902',
    description: '<p>Use the &lt;item&gt; tag; literal <item> and </channel> text in the JD.</p>',
  })]), 'acme', 'Acme');
  if (cdataItems.length === 1 && cdataItems[0].title === 'Mentions Items') {
    pass('parseKulaFeed ignores item / channel markup inside a CDATA description when checking the envelope');
  } else {
    fail(`CDATA markup feed → ${JSON.stringify(cdataItems)}`);
  }
  if (parseKulaFeed(feed([]) + '\n', 'acme', 'Acme').length === 0) pass('a complete channel with zero items, with a trailing newline, stays an empty board');
  else fail('complete empty channel with trailing newline should return []');

  // --- an untitled item never contributes to a later valid item with the same id
  const untitledFirst = parseKulaFeed(feed([
    item({
      title: '',
      link: 'https://careers.kula.ai/acme/910/apply',
      pubDate: 'Mon, 01 Jan 2024 00:00:00 +0000',
      description: '<p>Malformed row description.</p>',
      extra: '<job:employmentType>CONTRACT</job:employmentType><job:workplace>REMOTE</job:workplace>'
        + office({ name: 'Ghost Office', city: 'Nowhere', country: 'Atlantis' })
        + salary({ min: '1000000', max: '2000000' }),
    }),
    item({
      title: 'Real Role',
      link: 'https://careers.kula.ai/acme/910/apply',
      pubDate: 'Fri, 25 Sep 2026 15:19:35 +0000',
      description: '<p>Real description.</p>',
      extra: '<job:employmentType>FULL_TIME</job:employmentType><job:workplace>OFFICE</job:workplace>'
        + office({ name: 'HQ', city: 'Springfield', country: 'United States' }),
    }),
  ]), 'acme', 'Acme');
  const real = untitledFirst.find((j) => j.url.endsWith('/910'));
  if (untitledFirst.length === 1 && real?.title === 'Real Role' && real.description === 'Real description.'
      && real.location === 'Springfield, United States' && real.employmentType === 'full_time'
      && real.workplaceType === 'onsite' && real.postedAt === Date.parse('Fri, 25 Sep 2026 15:19:35 +0000')
      && real.salary === undefined) {
    pass('an untitled item for the same job id leaks no description, offices, salary, date or types into the valid item');
  } else {
    fail(`untitled-then-valid merge → ${JSON.stringify(untitledFirst)}`);
  }
  const untitledOnly = parseKulaFeed(feed([item({ title: '', link: 'https://careers.kula.ai/acme/911' })]), 'acme', 'Acme');
  if (untitledOnly.length === 0) pass('a feed whose only item is untitled yields no posting (and is not read as a format change)');
  else fail(`untitled-only feed → ${JSON.stringify(untitledOnly)}`);

  // --- hard item cap (the feed is one unpaginated document)
  if (MAX_FEED_ITEMS === 20_000) pass('MAX_FEED_ITEMS is a fixed constant (20000), not taken from the source');
  else fail(`MAX_FEED_ITEMS = ${MAX_FEED_ITEMS}`);
  const five = feed([1, 2, 3, 4, 5].map((n) => item({ title: `Role ${n}`, link: `https://careers.kula.ai/acme/${400 + n}` })));
  const warnings = [];
  const origError = console.error;
  console.error = (...args) => { warnings.push(args.join(' ')); };
  let capped;
  try {
    capped = parseKulaFeed(five, 'acme', 'Acme', { maxItems: 3 });
  } finally {
    console.error = origError;
  }
  if (capped.length === 3 && warnings.some((w) => /5 items; parsed the first 3/.test(w))) {
    pass('the item cap stops the parse and warns that the list was truncated');
  } else {
    fail(`capped parse = ${capped?.length} jobs, warnings ${JSON.stringify(warnings)}`);
  }
  if (capped.truncated?.reason === 'item-cap' && capped.truncated.fetched === 3 && capped.truncated.total === 5) {
    pass('a feed cut at the item cap carries the canonical jobs.truncated marker (reason item-cap, fetched 3 of 5)');
  } else {
    fail(`capped parse truncated marker = ${JSON.stringify(capped?.truncated)}`);
  }
  const whole = parseKulaFeed(five, 'acme', 'Acme');
  if (whole.truncated === undefined) pass('a feed read in full carries no truncated marker');
  else fail(`full read truncated marker = ${JSON.stringify(whole.truncated)}`);
  // The ceiling holds even against an override: a feed one item past
  // MAX_FEED_ITEMS, parsed with a huge maxItems, still stops at the ceiling.
  const huge = feed(Array.from({ length: MAX_FEED_ITEMS + 1 }, (_, n) => `<item><title>R${n}</title><link>https://careers.kula.ai/acme/${n + 1}</link></item>`));
  const hugeWarnings = [];
  console.error = (...args) => { hugeWarnings.push(args.join(' ')); };
  let overCap;
  try {
    overCap = parseKulaFeed(huge, 'acme', 'Acme', { maxItems: 10 ** 9 });
  } finally {
    console.error = origError;
  }
  if (overCap.length === MAX_FEED_ITEMS && hugeWarnings.some((w) => /MAX_FEED_ITEMS/.test(w))) {
    pass('a maxItems override cannot raise the hard ceiling (MAX_FEED_ITEMS + 1 items → MAX_FEED_ITEMS, with a warning)');
  } else {
    fail(`over-cap parse = ${overCap?.length}, warnings ${JSON.stringify(hugeWarnings)}`);
  }

  // --- fetch(): exact URL, redirect:'error', one request
  const calls = [];
  const fetched = await kula.fetch(ENTRY, {
    transport: 'http',
    fetchText: async (url, opts) => {
      calls.push({ url, opts });
      return perOffice;
    },
    fetchJson: async () => { throw new Error('fetchJson should not be called'); },
  });
  if (calls.length === 1 && calls[0].url === FEED_URL && calls[0].opts?.redirect === 'error' && fetched.length === 3) {
    pass('kula.fetch() makes one GET to careers.kula.ai/<slug>/feed with redirect:\'error\' and returns parsed jobs');
  } else {
    fail(`kula.fetch() calls = ${JSON.stringify(calls.map((c) => ({ url: c.url, redirect: c.opts?.redirect })))}, jobs = ${fetched.length}`);
  }
  if (calls[0]?.opts?.timeoutMs >= 10_000) pass('kula.fetch() passes a feed timeout (large tenants serve MB-sized feeds)');
  else fail(`kula.fetch() timeoutMs = ${calls[0]?.opts?.timeoutMs}`);
  if (fetched.every((j) => j.company === 'Acme')) pass('kula.fetch() labels postings with the portals.yml name');
  else fail(`kula.fetch() companies = ${JSON.stringify(fetched.map((j) => j.company))}`);

  // SSRF: a non-Kula or path-spoofed careers_url throws BEFORE any request.
  for (const [label, entry] of [
    ['a non-Kula host', { name: 'X', careers_url: 'https://example.com/acme' }],
    ['a path-spoofed URL', { name: 'X', careers_url: 'https://evil.example/careers.kula.ai/acme' }],
    ['an http URL', { name: 'X', careers_url: 'http://careers.kula.ai/acme' }],
  ]) {
    let called = false;
    try {
      await kula.fetch(entry, {
        transport: 'http',
        fetchText: async () => { called = true; return ''; },
        fetchJson: async () => { called = true; return null; },
      });
      fail(`kula.fetch() should throw for ${label}`);
    } catch (err) {
      if (!called && /kula:/.test(err.message)) pass(`kula.fetch() rejects ${label} before any request`);
      else fail(`kula.fetch() ${label}: called=${called}, err=${err.message}`);
    }
  }

  // Probe (ctx.maxPages: 1): still exactly one request, same jobs.
  const probeCalls = [];
  const probed = await kula.fetch(ENTRY, {
    transport: 'http',
    maxPages: 1,
    fetchText: async (url) => { probeCalls.push(url); return perOffice; },
    fetchJson: async () => { throw new Error('fetchJson should not be called'); },
  });
  if (probeCalls.length === 1 && probed.length === 3) pass('kula.fetch() under ctx.maxPages: 1 makes exactly one request');
  else fail(`probe made ${probeCalls.length} request(s), ${probed.length} jobs`);

  // A ctx.fetch* rejection while probing propagates unwrapped (identity kept).
  class FakeSentinel extends Error {}
  try {
    await kula.fetch(ENTRY, {
      transport: 'http',
      maxPages: 1,
      sleep: async () => {},
      fetchText: async () => { throw new FakeSentinel('budget'); },
      fetchJson: async () => null,
    });
    fail('kula.fetch() should propagate a fetchText rejection while probing');
  } catch (err) {
    if (err instanceof FakeSentinel) pass('kula.fetch() propagates a ctx.fetchText rejection unwrapped while probing');
    else fail(`probe rejection was rewrapped: ${err?.constructor?.name} ${err?.message}`);
  }

  // Transient 503 is retried; a 404 (unknown tenant) is not, and surfaces.
  let attempts = 0;
  const retried = await kula.fetch(ENTRY, {
    transport: 'http',
    sleep: async () => {},
    fetchText: async () => {
      attempts++;
      if (attempts === 1) throw Object.assign(new Error('HTTP 503'), { status: 503 });
      return perOffice;
    },
    fetchJson: async () => null,
  });
  if (attempts === 2 && retried.length === 3) pass('kula.fetch() retries a transient 503 and returns the board');
  else fail(`503 retry: attempts=${attempts}, jobs=${retried.length}`);

  let notFoundAttempts = 0;
  try {
    await kula.fetch(ENTRY, {
      transport: 'http',
      sleep: async () => {},
      fetchText: async () => {
        notFoundAttempts++;
        throw Object.assign(new Error('HTTP 404'), { status: 404, body: '{"errors":["err_account_not_found"]}' });
      },
      fetchJson: async () => null,
    });
    fail('kula.fetch() should throw on a 404 (unknown tenant)');
  } catch (err) {
    if (err.status === 404 && notFoundAttempts === 1) pass('kula.fetch() surfaces a 404 unknown-tenant error without retrying it');
    else fail(`404: status=${err.status}, attempts=${notFoundAttempts}`);
  }

  // An empty channel is an honest empty board, not an error.
  const emptyBoard = await kula.fetch(ENTRY, {
    transport: 'http',
    fetchText: async () => feed([]),
    fetchJson: async () => null,
  });
  if (Array.isArray(emptyBoard) && emptyBoard.length === 0) pass('kula.fetch() returns [] for a live feed with no items');
  else fail(`empty board = ${JSON.stringify(emptyBoard)}`);
} catch (err) {
  fail(`kula provider tests crashed: ${err?.stack || err}`);
}
