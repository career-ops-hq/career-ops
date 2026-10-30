// tests/providers/recruitee.test.mjs — Recruitee provider: detect(), the
// offers-API fetch, and the offer parser.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — recruitee');


try {
  const recruiteeModule = await import(pathToFileURL(join(ROOT, 'providers/recruitee.mjs')).href);
  const recruitee = recruiteeModule.default;
  const { parseRecruiteeResponse } = recruiteeModule;

  if (recruitee.id === 'recruitee') pass('recruitee.id is "recruitee"');
  else fail(`recruitee.id is ${JSON.stringify(recruitee.id)}`);

  const hit = recruitee.detect({ name: 'Acme', careers_url: 'https://acme.recruitee.com' });
  if (hit && hit.url === 'https://acme.recruitee.com/api/offers/') {
    pass('recruitee.detect() resolves <slug>.recruitee.com → api offers');
  } else {
    fail(`recruitee.detect() returned ${JSON.stringify(hit)}`);
  }

  if (recruitee.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('recruitee.detect() returns null for non-recruitee URLs');
  } else {
    fail('recruitee.detect() should return null for non-recruitee URLs');
  }

  // A tenant host behind http:, a string that is not a URL, and an entry with
  // no careers_url at all are junk input: detect() answers null, never throws.
  const junkDetects = [
    { name: 'Acme', careers_url: 'http://acme.recruitee.com' },
    { name: 'Acme', careers_url: 'not a url' },
    { name: 'Acme' },
  ].map(entry => recruitee.detect(entry));
  if (junkDetects.every(hit => hit === null)) {
    pass('recruitee.detect() returns null for a non-HTTPS tenant URL, a malformed URL and a missing careers_url');
  } else {
    fail(`recruitee.detect() junk input returned ${JSON.stringify(junkDetects)}`);
  }

  // parseRecruiteeResponse
  const sample = {
    offers: [
      { title: 'Senior PM', careers_url: 'https://acme.recruitee.com/o/senior-pm', city: 'Utrecht', country: 'Netherlands', remote: false },
      { title: 'Backend Eng', url: 'https://acme.recruitee.com/o/backend', city: 'Amsterdam', country: 'Netherlands', remote: true },
      { title: 'AI Lead', careers_url: 'https://acme.recruitee.com/o/ai-lead', location: 'Remote, EMEA' },
    ],
  };
  const jobs = parseRecruiteeResponse(sample, 'Acme');
  if (jobs.length === 3) pass('parseRecruiteeResponse extracts 3 offers');
  else fail(`parseRecruiteeResponse returned ${jobs.length} offers`);

  if (jobs[0]?.title === 'Senior PM' && jobs[0]?.company === 'Acme' && jobs[0]?.url === 'https://acme.recruitee.com/o/senior-pm') {
    pass('parseRecruiteeResponse prefers careers_url field over url');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[1]?.location === 'Amsterdam, Netherlands, Remote') {
    pass('parseRecruiteeResponse assembles city/country/remote when no location field');
  } else {
    fail(`row 1 location = ${JSON.stringify(jobs[1]?.location)}, expected "Amsterdam, Netherlands, Remote"`);
  }

  if (jobs[2]?.location === 'Remote, EMEA') {
    pass('parseRecruiteeResponse uses explicit location field when present');
  } else {
    fail(`row 2 location = ${JSON.stringify(jobs[2]?.location)}`);
  }

  // The flat primary `location` gets the same country fold as locations[]
  // entries: a subdivision-only name must not hide the country from
  // location_filter, and a name that already carries it is left alone.
  const primaryCountry = parseRecruiteeResponse({
    offers: [
      { title: 'SRE', careers_url: 'https://x.recruitee.com/o/sre', location: 'London, England', country: 'United Kingdom' },
      { title: 'PM', careers_url: 'https://x.recruitee.com/o/pm', location: 'Zürich, Zürich, Switzerland', country: 'Switzerland' },
    ],
  }, 'X');
  if (primaryCountry[0]?.location === 'London, England, United Kingdom') {
    pass('parseRecruiteeResponse appends country to a flat location that lacks it');
  } else {
    fail(`flat-location country fold = ${JSON.stringify(primaryCountry[0]?.location)}`);
  }
  if (primaryCountry[1]?.location === 'Zürich, Zürich, Switzerland') {
    pass('parseRecruiteeResponse does not duplicate a country already in the flat location');
  } else {
    fail(`flat-location no-duplicate = ${JSON.stringify(primaryCountry[1]?.location)}`);
  }

  // Empty vs broken: a present-and-empty `offers` array is an empty board; any
  // other envelope is not the documented shape and throws, naming what it got.
  if (parseRecruiteeResponse({ offers: [] }, 'X').length === 0) {
    pass('parseRecruiteeResponse returns [] for a present-and-empty offers array');
  } else {
    fail('parseRecruiteeResponse should return [] for { offers: [] }');
  }
  const brokenEnvelopes = [
    [{}, '[]'],
    [{ offers: null }, '[offers]'],
    [{ offers: {} }, '[offers]'],
    [{ jobs: [] }, '[jobs]'],
    [null, '[object]'],
    ['', '[string]'],
    [42, '[number]'],
  ];
  const envelopeResults = brokenEnvelopes.map(([body, got]) => {
    try {
      parseRecruiteeResponse(body, 'X');
      return `${JSON.stringify(body)} did not throw`;
    } catch (e) {
      return e.message === `recruitee: unexpected response — expected offers[], got: ${got}` ? null : `${JSON.stringify(body)} threw "${e.message}"`;
    }
  }).filter(Boolean);
  if (envelopeResults.length === 0) {
    pass('parseRecruiteeResponse throws, naming the keys or type it got, for every envelope that is not { offers: [...] }');
  } else {
    fail(`envelope check: ${envelopeResults.join('; ')}`);
  }

  // careers_url with non-string value → detect() returns null without crashing
  if (recruitee.detect({ name: 'X', careers_url: null }) === null && recruitee.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('recruitee.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('recruitee.detect() should treat non-string careers_url as missing');
  }

  // SSRF: malicious URL with recruitee.com in the PATH (not host) must not be detected.
  if (recruitee.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.recruitee.com/foo' }) === null) {
    pass('recruitee.detect() rejects path-spoofed URLs');
  } else {
    fail('recruitee.detect() must NOT misdetect path-spoofed URLs');
  }

  // Per-offer URL validation: custom-domain https URLs are KEPT (Recruitee
  // tenants serve postings on their own domain, e.g. careers.hostaway.com);
  // the per-offer URL is display-only and not host-locked to *.recruitee.com.
  // A non-https, malformed, or missing URL drops the WHOLE
  // offer (url is this provider's own dedup key downstream — see the Drop
  // rule doc on parseRecruiteeResponse), not just the url field.
  const offerUrlOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Recruitee domain', careers_url: 'https://acme.recruitee.com/o/good' },
        { title: 'Custom domain', careers_url: 'https://careers.hostaway.com/o/senior-backend' },
        { title: 'Insecure', careers_url: 'http://acme.recruitee.com/o/insecure' },
        { title: 'No URL field' },
      ],
    },
    'Acme',
  );
  if (
    offerUrlOffers.length === 2 &&
    offerUrlOffers[0]?.url === 'https://acme.recruitee.com/o/good' &&
    offerUrlOffers[1]?.url === 'https://careers.hostaway.com/o/senior-backend'
  ) {
    pass('parseRecruiteeResponse keeps custom-domain https URLs, drops offers with non-https or missing URL entirely');
  } else {
    fail(`URL validation: got ${offerUrlOffers.length} offer(s) = ${JSON.stringify(offerUrlOffers)}`);
  }

  // fetch() — derives the API URL, forwards the SSRF guard (redirect:'error'),
  // and returns parsed offers.
  let fetchedUrl = null;
  let fetchedOpts = null;
  const fetchJobs = await recruitee.fetch(
    { name: 'Acme', careers_url: 'https://acme.recruitee.com/' },
    { fetchJson: async (url, opts) => { fetchedUrl = url; fetchedOpts = opts; return { offers: [{ title: 'Senior PM', careers_url: 'https://acme.recruitee.com/o/senior-pm' }] }; } },
  );
  if (fetchedUrl === 'https://acme.recruitee.com/api/offers/' && fetchedOpts?.redirect === 'error' && fetchJobs.length === 1) {
    pass('recruitee.fetch() hits /api/offers/ with redirect:"error" and returns parsed offers');
  } else {
    fail(`recruitee.fetch() url=${JSON.stringify(fetchedUrl)} opts=${JSON.stringify(fetchedOpts)} jobs=${fetchJobs.length}`);
  }

  // fetch() refuses entries whose careers_url can't derive a trusted
  // <slug>.recruitee.com API URL — the guard chain runs before any request,
  // so the fetch stub is never entered.
  let untrustedFetchCalls = 0;
  try {
    await recruitee.fetch(
      { name: 'Evil', careers_url: 'https://evil.example.com/careers' },
      { fetchJson: async () => { untrustedFetchCalls++; return { offers: [] }; } },
    );
    fail('recruitee.fetch() should throw for an untrusted careers_url');
  } catch (e) {
    if (/cannot derive API URL for Evil/.test(e.message) && untrustedFetchCalls === 0) {
      pass('recruitee.fetch() throws before fetching when the host is untrusted (fetchJson called 0 times)');
    } else {
      fail(`recruitee.fetch() untrusted host: error "${e.message}", fetchJson calls ${untrustedFetchCalls}`);
    }
  }

  // ── Description ──
  // Recruitee's list payload embeds each offer's HTML body for free — same
  // request, no per-job fetch. It must arrive as plain text (tags stripped,
  // entities decoded), and offers without a body omit the key entirely.
  const descOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'With body',
          careers_url: 'https://acme.recruitee.com/o/with-body',
          description: '&lt;p&gt;Build &lt;strong&gt;pipelines&lt;/strong&gt; at Hostaway&amp;rsquo;s HQ&lt;/p&gt;&lt;script&gt;evil()&lt;/script&gt;',
        },
        { title: 'Without body', careers_url: 'https://acme.recruitee.com/o/no-body' },
        { title: 'Empty body', careers_url: 'https://acme.recruitee.com/o/empty-body', description: '   ' },
      ],
    },
    'Acme',
  );
  if (descOffers[0]?.description === "Build pipelines at Hostaway\u2019s HQ") {
    pass('parseRecruiteeResponse double-decodes the offer body to plain text (tags + script gone)');
  } else {
    fail(`row 0 description = ${JSON.stringify(descOffers[0]?.description)}`);
  }
  if (!('description' in descOffers[1]) && !('description' in descOffers[2])) {
    pass('parseRecruiteeResponse omits the description key when the offer has no usable body');
  } else {
    fail(`rows 1-2 = ${JSON.stringify(descOffers.slice(1))}`);
  }

  // The list payload splits the body in two: `description` holds the
  // introduction and `requirements` the tasks and candidate profile. Both reach
  // the description, introduction first, so content_filter / visa_filter see
  // the whole posting; either one alone is enough.
  const bodyOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Both fields',
          careers_url: 'https://x.recruitee.com/o/both',
          description: '<p>Acme builds checkout software.</p>',
          requirements: '<ul><li>Playwright and TypeScript</li><li>German is not required</li></ul>',
        },
        { title: 'Requirements only', careers_url: 'https://x.recruitee.com/o/req-only', description: '', requirements: '<p>API testing</p>' },
        { title: 'Null requirements', careers_url: 'https://x.recruitee.com/o/null-req', description: '<p>Intro only</p>', requirements: null },
      ],
    },
    'X',
  );
  if (bodyOffers[0]?.description === 'Acme builds checkout software. Playwright and TypeScript German is not required') {
    pass('parseRecruiteeResponse joins description and requirements, introduction first');
  } else {
    fail(`both-fields description = ${JSON.stringify(bodyOffers[0]?.description)}`);
  }
  if (bodyOffers[1]?.description === 'API testing' && bodyOffers[2]?.description === 'Intro only') {
    pass('parseRecruiteeResponse keeps a body carried by only one of description / requirements');
  } else {
    fail(`single-field descriptions = ${JSON.stringify(bodyOffers.slice(1).map(o => o.description))}`);
  }

  // ── postedAt from published_at ──
  // Recruitee writes `YYYY-MM-DD HH:MM:SS UTC`; anything else is omitted
  // rather than guessed.
  const dateOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Published', careers_url: 'https://x.recruitee.com/o/published', published_at: '2026-10-13 06:29:35 UTC' },
        { title: 'Null date', careers_url: 'https://x.recruitee.com/o/null-date', published_at: null },
        { title: 'Garbage date', careers_url: 'https://x.recruitee.com/o/garbage-date', published_at: 'yesterday' },
        { title: 'Impossible date', careers_url: 'https://x.recruitee.com/o/impossible-date', published_at: '2026-13-45 06:29:35 UTC' },
        { title: 'February 30', careers_url: 'https://x.recruitee.com/o/february-30', published_at: '2026-02-30 06:29:35 UTC' },
        { title: 'Hour 24', careers_url: 'https://x.recruitee.com/o/hour-24', published_at: '2026-10-13 24:00:00 UTC' },
      ],
    },
    'X',
  );
  if (dateOffers[0]?.postedAt === Date.UTC(2026, 9, 13, 6, 29, 35)) {
    pass('parseRecruiteeResponse reads published_at ("YYYY-MM-DD HH:MM:SS UTC") into postedAt epoch ms');
  } else {
    fail(`published postedAt = ${JSON.stringify(dateOffers[0]?.postedAt)}`);
  }
  if (dateOffers.slice(1).every(o => !('postedAt' in o))) {
    pass('parseRecruiteeResponse omits postedAt for a null, malformed or impossible published_at, including a day or hour that Date.UTC would roll over (Feb 30, 24:00)');
  } else {
    fail(`bad-date rows = ${JSON.stringify(dateOffers.slice(1))}`);
  }

  // ── salary annualized by period ──
  // Shapes observed on live tenants: string bounds, year / month / hour
  // periods, a one-sided range, and a period-less object.
  const salaryOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Yearly', careers_url: 'https://x.recruitee.com/o/yearly', salary: { min: '60000', max: '70000', period: 'year', currency: 'EUR' } },
        { title: 'Monthly', careers_url: 'https://x.recruitee.com/o/monthly', salary: { min: '5000', max: '6000', period: 'month', currency: 'eur' } },
        { title: 'Hourly max only', careers_url: 'https://x.recruitee.com/o/hourly', salary: { min: null, max: '15', period: 'hour', currency: 'EUR' } },
        { title: 'Min only', careers_url: 'https://x.recruitee.com/o/min-only', salary: { min: '80000', max: null, period: 'year', currency: 'EUR' } },
        { title: 'No period', careers_url: 'https://x.recruitee.com/o/no-period', salary: { min: '60000', max: '70000', period: null, currency: 'EUR' } },
        { title: 'Unknown period', careers_url: 'https://x.recruitee.com/o/unknown-period', salary: { min: '500', max: '600', period: 'fortnight', currency: 'EUR' } },
        { title: 'Empty salary', careers_url: 'https://x.recruitee.com/o/empty', salary: { min: null, max: null, period: null, currency: null } },
        { title: 'Non-numeric', careers_url: 'https://x.recruitee.com/o/non-numeric', salary: { min: 'competitive', max: '', period: 'year', currency: 'EUR' } },
      ],
    },
    'X',
  );
  const salaryOf = (i) => JSON.stringify(salaryOffers[i]?.salary);
  if (salaryOf(0) === JSON.stringify({ min: 60000, max: 70000, currency: 'EUR' })) {
    pass('parseRecruiteeResponse keeps a yearly salary as is, string bounds read as numbers');
  } else {
    fail(`yearly salary = ${salaryOf(0)}`);
  }
  if (salaryOf(1) === JSON.stringify({ min: 60000, max: 72000, currency: 'EUR' })) {
    pass('parseRecruiteeResponse annualizes a monthly salary (×12) and upper-cases the currency');
  } else {
    fail(`monthly salary = ${salaryOf(1)}`);
  }
  if (salaryOf(2) === JSON.stringify({ min: 31200, max: 31200, currency: 'EUR' })
    && salaryOf(3) === JSON.stringify({ min: 80000, max: 80000, currency: 'EUR' })) {
    pass('parseRecruiteeResponse annualizes an hourly salary (×2080) and fills a one-sided range from the other bound');
  } else {
    fail(`one-sided salaries = ${salaryOf(2)}, ${salaryOf(3)}`);
  }
  if (salaryOffers.slice(4).every(o => !('salary' in o))) {
    pass('parseRecruiteeResponse omits salary with no period, an unknown period, or no numeric bound');
  } else {
    fail(`unusable salary rows = ${JSON.stringify(salaryOffers.slice(4).map(o => o.salary))}`);
  }

  // ── Language versions ──
  // `translations` carries every language version of an offer. The default
  // one is the translation whose Job text equals the top-level one, whatever
  // its key order; it always comes first, and the others only with allLanguages.
  const bilingual = {
    title: 'Senior QA Engineer (m/w/d)',
    careers_url: 'https://acme.recruitee.com/o/senior-qa',
    description: '<p>Acme baut Software.</p>',
    requirements: '<p>Playwright</p>',
    location: 'Berlin, Germany',
    published_at: '2026-10-13 06:29:35 UTC',
    salary: { min: '60000', max: '70000', period: 'year', currency: 'EUR' },
    translations: {
      en: { title: 'Senior QA Engineer (m/f/d)', description: '<p>Acme builds software.</p>', requirements: '<p>Playwright. German is not required.</p>' },
      de: { title: 'Senior QA Engineer (m/w/d)', description: '<p>Acme baut Software.</p>', requirements: '<p>Playwright</p>' },
    },
  };
  const oneVersion = parseRecruiteeResponse({ offers: [bilingual] }, 'Acme');
  if (oneVersion.length === 1 && oneVersion[0].language === 'de'
    && oneVersion[0].url === 'https://acme.recruitee.com/o/senior-qa?lang=de'
    && oneVersion[0].title === 'Senior QA Engineer (m/w/d)') {
    pass('parseRecruiteeResponse returns only the default version by default, tagged with its language in `language` and `?lang=`');
  } else {
    fail(`default-only versions = ${JSON.stringify(oneVersion)}`);
  }

  const allVersions = parseRecruiteeResponse({ offers: [bilingual] }, 'Acme', { allLanguages: true });
  const [deVersion, enVersion] = allVersions;
  if (allVersions.length === 2 && deVersion?.language === 'de' && enVersion?.language === 'en') {
    pass('parseRecruiteeResponse with allLanguages returns the default version first, though its key comes second in translations');
  } else {
    fail(`all-language order = ${JSON.stringify(allVersions.map(v => v.language))}`);
  }
  if (enVersion?.title === 'Senior QA Engineer (m/f/d)'
    && enVersion?.description === 'Acme builds software. Playwright. German is not required.'
    && enVersion?.url === 'https://acme.recruitee.com/o/senior-qa?lang=en') {
    pass('parseRecruiteeResponse builds a further version from its own translation: title, description + requirements, ?lang= URL');
  } else {
    fail(`en version = ${JSON.stringify(enVersion)}`);
  }
  if (enVersion?.location === deVersion?.location && enVersion?.postedAt === deVersion?.postedAt
    && JSON.stringify(enVersion?.salary) === JSON.stringify(deVersion?.salary) && enVersion?.company === 'Acme') {
    pass('parseRecruiteeResponse gives every language version the offer\'s location, date, salary and company');
  } else {
    fail(`shared fields differ: de=${JSON.stringify(deVersion)} en=${JSON.stringify(enVersion)}`);
  }

  // A translation identical to the default one is a copy under another label;
  // an untitled or badly keyed translation is unusable. None of them is a version.
  const unusableTranslations = parseRecruiteeResponse({
    offers: [{
      title: 'Founder Associate (m/w/d)',
      careers_url: 'https://acme.recruitee.com/o/founder-associate',
      description: '<p>Same text</p>',
      requirements: '<p>Same list</p>',
      translations: {
        de: { title: 'Founder Associate (m/w/d)', description: '<p>Same text</p>', requirements: '<p>Same list</p>' },
        en: { title: 'Founder Associate (m/w/d)', description: '<p>Same text</p>', requirements: '<p>Same list</p>' },
        fr: { title: '  ', description: '<p>Texte</p>', requirements: '<p>Liste</p>' },
        'en US/../x': { title: 'Bad key', description: '<p>x</p>', requirements: '<p>y</p>' },
      },
    }],
  }, 'Acme', { allLanguages: true });
  if (unusableTranslations.length === 1 && unusableTranslations[0].language === 'de') {
    pass('parseRecruiteeResponse skips a byte-identical copy, an untitled translation and a malformed language key');
  } else {
    fail(`unusable translations = ${JSON.stringify(unusableTranslations.map(v => [v.language, v.title]))}`);
  }

  // A copy is judged by the Job it would produce, not by the raw payload: a
  // translation that differs from the default one only in markup and
  // whitespace yields the same title and description, so it is skipped too.
  const markupCopy = parseRecruiteeResponse({
    offers: [{
      title: 'Founder Associate (m/w/d)',
      careers_url: 'https://acme.recruitee.com/o/founder-associate',
      description: '<p>Same text</p>',
      requirements: '<p>Same list</p>',
      translations: {
        de: { title: 'Founder Associate (m/w/d)', description: '<p>Same text</p>', requirements: '<p>Same list</p>' },
        en: { title: ' Founder Associate (m/w/d) ', description: '<div>Same   text</div>', requirements: '<ul><li>Same list</li></ul>' },
      },
    }],
  }, 'Acme', { allLanguages: true });
  if (markupCopy.length === 1 && markupCopy[0].language === 'de') {
    pass('parseRecruiteeResponse skips a translation that differs from the default one only in markup and whitespace');
  } else {
    fail(`markup copy = ${JSON.stringify(markupCopy.map(v => [v.language, v.title, v.description]))}`);
  }

  // The default version is matched by the whole Job text, requirements
  // included: a translation with the top-level title and description but other
  // requirements is a further version, even when its key comes first. A
  // missing field and an empty one produce the same text.
  const requirementsDiffer = parseRecruiteeResponse({
    offers: [{
      title: 'Data Engineer (m/w/d)',
      careers_url: 'https://acme.recruitee.com/o/data',
      description: '<p>Acme</p>',
      requirements: null,
      translations: {
        en: { title: 'Data Engineer (m/w/d)', description: '<p>Acme</p>', requirements: '<p>English is enough.</p>' },
        de: { title: 'Data Engineer (m/w/d)', description: '<p>Acme</p>', requirements: '' },
      },
    }],
  }, 'Acme', { allLanguages: true });
  if (JSON.stringify(requirementsDiffer.map(v => [v.language, v.description])) === JSON.stringify([['de', 'Acme'], ['en', 'Acme English is enough.']])) {
    pass('parseRecruiteeResponse matches the default version by title, description and requirements together');
  } else {
    fail(`requirements differ = ${JSON.stringify(requirementsDiffer.map(v => [v.language, v.description]))}`);
  }

  // No translation equal to the top-level fields → the default language is
  // unknown. Without allLanguages: one Job, top-level fields, no `language`,
  // URL unchanged. With it: every translation, tagged, in the API's order, and
  // no untagged top-level Job next to them.
  const unknownDefaultOffer = {
    title: 'Backend Engineer (m/w/d)',
    careers_url: 'https://acme.recruitee.com/o/backend',
    description: '<p>Top level</p>',
    translations: {
      de: { title: 'Backend Engineer (m/w/d)', description: '<p>Top level, edited</p>' },
      en: { title: 'Backend Engineer (m/f/d)', description: '<p>English</p>' },
    },
  };
  const unknownDefault = parseRecruiteeResponse({ offers: [unknownDefaultOffer] }, 'Acme');
  if (unknownDefault.length === 1 && !('language' in unknownDefault[0])
    && unknownDefault[0].url === 'https://acme.recruitee.com/o/backend' && unknownDefault[0].description === 'Top level') {
    pass('parseRecruiteeResponse returns one top-level Job with no language when no translation matches the top-level fields');
  } else {
    fail(`unknown default = ${JSON.stringify(unknownDefault)}`);
  }
  const unknownDefaultAll = parseRecruiteeResponse({ offers: [unknownDefaultOffer] }, 'Acme', { allLanguages: true });
  if (JSON.stringify(unknownDefaultAll.map(v => [v.language, v.url, v.description])) === JSON.stringify([
    ['de', 'https://acme.recruitee.com/o/backend?lang=de', 'Top level, edited'],
    ['en', 'https://acme.recruitee.com/o/backend?lang=en', 'English'],
  ])) {
    pass('parseRecruiteeResponse with allLanguages returns every translation, tagged, when none matches the top-level fields');
  } else {
    fail(`unknown default, all languages = ${JSON.stringify(unknownDefaultAll.map(v => [v.language, v.url, v.description]))}`);
  }

  // fetch() reads the language switch from ctx.dedupIncludeLanguage.
  const stubCtx = (extra) => ({ ...extra, fetchJson: async () => ({ offers: [bilingual] }) });
  const fetchedDefault = await recruitee.fetch({ name: 'Acme', careers_url: 'https://acme.recruitee.com' }, stubCtx({}));
  const fetchedAll = await recruitee.fetch({ name: 'Acme', careers_url: 'https://acme.recruitee.com' }, stubCtx({ dedupIncludeLanguage: true }));
  if (fetchedDefault.length === 1 && fetchedAll.length === 2) {
    pass('recruitee.fetch() returns further language versions only when ctx.dedupIncludeLanguage is true');
  } else {
    fail(`fetch language switch: default=${fetchedDefault.length}, all=${fetchedAll.length}`);
  }

  // portals.yml preferred_languages reaches the provider as
  // ctx.preferredLanguageRank. Without the switch, the preferred translations
  // come back next to the default version, and no other language does.
  const trilingual = {
    ...bilingual,
    translations: {
      ...bilingual.translations,
      fr: { title: 'Ingénieur QA senior (h/f)', description: '<p>Acme crée des logiciels.</p>', requirements: '<p>Playwright</p>' },
    },
  };
  const rankOf = (...languages) => (language) => languages.indexOf(language);
  const preferredOnly = parseRecruiteeResponse({ offers: [trilingual] }, 'Acme', { preferredLanguageRank: rankOf('fr') });
  if (JSON.stringify(preferredOnly.map(v => v.language)) === JSON.stringify(['de', 'fr'])) {
    pass('parseRecruiteeResponse with preferred languages returns the default version and the preferred one only');
  } else {
    fail(`preferred-only versions = ${JSON.stringify(preferredOnly.map(v => v.language))}`);
  }
  const noPreferredTranslation = parseRecruiteeResponse({ offers: [bilingual] }, 'Acme', { preferredLanguageRank: rankOf('fr') });
  if (JSON.stringify(noPreferredTranslation.map(v => v.language)) === JSON.stringify(['de'])) {
    pass('parseRecruiteeResponse with preferred languages returns the default version alone when no translation is preferred');
  } else {
    fail(`no preferred translation = ${JSON.stringify(noPreferredTranslation.map(v => v.language))}`);
  }
  const fetchedPreferred = await recruitee.fetch({ name: 'Acme', careers_url: 'https://acme.recruitee.com' },
    { fetchJson: async () => ({ offers: [trilingual] }), preferredLanguageRank: rankOf('en') });
  if (JSON.stringify(fetchedPreferred.map(v => v.language)) === JSON.stringify(['de', 'en'])) {
    pass('recruitee.fetch() reads the preferred languages from ctx.preferredLanguageRank');
  } else {
    fail(`fetch preferred languages = ${JSON.stringify(fetchedPreferred.map(v => v.language))}`);
  }

  // No translation matches the top-level fields: without the switch the offer
  // still comes back once — the translation in the best-ranked preferred
  // language the offer has, else the top-level fields with no language.
  const unknownDefaultTrilingual = {
    ...unknownDefaultOffer,
    translations: {
      ...unknownDefaultOffer.translations,
      fr: { title: 'Ingénieur backend (h/f)', description: '<p>Français</p>' },
    },
  };
  const unknownDefaultCases = [
    ['de, en preferred → de', rankOf('de', 'en'), ['de|?lang=de']],
    ['en, de preferred → en', rankOf('en', 'de'), ['en|?lang=en']],
    ['es, fr, en preferred → fr, the best-ranked the offer has', rankOf('es', 'fr', 'en'), ['fr|?lang=fr']],
    ['only languages the offer lacks → top-level fields, no language', rankOf('es'), ['undefined|']],
  ];
  for (const [label, rank, expected] of unknownDefaultCases) {
    const actual = parseRecruiteeResponse({ offers: [unknownDefaultTrilingual] }, 'Acme', { preferredLanguageRank: rank })
      .map(v => `${v.language}|${v.url.replace('https://acme.recruitee.com/o/backend', '')}`);
    if (JSON.stringify(actual) === JSON.stringify(expected)) pass(`parseRecruiteeResponse, no default version: ${label}`);
    else fail(`no default version, ${label} — got ${JSON.stringify(actual)}`);
  }

  // A ?lang= on one entry's careers_url (Recruitee's own param) asks for that
  // language for that entry: it replaces the default version wherever the offer
  // has it, and wins over the preferred languages. With dedupIncludeLanguage
  // every version comes back regardless.
  const fetchLanguages = async (offer, careersUrl, extra = {}) => (await recruitee.fetch(
    { name: 'Acme', careers_url: careersUrl },
    { fetchJson: async () => ({ offers: [offer] }), ...extra },
  )).map(v => `${v.language}|${v.url.replace(/^https:\/\/acme\.recruitee\.com\/o\/[a-z-]+/, '')}`);
  const entryCases = [
    ['?lang=en on careers_url → the English version alone', await fetchLanguages(trilingual, 'https://acme.recruitee.com/?lang=en'), ['en|?lang=en']],
    ['?lang= the offer lacks → the default version', await fetchLanguages(trilingual, 'https://acme.recruitee.com/?lang=es'), ['de|?lang=de']],
    ['?lang= wins over the preferred languages', await fetchLanguages(trilingual, 'https://acme.recruitee.com/?lang=EN', { preferredLanguageRank: rankOf('fr') }), ['en|?lang=en']],
    ['a malformed ?lang= is ignored', await fetchLanguages(trilingual, 'https://acme.recruitee.com/?lang=en%20US'), ['de|?lang=de']],
    ['with dedupIncludeLanguage every version comes back', await fetchLanguages(trilingual, 'https://acme.recruitee.com/?lang=en', { dedupIncludeLanguage: true }), ['de|?lang=de', 'en|?lang=en', 'fr|?lang=fr']],
    ['no default version, ?lang=en → the English translation', await fetchLanguages(unknownDefaultTrilingual, 'https://acme.recruitee.com/?lang=en'), ['en|?lang=en']],
    ['no default version, ?lang= the offer lacks → top-level fields, no language', await fetchLanguages(unknownDefaultTrilingual, 'https://acme.recruitee.com/?lang=es', { preferredLanguageRank: rankOf('fr') }), ['undefined|']],
  ];
  for (const [label, actual, expected] of entryCases) {
    if (JSON.stringify(actual) === JSON.stringify(expected)) pass(`recruitee.fetch(): ${label}`);
    else fail(`recruitee.fetch(): ${label} — got ${JSON.stringify(actual)}`);
  }

  // ── Demo-tenant filtering ──────────────────────────────────────────────────
  // Recruitee itself stamps "(Sample)" on its own seeded posting — captured
  // live, byte-identical, from two unrelated tenants (adecco, accenture).
  const demoOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Senior Marketer (Sample)', careers_url: 'https://exampleco.recruitee.com/o/sample' },
        { title: 'senior marketer (sample)', careers_url: 'https://exampleco.recruitee.com/o/lowercase' },
        { title: 'Real Backend Engineer', careers_url: 'https://exampleco.recruitee.com/o/real' },
      ],
    },
    'ExampleCo',
  );
  if (demoOffers.length === 1 && demoOffers[0].title === 'Real Backend Engineer') {
    pass('parseRecruiteeResponse drops any posting whose title carries the "(Sample)" marker, case-insensitively');
  } else {
    fail(`parseRecruiteeResponse demo-filter kept ${demoOffers.length} offers: ${JSON.stringify(demoOffers.map(o => o.title))}`);
  }

  // Negative control: a real title merely containing the word "sample"
  // without parentheses (e.g. a QA/sample-testing role) must survive — the
  // marker is specifically the parenthesized "(Sample)" tag, not the word.
  const realSampleWord = parseRecruiteeResponse(
    { offers: [{ title: 'Sample Preparation Technician', careers_url: 'https://acme.recruitee.com/o/1' }] },
    'Acme',
  );
  if (realSampleWord.length === 1) {
    pass('parseRecruiteeResponse keeps a real title containing "sample" without the "(Sample)" tag');
  } else {
    fail('parseRecruiteeResponse should only match the parenthesized "(Sample)" marker, not the bare word');
  }

  // A tenant whose ONLY posting is the seeded sample must resolve as empty —
  // this is what makes discover-ats.mjs's existing "empty board" handling
  // apply automatically, with no changes needed there.
  const onlySample = parseRecruiteeResponse(
    { offers: [{ title: 'Senior Marketer (Sample)', careers_url: 'https://deadtenant.recruitee.com/o/sample' }] },
    'Dead Tenant',
  );
  if (onlySample.length === 0) {
    pass('a tenant serving only the seeded sample posting parses to zero jobs (resolves as empty upstream)');
  } else {
    fail('a sample-only tenant should parse to zero jobs');
  }

  // ── Multi-location (`locations[]` beats the flat `location` field) ──
  // The flat `location` field carries only the PRIMARY place even when the
  // offer is open in more than one (Zürich hybrid + remote-in-Germany is a
  // shape observed live on a real Recruitee tenant, reproduced here with a
  // fictional company).
  const multiLocOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Quality Assurance Engineer',
          careers_url: 'https://acmecorp.recruitee.com/o/quality-assurance-engineer-1',
          location: 'Zürich, Zürich, Switzerland',
          locations: [
            { name: 'Zürich, Switzerland', city: 'Zürich', country: 'Switzerland' },
            { name: 'remote in Germany', city: 'remote', country: 'Germany' },
          ],
        },
        {
          // Single-entry `locations[]` must not override a more useful flat field.
          title: 'Single location array',
          careers_url: 'https://acmecorp.recruitee.com/o/single-location',
          location: 'Remote, EMEA',
          locations: [{ name: 'Remote, EMEA' }],
        },
        {
          // No usable `.name` values → falls back to the flat field.
          title: 'Unusable locations array',
          careers_url: 'https://acmecorp.recruitee.com/o/unusable-locations',
          location: 'Berlin, Germany',
          locations: [{ city: 'Berlin' }, { name: 42 }],
        },
      ],
    },
    'Acme Corp',
  );
  if (multiLocOffers[0]?.location === 'Zürich, Switzerland · remote in Germany') {
    pass('parseRecruiteeResponse joins locations[] with " · " when it lists 2+ places');
  } else {
    fail(`row 0 location = ${JSON.stringify(multiLocOffers[0]?.location)}`);
  }
  if (multiLocOffers[1]?.location === 'Remote, EMEA') {
    pass('parseRecruiteeResponse keeps the flat location field when locations[] has only 1 place');
  } else {
    fail(`row 1 location = ${JSON.stringify(multiLocOffers[1]?.location)}`);
  }
  if (multiLocOffers[2]?.location === 'Berlin, Germany') {
    pass('parseRecruiteeResponse falls back to the flat field when locations[] has no usable names');
  } else {
    fail(`row 2 location = ${JSON.stringify(multiLocOffers[2]?.location)}`);
  }

  // Dedup: a tenant repeating the same place twice in locations[] must not
  // surface it twice in the joined string.
  const dedupOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Duplicate places',
          careers_url: 'https://x.recruitee.com/o/duplicate-places',
          locations: [{ name: 'Berlin, Germany' }, { name: 'Berlin, Germany' }, { name: 'Remote' }],
        },
      ],
    },
    'X',
  );
  if (dedupOffers[0]?.location === 'Berlin, Germany · Remote') {
    pass('parseRecruiteeResponse dedupes repeated locations[] names');
  } else {
    fail(`dedup row location = ${JSON.stringify(dedupOffers[0]?.location)}`);
  }

  // ── Defensive parsing: title is a required field (ADDING_A_PROVIDER.md) ──
  // A row missing/blank `title` is dropped, never emitted half-formed with
  // `title: ''` — same convention as ibm.mjs / eightfold.mjs. Every row here
  // carries a valid `careers_url` so only the title check is under test (a
  // missing/invalid URL is covered separately by the "URL validation" case
  // above, which drops the whole offer).
  const titleDropOffers = parseRecruiteeResponse(
    {
      offers: [
        { title: 'Real Offer', careers_url: 'https://acme.recruitee.com/o/real' },
        { careers_url: 'https://acme.recruitee.com/o/no-title' },
        { title: '', careers_url: 'https://acme.recruitee.com/o/blank-title' },
        { title: '   ', careers_url: 'https://acme.recruitee.com/o/whitespace-title' },
        { title: 42, careers_url: 'https://acme.recruitee.com/o/non-string-title' },
      ],
    },
    'Acme',
  );
  if (titleDropOffers.length === 1 && titleDropOffers[0]?.title === 'Real Offer') {
    pass('parseRecruiteeResponse drops offers with no usable title (missing, blank, whitespace-only, non-string)');
  } else {
    fail(`title-drop: got ${titleDropOffers.length} offer(s) = ${JSON.stringify(titleDropOffers)}`);
  }

  // ── Malformed offer entries (null / primitive) don't crash the whole batch ──
  // A single bad entry in offers[] must not throw out of fetch() and lose
  // every other offer in the response.
  const malformedEntryOffers = parseRecruiteeResponse(
    {
      offers: [
        null,
        { title: 'Valid Before', careers_url: 'https://x.recruitee.com/o/valid-before' },
        undefined,
        'not an object',
        42,
        { title: 'Valid After', careers_url: 'https://x.recruitee.com/o/valid-after' },
      ],
    },
    'X',
  );
  if (
    malformedEntryOffers.length === 2 &&
    malformedEntryOffers[0]?.title === 'Valid Before' &&
    malformedEntryOffers[1]?.title === 'Valid After'
  ) {
    pass('parseRecruiteeResponse skips null/undefined/primitive offer entries without crashing');
  } else {
    fail(`malformed-entry: got ${malformedEntryOffers.length} offer(s) = ${JSON.stringify(malformedEntryOffers)}`);
  }

  // ── locations[] with only duplicate names falls back to the flat field ──
  // Distinct-count, not raw-count: 2 entries naming the SAME place must not
  // "join" down to that one place when the flat `location` field is richer.
  const dupNameFallback = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Duplicate name, richer flat field',
          careers_url: 'https://x.recruitee.com/o/dup-name-fallback',
          location: 'Berlin, Germany (HQ office)',
          locations: [{ name: 'Berlin, Germany' }, { name: 'Berlin, Germany' }],
        },
      ],
    },
    'X',
  );
  if (dupNameFallback[0]?.location === 'Berlin, Germany (HQ office)') {
    pass('parseRecruiteeResponse falls back to the flat field when locations[] names are all the same place');
  } else {
    fail(`dup-name-fallback location = ${JSON.stringify(dupNameFallback[0]?.location)}`);
  }

  // ── Country is appended to a bare location name, without duplicating it ──
  const countryOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          // Bare city names with no country baked in — country appended.
          title: 'Bare city names',
          careers_url: 'https://x.recruitee.com/o/bare-city-names',
          locations: [
            { name: 'Berlin', country: 'Germany' },
            { name: 'Paris', country: 'France' },
          ],
        },
        {
          // Name already contains the country (case-insensitive) — not duplicated.
          title: 'Country already in name',
          careers_url: 'https://x.recruitee.com/o/country-already-in-name',
          locations: [
            { name: 'Zürich, Switzerland', country: 'Switzerland' },
            { name: 'remote in Germany', country: 'Germany' },
          ],
        },
      ],
    },
    'X',
  );
  if (countryOffers[0]?.location === 'Berlin, Germany · Paris, France') {
    pass('parseRecruiteeResponse appends country to a bare location name');
  } else {
    fail(`bare-city location = ${JSON.stringify(countryOffers[0]?.location)}`);
  }
  if (countryOffers[1]?.location === 'Zürich, Switzerland · remote in Germany') {
    pass('parseRecruiteeResponse does not duplicate a country already present in the location name');
  } else {
    fail(`no-duplicate-country location = ${JSON.stringify(countryOffers[1]?.location)}`);
  }

  // ── Top-level `remote` flag is honored in the joined multi-place path ──
  // `remote` is a separate signal from the named places: a fully-remote role
  // across 2+ named countries, none of which literally say "remote", must
  // still surface as remote. Never duplicated when a place name already says so.
  const remoteFlagOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          // remote: true, no place name says "remote" → appended once.
          title: 'Fully remote across countries',
          careers_url: 'https://x.recruitee.com/o/fully-remote',
          remote: true,
          locations: [{ name: 'Berlin, Germany' }, { name: 'Paris, France' }],
        },
        {
          // remote: true, but a place name already says "remote" → not duplicated.
          title: 'Remote already named',
          careers_url: 'https://x.recruitee.com/o/remote-already-named',
          remote: true,
          locations: [{ name: 'Zürich, Switzerland' }, { name: 'remote in Germany' }],
        },
        {
          // remote: false → never appended, even with 2+ distinct places.
          title: 'Not remote',
          careers_url: 'https://x.recruitee.com/o/not-remote',
          remote: false,
          locations: [{ name: 'Berlin, Germany' }, { name: 'Paris, France' }],
        },
      ],
    },
    'X',
  );
  if (remoteFlagOffers[0]?.location === 'Berlin, Germany · Paris, France · Remote') {
    pass('parseRecruiteeResponse appends "Remote" to the joined location when remote:true and no place name says so');
  } else {
    fail(`remote-flag-append location = ${JSON.stringify(remoteFlagOffers[0]?.location)}`);
  }
  if (remoteFlagOffers[1]?.location === 'Zürich, Switzerland · remote in Germany') {
    pass('parseRecruiteeResponse does not duplicate "Remote" when a joined place name already says so');
  } else {
    fail(`remote-flag-no-dup location = ${JSON.stringify(remoteFlagOffers[1]?.location)}`);
  }
  if (remoteFlagOffers[2]?.location === 'Berlin, Germany · Paris, France') {
    pass('parseRecruiteeResponse never appends "Remote" when remote:false');
  } else {
    fail(`remote-flag-false location = ${JSON.stringify(remoteFlagOffers[2]?.location)}`);
  }

  // ── City is appended to a non-geographic location name, without duplicating it ──
  // Uses internal/non-place labels (not city or country names themselves) so
  // the city-append logic is exercised independently of the name text.
  const cityOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          // Name is an internal label with no city/country baked in — both appended.
          title: 'Internal building label',
          careers_url: 'https://x.recruitee.com/o/internal-building-label',
          locations: [
            { name: 'Building A', city: 'Berlin', country: 'Germany' },
            { name: 'Building B', city: 'Paris', country: 'France' },
          ],
        },
        {
          // City already present in the name (case-insensitive) — not duplicated;
          // country still gets appended independently.
          title: 'City already in name',
          careers_url: 'https://x.recruitee.com/o/city-already-in-name',
          locations: [
            { name: 'Berlin Office', city: 'Berlin', country: 'Germany' },
            { name: 'Paris HQ', city: 'Paris', country: 'France' },
          ],
        },
      ],
    },
    'X',
  );
  if (cityOffers[0]?.location === 'Building A, Berlin, Germany · Building B, Paris, France') {
    pass('parseRecruiteeResponse appends city (and country) to a non-geographic location name');
  } else {
    fail(`city-append location = ${JSON.stringify(cityOffers[0]?.location)}`);
  }
  if (cityOffers[1]?.location === 'Berlin Office, Germany · Paris HQ, France') {
    pass('parseRecruiteeResponse does not duplicate a city already present in the location name, but still appends country');
  } else {
    fail(`city-no-dup location = ${JSON.stringify(cityOffers[1]?.location)}`);
  }

  // ── Whole-word matching, not substring: "Parisian" must not shadow "Paris" ──
  // A substring check would wrongly see "paris" inside "parisian" and skip
  // appending the real city. The second offer covers the Unicode-accented edge
  // this fix exists for: "Örebro" sits at the very start of the name, exactly
  // where JS's ASCII-only \b misfires (no boundary between start-of-string and
  // a non-ASCII letter) — so the city must be recognized as already present and
  // NOT duplicated, proving the Unicode-aware lookaround actually works there.
  const nearMissOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          title: 'Near-miss substring, not a real mention',
          careers_url: 'https://x.recruitee.com/o/near-miss',
          locations: [
            { name: 'Parisian HQ', city: 'Paris', country: 'France' },
            { name: 'Örebro Office', city: 'Örebro', country: 'Sweden' },
          ],
        },
      ],
    },
    'X',
  );
  if (nearMissOffers[0]?.location === 'Parisian HQ, Paris, France · Örebro Office, Sweden') {
    pass('parseRecruiteeResponse appends a near-miss city ("Paris" in "Parisian HQ") and does not duplicate an accented city already at the start of the name ("Örebro" in "Örebro Office")');
  } else {
    fail(`near-miss location = ${JSON.stringify(nearMissOffers[0]?.location)}`);
  }

  // ── URL fallback: careers_url and url are validated independently ──
  // One bad field must not shadow an otherwise-usable other one — only when
  // NEITHER candidate resolves is the offer dropped.
  const urlFallbackOffers = parseRecruiteeResponse(
    {
      offers: [
        {
          // careers_url is non-https (invalid) but url is a valid https URL — kept via fallback.
          title: 'Invalid careers_url, valid url',
          careers_url: 'http://x.recruitee.com/o/insecure',
          url: 'https://x.recruitee.com/o/valid-fallback',
        },
        {
          // careers_url is malformed but url is valid — kept via fallback.
          title: 'Malformed careers_url, valid url',
          careers_url: 'not a url',
          url: 'https://x.recruitee.com/o/valid-fallback-2',
        },
        {
          // Both invalid — dropped.
          title: 'Both invalid',
          careers_url: 'http://x.recruitee.com/o/insecure-2',
          url: 'not a url either',
        },
      ],
    },
    'X',
  );
  if (urlFallbackOffers.length === 2 && urlFallbackOffers[0]?.url === 'https://x.recruitee.com/o/valid-fallback' && urlFallbackOffers[1]?.url === 'https://x.recruitee.com/o/valid-fallback-2') {
    pass('parseRecruiteeResponse falls back to url when careers_url is invalid, and drops the offer only when both are invalid');
  } else {
    fail(`url-fallback: got ${urlFallbackOffers.length} offer(s) = ${JSON.stringify(urlFallbackOffers)}`);
  }

} catch (e) {
  fail(`recruitee provider tests crashed: ${e.message}`);
}

