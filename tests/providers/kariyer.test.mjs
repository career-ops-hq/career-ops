// tests/providers/kariyer.test.mjs — mirrors the board-wide aggregator tests
// (yourator, gupy) for the kariyer.net candidate API gateway.
import { pass, fail, ROOT } from '../helpers.mjs';
import { boardTruncation } from '../../lib/board-truncation.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — kariyer');

const noSleep = async () => {};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/kariyer.mjs')).href);
  const kariyer = mod.default;
  const {
    resolveKariyerUrl, normalizeKariyerJob, kariyerPostedAt, parseKariyerDetail,
    kariyerWorkplaceType, kariyerPlaces,
  } = mod;

  if (kariyer.id === 'kariyer') pass('kariyer.id is "kariyer"');
  else fail(`kariyer.id is ${JSON.stringify(kariyer.id)}`);

  // --- detect() ------------------------------------------------------------

  const detected = [
    kariyer.detect({ careers_url: 'https://www.kariyer.net/is-ilanlari' }),
    kariyer.detect({ careers_url: 'https://www.kariyer.net/is-ilanlari?kw=python' }),
    kariyer.detect({ careers_url: 'https://www.kariyer.net/is-ilanlari/istanbul+avrupa-teknoloji+transferi+uzmani' }),
    kariyer.detect({ api: 'https://kariyer.net/is-ilanlari' }),
  ];
  if (detected.every((d) => d && d.url === 'https://www.kariyer.net/is-ilanlari')) {
    pass('detect() claims kariyer.net listing URLs (www and bare host)');
  } else {
    fail(`detect() positives = ${JSON.stringify(detected)}`);
  }

  // The same host serves employer profile pages: a single-company entry must
  // not be claimed by the country-wide board provider.
  const notDetected = [
    kariyer.detect({ careers_url: 'https://www.kariyer.net/firma-profil/acme-1-2' }),
    kariyer.detect({ careers_url: 'https://www.kariyer.net/is-ilani/acme-role-4596857' }),
    kariyer.detect({ careers_url: 'http://www.kariyer.net/is-ilanlari' }),
    kariyer.detect({ careers_url: 'https://www.kariyer.net.evil.example/is-ilanlari' }),
    kariyer.detect({ careers_url: 'https://evil.example/is-ilanlari' }),
    kariyer.detect({ careers_url: 'not a url' }),
    kariyer.detect({ careers_url: '' }),
    kariyer.detect({ careers_url: 42 }),
    kariyer.detect({}),
    kariyer.detect(null),
    kariyer.detect(undefined),
  ];
  if (notDetected.every((d) => d === null)) {
    pass('detect() returns null for employer profiles, job pages, non-HTTPS, look-alike hosts and junk');
  } else {
    fail(`detect() negatives = ${JSON.stringify(notDetected)}`);
  }

  // --- resolveKariyerUrl — Source Indexing Policy rule 2 -------------------

  const employer = resolveKariyerUrl({
    jobUrl: '/is-ilani/acme-role-1',
    redirectedInformation: { redirectedJobUrl: 'https://acme.basf.jobs/dark_blue/job/Pendik-ICT-1' },
  });
  if (employer === 'https://acme.basf.jobs/dark_blue/job/Pendik-ICT-1') {
    pass('resolveKariyerUrl prefers the employer application URL over the board page (rule 2)');
  } else {
    fail(`resolveKariyerUrl employer url = ${JSON.stringify(employer)}`);
  }

  const stripped = resolveKariyerUrl({
    jobUrl: '/is-ilani/acme-role-2',
    redirectedInformation: { redirectedJobUrl: 'https://jobs.smartrecruiters.com/Acme/2?utm_source=kariyer&UTM_Campaign=x&jobId=keep' },
  });
  if (stripped === 'https://jobs.smartrecruiters.com/Acme/2?jobId=keep') {
    pass('resolveKariyerUrl strips utm_* (case-insensitively) and keeps functional params');
  } else {
    fail(`resolveKariyerUrl stripped url = ${JSON.stringify(stripped)}`);
  }

  // The board's own click tracker is paid placement attribution, not the
  // employer's page (rule 3) — the board page is the fallback.
  const tracker = resolveKariyerUrl({
    jobUrl: '/is-ilani/acme-role-3',
    redirectedInformation: { redirectedJobUrl: 'https://stats.the-network.com/redirect/d975c639' },
  });
  if (tracker === 'https://www.kariyer.net/is-ilani/acme-role-3') {
    pass('resolveKariyerUrl falls back to the board page for the board\'s own click tracker');
  } else {
    fail(`resolveKariyerUrl tracker fallback = ${JSON.stringify(tracker)}`);
  }

  const fallbacks = [
    resolveKariyerUrl({ jobUrl: '/is-ilani/acme-role-4', redirectedInformation: { redirectedJobUrl: 'http://insecure.example/j' } }),
    resolveKariyerUrl({ jobUrl: '/is-ilani/acme-role-4', redirectedInformation: { redirectedJobUrl: 'not a url' } }),
    resolveKariyerUrl({ jobUrl: '/is-ilani/acme-role-4' }),
  ];
  if (fallbacks.every((u) => u === 'https://www.kariyer.net/is-ilani/acme-role-4')) {
    pass('resolveKariyerUrl falls back to the board page on non-HTTPS / malformed / absent upstream');
  } else {
    fail(`resolveKariyerUrl fallbacks = ${JSON.stringify(fallbacks)}`);
  }

  const escapes = [
    resolveKariyerUrl({ jobUrl: '//evil.example/jobs/1' }),
    resolveKariyerUrl({ jobUrl: '/\\evil.example/jobs/2' }),
    resolveKariyerUrl({ jobUrl: 'https://evil.example/jobs/3' }),
    resolveKariyerUrl({ jobUrl: 'is-ilani/acme-4' }),
    resolveKariyerUrl({}),
  ];
  if (escapes.every((u) => u === '')) {
    pass('resolveKariyerUrl rejects protocol-relative / backslash / absolute / non-rooted paths');
  } else {
    fail(`resolveKariyerUrl escapes = ${JSON.stringify(escapes)}`);
  }

  // --- kariyerPostedAt ----------------------------------------------------

  // The board's timestamps are Turkish local wall-clock (TRT, fixed UTC+3).
  if (new Date(kariyerPostedAt({ showTime: '2026-11-16T08:40' })).toISOString() === '2026-11-16T05:40:00.000Z') {
    pass('kariyerPostedAt reads showTime as UTC+3, not as UTC or host-local');
  } else {
    fail(`kariyerPostedAt showTime = ${new Date(kariyerPostedAt({ showTime: '2026-11-16T08:40' })).toISOString()}`);
  }

  if (new Date(kariyerPostedAt({ postingDate: '2026-11-12' })).toISOString() === '2026-11-11T21:00:00.000Z') {
    pass('kariyerPostedAt falls back to the date-only postingDate');
  } else {
    fail(`kariyerPostedAt postingDate = ${new Date(kariyerPostedAt({ postingDate: '2026-11-12' })).toISOString()}`);
  }

  const undated = [
    kariyerPostedAt({ showTime: 'not a date', postingDate: 'also not' }),
    kariyerPostedAt({}),
    kariyerPostedAt(null),
    kariyerPostedAt({ showTime: '' , postingDate: '' }),
  ];
  if (undated.every((v) => v === undefined)) pass('kariyerPostedAt is NaN-safe and omits an unusable date');
  else fail(`kariyerPostedAt undated = ${JSON.stringify(undated)}`);

  // --- normalizeKariyerJob -------------------------------------------------

  const full = normalizeKariyerJob(
    {
      id: 4596857,
      title: '  Yazılım Geliştirme Uzman Yardımcısı  ',
      companyName: '  SCO GRUP DANIŞMANLIK  ',
      jobUrl: '/is-ilani/sco-grup-yazilim-gelistirme-uzman-yardimcisi-4596857',
      locationText: '  İstanbul(Avr.)  ',
      allLocations: 'İstanbul(Avr.)',
      jobCode: ' RF-AF6464 ',
      showTime: '2026-11-12T17:14',
      postingDate: '2026-11-12',
      workModel: 'Hybrid',
      locations: [
        { countryId: '65', countryName: 'Türkiye', cityId: '34', cityName: 'İstanbul(Avr.)', jobTownLocationList: [{ townId: '453', townName: 'Şişli' }] },
        { countryId: '65', countryName: 'Türkiye', cityId: '82', cityName: 'İstanbul(Asya)', jobTownLocationList: [] },
      ],
      isSponsored: true,
    },
    'Fallback',
  );
  if (
    full
    && full.title === 'Yazılım Geliştirme Uzman Yardımcısı'
    && full.url === 'https://www.kariyer.net/is-ilani/sco-grup-yazilim-gelistirme-uzman-yardimcisi-4596857'
    && full.company === 'SCO GRUP DANIŞMANLIK'
    && full.location === 'İstanbul(Avr.)'
    && full.externalId === '4596857'
    && full.requisitionId === 'RF-AF6464'
    && full.workplaceType === 'hybrid'
    && JSON.stringify(full.locations) === JSON.stringify(['İstanbul(Avr.)', 'İstanbul(Asya)'])
    && new Date(full.postedAt).toISOString() === '2026-11-12T14:14:00.000Z'
  ) {
    pass('normalizeKariyerJob maps + trims title/company/location/id/jobCode and the TRT date');
  } else {
    fail(`normalizeKariyerJob full row = ${JSON.stringify(full)}`);
  }

  if (!('language' in full) && !('salary' in full) && !('description' in full)) {
    pass('normalizeKariyerJob omits language/salary/description the list payload does not carry');
  } else {
    fail(`normalizeKariyerJob invented fields = ${JSON.stringify(Object.keys(full))}`);
  }

  // The source resolves no tenant/board namespace, so no strong listing
  // identity is asserted (docs/listing-fingerprint.md: supply no triple when
  // the full identity cannot be resolved).
  if (!('listingIdentity' in full) && !('country' in full) && !('eligibilityText' in full) && !('visaText' in full)) {
    pass('normalizeKariyerJob asserts no listingIdentity and no country the payload cannot resolve');
  } else {
    fail(`normalizeKariyerJob asserted an unresolvable identity = ${JSON.stringify(Object.keys(full))}`);
  }

  // workModel is a dedicated field; only the three contract values pass, and an
  // unknown one is omitted rather than guessed.
  const workplaces = [
    kariyerWorkplaceType({ workModel: 'OnSite' }),
    kariyerWorkplaceType({ workModel: 'Remote' }),
    kariyerWorkplaceType({ workModel: ' hybrid ' }),
    kariyerWorkplaceType({ workModel: 'Field' }),
    kariyerWorkplaceType({ workModel: '' }),
    kariyerWorkplaceType({}),
    kariyerWorkplaceType(null),
  ];
  if (JSON.stringify(workplaces) === JSON.stringify(['onsite', 'remote', 'hybrid', undefined, undefined, undefined, undefined])) {
    pass('kariyerWorkplaceType maps the source\'s three values and omits anything else');
  } else {
    fail(`kariyerWorkplaceType = ${JSON.stringify(workplaces)}`);
  }
  if (!('workplaceType' in normalizeKariyerJob({ id: 4, title: 'T', jobUrl: '/is-ilani/t-4', workModel: 'Field' }))) {
    pass('normalizeKariyerJob omits workplaceType for an unmapped workModel');
  } else {
    fail('normalizeKariyerJob emitted an unmapped workplaceType');
  }

  // Places, before the board joins them into locationText.
  const places = [
    kariyerPlaces({ locations: [{ cityName: 'Ankara' }, { cityName: 'Ankara' }, { cityName: '' , countryName: 'Türkiye' }] }),
    kariyerPlaces({ locations: [] }),
    kariyerPlaces({ locations: 'nope' }),
    kariyerPlaces({}),
  ];
  if (
    JSON.stringify(places[0]) === JSON.stringify(['Ankara', 'Türkiye'])
    && places.slice(1).every((p) => Array.isArray(p) && p.length === 0)
  ) {
    pass('kariyerPlaces keeps the payload order, dedupes and falls back to countryName');
  } else {
    fail(`kariyerPlaces = ${JSON.stringify(places)}`);
  }
  if (!('locations' in normalizeKariyerJob({ id: 5, title: 'T', jobUrl: '/is-ilani/t-5' }))) {
    pass('normalizeKariyerJob omits locations when the payload lists none');
  } else {
    fail('normalizeKariyerJob emitted an empty locations array');
  }

  const locFallback = normalizeKariyerJob({ id: 1, title: 'T', jobUrl: '/is-ilani/t-1', allLocations: 'Ankara' });
  const coFallback = normalizeKariyerJob({ id: 2, title: 'T', jobUrl: '/is-ilani/t-2' }, 'Entry Name');
  const coDefault = normalizeKariyerJob({ id: 3, title: 'T', jobUrl: '/is-ilani/t-3' });
  if (
    locFallback?.location === 'Ankara'
    && coFallback?.company === 'Entry Name'
    && coDefault?.company === 'kariyer.net'
  ) {
    pass('normalizeKariyerJob falls back location → allLocations and company → entry name → "kariyer.net"');
  } else {
    fail(`normalizeKariyerJob fallbacks = ${JSON.stringify({ loc: locFallback?.location, co: coFallback?.company, def: coDefault?.company })}`);
  }

  const drops = [
    normalizeKariyerJob({ id: 1, title: '   ', jobUrl: '/is-ilani/t-1' }),
    normalizeKariyerJob({ id: 2, title: 'No usable url', jobUrl: '//evil.example/d2' }),
    normalizeKariyerJob({ id: 3, title: 'No url at all' }),
    normalizeKariyerJob(null),
    normalizeKariyerJob('nope'),
  ];
  if (drops.every((r) => r === null)) {
    pass('normalizeKariyerJob drops empty-title / unusable-url / non-object rows');
  } else {
    fail(`normalizeKariyerJob drops = ${JSON.stringify(drops)}`);
  }

  // --- parseKariyerDetail --------------------------------------------------

  const plainDetail = parseKariyerDetail({ data: { jobGeneralInformation: { qualifications: 'Plain JD text' } } });
  const htmlDetail = parseKariyerDetail({
    data: { jobGeneralInformation: { qualifications: '', qualificationsWithHtml: '<p>Genel <strong>Nitelikler</strong></p>' } },
  });
  const emptyDetail = [
    parseKariyerDetail({ data: { jobGeneralInformation: { qualifications: '' } } }),
    parseKariyerDetail({ data: {} }),
    parseKariyerDetail({}),
    parseKariyerDetail(null),
  ];
  if (plainDetail === 'Plain JD text' && htmlDetail === 'Genel Nitelikler' && emptyDetail.every((d) => d === '')) {
    pass('parseKariyerDetail prefers plain qualifications, falls back to the HTML form, never invents text');
  } else {
    fail(`parseKariyerDetail = ${JSON.stringify({ plainDetail, htmlDetail, emptyDetail })}`);
  }

  // --- fetch() -------------------------------------------------------------

  const mkItem = (id, over = {}) => ({
    id,
    title: `Role ${id}`,
    companyName: `Co ${id}`,
    jobUrl: `/is-ilani/co-${id}-role-${id}-${id}`,
    locationText: 'İstanbul(Avr.)',
    locations: [{ countryName: 'Türkiye', cityName: 'İstanbul(Avr.)' }],
    workModel: 'OnSite',
    postingDate: '2026-11-16',
    showTime: '2026-11-16T08:40',
    jobCode: `REQ-${id}`,
    isSponsored: false,
    ...over,
  });
  const envelope = (items, currentPage = 1, totalJobCount = 22936) => ({
    statusCode: 'Success',
    status: 'Success',
    data: { totalJobCount, currentPage, jobs: { items } },
  });

  // A board-wide walk: the sort must be the stable oldest-first one (the
  // default SmartSort re-ranks between requests and loses rows), the three
  // promoted pins repeat on every page and must dedupe, and the short final
  // page ends the walk.
  const pin = mkItem(9999, { isSponsored: true });
  const pages = {
    1: envelope([pin, ...Array.from({ length: 1999 }, (_, i) => mkItem(i))], 1),
    2: envelope([pin, mkItem(2000), mkItem(2001)], 2),
    3: envelope([], 3), // must never be requested
  };
  const requested = [];
  const jobs = await kariyer.fetch({ name: 'Kariyer.net' }, {
    transport: 'http',
    sleep: noSleep,
    fetchJson: async (url, opts) => {
      const body = JSON.parse(opts.body);
      requested.push({ url, opts, body });
      return pages[body.currentPage];
    },
  });
  const bodies = requested.map((r) => r.body);
  if (
    jobs.length === 2002
    && requested.length === 2
    && requested.every((r) => r.url === 'https://candidatewebapigw.kariyer.net/search')
    && requested.every((r) => r.opts.method === 'POST' && r.opts.redirect === 'error')
    && bodies[0].currentPage === 1 && bodies[1].currentPage === 2
    && bodies.every((b) => b.size === 2000 && b.sortType === 'SortByDate' && b.sortDirection === 'Ascending')
  ) {
    pass('fetch() walks the stable ascending sort, stops on the short final page, sends redirect:"error"');
  } else {
    fail(`fetch() walk = ${JSON.stringify({ jobs: jobs.length, calls: requested.length, urls: requested.map((r) => r.url), bodies, redirects: requested.map((r) => r.opts?.redirect) })}`);
  }
  const pinRows = jobs.filter((j) => j.url.endsWith(pin.jobUrl)).length;
  if (pinRows === 1 && new Set(jobs.map((j) => j.url)).size === jobs.length) {
    pass('fetch() de-duplicates the promoted pin that repeats on every page (kept once, not dropped)');
  } else {
    fail(`fetch() dedup = ${jobs.length} rows, ${new Set(jobs.map((j) => j.url)).size} unique, pin rows ${pinRows}`);
  }

  // A walk that ended on the board's own short/empty page is complete: no
  // partial-read marker, and the canonical reader agrees (lib/board-truncation.mjs).
  if (!('truncated' in jobs) && boardTruncation(jobs) === null) {
    pass('fetch() leaves a naturally-ended walk unmarked');
  } else {
    fail(`fetch() marked a complete walk = ${JSON.stringify(boardTruncation(jobs))}`);
  }

  // A well-formed but empty board is [], not a throw.
  const emptyBoard = await kariyer.fetch({ name: 'Kariyer.net' }, {
    transport: 'http',
    sleep: noSleep,
    fetchJson: async () => envelope([], 1, 0),
  });
  if (Array.isArray(emptyBoard) && emptyBoard.length === 0) pass('fetch() returns [] for a present-and-empty board');
  else fail(`fetch() empty board = ${JSON.stringify(emptyBoard)}`);
  if (boardTruncation(emptyBoard) === null) pass('fetch() does not mark an empty board as truncated');
  else fail(`fetch() marked an empty board = ${JSON.stringify(boardTruncation(emptyBoard))}`);

  // Anything that is not the documented envelope must throw, not read as empty.
  const malformed = [
    {},
    { data: {} },
    { data: { jobs: {} } },
    { data: { jobs: { items: null } } },
    { data: { jobs: { items: 'nope' } } },
    [],
    'nope',
    null,
  ];
  const malformedResults = [];
  for (const payload of malformed) {
    try {
      await kariyer.fetch({ name: 'Kariyer.net' }, {
        transport: 'http',
        sleep: noSleep,
        fetchJson: async () => payload,
      });
      malformedResults.push('resolved');
    } catch (err) {
      malformedResults.push(err instanceof Error && /unexpected response/.test(err.message) ? 'threw' : `other:${err?.message}`);
    }
  }
  if (malformedResults.every((r) => r === 'threw')) {
    pass('fetch() throws a descriptive error on every non-envelope payload');
  } else {
    fail(`fetch() malformed payloads = ${JSON.stringify(malformedResults)}`);
  }

  // verify-portals' health probe: one list request, whatever the entry says.
  const probeCalls = [];
  const probeResult = await kariyer.fetch({ name: 'Kariyer.net', max_pages: 5 }, {
    transport: 'http',
    maxPages: 1,
    sleep: noSleep,
    fetchJson: async (url, opts) => {
      probeCalls.push(JSON.parse(opts.body).currentPage);
      return envelope([mkItem(1)], 1);
    },
  });
  if (probeCalls.length === 1 && probeCalls[0] === 1) pass('fetch() honors ctx.maxPages over the entry max_pages');
  else fail(`fetch() probe requests = ${JSON.stringify(probeCalls)}`);
  if (boardTruncation(probeResult) === null) pass('fetch() does not mark a health probe as truncated');
  else fail(`fetch() marked a probe = ${JSON.stringify(boardTruncation(probeResult))}`);

  // A probe that stops on a full page is a deliberate cut-off, not a
  // misconfigured entry: it must not draw the "raise max_pages" warning, and it
  // must not be marked either — a probe is not a truncated board.
  const realConsoleError = console.error;
  const probeWarnings = [];
  let fullPageProbe;
  try {
    console.error = (...args) => probeWarnings.push(args.join(' '));
    fullPageProbe = await kariyer.fetch({ name: 'Kariyer.net' }, {
      transport: 'http',
      maxPages: 1,
      sleep: noSleep,
      fetchJson: async () => envelope(Array.from({ length: 2000 }, (_, i) => mkItem(i)), 1),
    });
  } finally {
    console.error = realConsoleError;
  }
  if (probeWarnings.length === 0) pass('fetch() stays quiet when ctx.maxPages truncates — a probe is not a misconfiguration');
  else fail(`fetch() probe warnings = ${JSON.stringify(probeWarnings)}`);
  if (boardTruncation(fullPageProbe) === null) pass('fetch() does not mark a probe that stopped on a full page at the cap');
  else fail(`fetch() marked a capped probe = ${JSON.stringify(boardTruncation(fullPageProbe))}`);

  // A ctx.fetch rejection while probing must propagate unwrapped, so
  // verify-portals reads a budget cut-off as a live board.
  const sentinel = new Error('ProbePageBudgetReached');
  sentinel.name = 'ProbePageBudgetReached';
  let probeErr;
  try {
    await kariyer.fetch({ name: 'Kariyer.net' }, {
      transport: 'http',
      maxPages: 1,
      sleep: noSleep,
      fetchJson: async () => { throw sentinel; },
    });
  } catch (err) {
    probeErr = err;
  }
  if (probeErr === sentinel) pass('fetch() propagates a probe fetch rejection unwrapped');
  else fail(`fetch() probe rejection = ${probeErr === undefined ? 'swallowed' : String(probeErr?.message)}`);

  // max_pages caps a never-ending feed and warns.
  const fullPage = envelope(Array.from({ length: 2000 }, (_, i) => mkItem(i)), 1);
  const capWarnings = [];
  let capped;
  try {
    console.error = (...args) => capWarnings.push(args.join(' '));
    capped = await kariyer.fetch({ name: 'Kariyer.net', max_pages: 2 }, {
      transport: 'http',
      sleep: noSleep,
      fetchJson: async () => fullPage,
    });
  } finally {
    console.error = realConsoleError;
  }
  if (capped.length === 2000 && capWarnings.length === 1 && capWarnings[0].includes('truncated at max_pages=2') && capWarnings[0].includes('raise max_pages')) {
    pass('fetch() stops a never-ending board at max_pages and tells the user to raise it');
  } else {
    fail(`fetch() cap = ${JSON.stringify({ jobs: capped?.length, warnings: capWarnings })}`);
  }
  const capMarker = boardTruncation(capped);
  if (capMarker && capMarker.reason === 'page-cap' && capMarker.fetched === 2000 && capMarker.total === 22936 && capMarker.source === 'truncated') {
    pass('fetch() marks a cap-truncated walk partial with reason/fetched/total');
  } else {
    fail(`fetch() cap marker = ${JSON.stringify(capMarker)}`);
  }

  // A full page at the ceiling is only a truncation when the source's own
  // total says more exist. When the collected rows reach that total, the whole
  // board was read and the boundary page just happened to be full: complete,
  // no marker, no "raise max_pages" advice.
  const completeWarnings = [];
  let completeAtCap;
  try {
    console.error = (...args) => completeWarnings.push(args.join(' '));
    completeAtCap = await kariyer.fetch({ name: 'Kariyer.net', max_pages: 1 }, {
      transport: 'http',
      sleep: noSleep,
      fetchJson: async () => envelope(Array.from({ length: 2000 }, (_, i) => mkItem(i)), 1, 2000),
    });
  } finally {
    console.error = realConsoleError;
  }
  if (completeAtCap.length === 2000 && completeWarnings.length === 0) {
    pass('fetch() reads a full boundary page as complete when it reaches the reported total');
  } else {
    fail(`fetch() full-boundary completion = ${JSON.stringify({ jobs: completeAtCap?.length, warnings: completeWarnings })}`);
  }
  if (boardTruncation(completeAtCap) === null) {
    pass('fetch() does not mark a full boundary page that completed the board as partial');
  } else {
    fail(`fetch() full-boundary marker = ${JSON.stringify(boardTruncation(completeAtCap))}`);
  }

  // The gateway clamps currentPage at 100, so past that the advice must not be
  // "raise max_pages" — it cannot buy anything.
  const deepWarnings = [];
  let deep;
  try {
    console.error = (...args) => deepWarnings.push(args.join(' '));
    deep = await kariyer.fetch({ name: 'Kariyer.net', max_pages: 500 }, {
      transport: 'http',
      sleep: noSleep,
      fetchJson: async () => fullPage,
    });
  } finally {
    console.error = realConsoleError;
  }
  if (deep.length === 2000 && deepWarnings.length === 1 && deepWarnings[0].includes('truncated at max_pages=100') && !deepWarnings[0].includes('raise max_pages')) {
    pass('fetch() caps max_pages at the gateway\'s 100-page ceiling and does not suggest raising it');
  } else {
    fail(`fetch() page ceiling = ${JSON.stringify({ jobs: deep?.length, warnings: deepWarnings })}`);
  }
  if (boardTruncation(deep)?.reason === 'page-cap') {
    pass('fetch() marks a walk stopped at the gateway ceiling as page-cap too');
  } else {
    fail(`fetch() ceiling marker = ${JSON.stringify(boardTruncation(deep))}`);
  }

  // A page that cannot be fetched after retries keeps the pages so far and
  // must not blame max_pages.
  const partialWarnings = [];
  let partial;
  try {
    console.error = (...args) => partialWarnings.push(args.join(' '));
    partial = await kariyer.fetch({ name: 'Kariyer.net', max_pages: 3 }, {
      transport: 'http',
      sleep: noSleep,
      fetchJson: async (url, opts) => {
        const page = JSON.parse(opts.body).currentPage;
        if (page > 1) {
          const err = new Error('HTTP 500 Server Error');
          err.status = 500;
          throw err;
        }
        return fullPage;
      },
    });
  } finally {
    console.error = realConsoleError;
  }
  if (partial.length === 2000 && partialWarnings.length === 1 && partialWarnings[0].includes('page 2') && !partialWarnings[0].includes('raise max_pages')) {
    pass('fetch() keeps the pages already collected on a fetch-error stop, without blaming max_pages');
  } else {
    fail(`fetch() partial = ${JSON.stringify({ jobs: partial?.length, warnings: partialWarnings })}`);
  }
  const partialMarker = boardTruncation(partial);
  if (partialMarker && partialMarker.reason === 'fetch-error' && partialMarker.fetched === 2000 && partialMarker.total === 22936) {
    pass('fetch() marks a fetch-error stop partial with reason/fetched/total');
  } else {
    fail(`fetch() fetch-error marker = ${JSON.stringify(partialMarker)}`);
  }

  // A first page that cannot be fetched must fail loud, not read as an empty board.
  let firstPageErr;
  try {
    await kariyer.fetch({ name: 'Kariyer.net' }, {
      transport: 'http',
      sleep: noSleep,
      fetchJson: async () => {
        const err = new Error('HTTP 503 Service Unavailable');
        err.status = 503;
        throw err;
      },
    });
  } catch (err) {
    firstPageErr = err;
  }
  if (firstPageErr?.status === 503) pass('fetch() fails loud when the first page cannot be fetched (no silent empty board)');
  else fail(`fetch() first-page failure = ${firstPageErr === undefined ? 'resolved' : String(firstPageErr?.message)}`);

  // --- fetchDetails (opt-in) ----------------------------------------------

  const detailJobs = [mkItem(1), mkItem(2), mkItem(3)];
  const detailCalls = [];
  const enriched = await kariyer.fetch({ name: 'Kariyer.net', kariyer: { fetchDetails: true, detailLimit: 2 } }, {
    transport: 'http',
    sleep: noSleep,
    fetchJson: async (url, opts) => {
      if (url.includes('/job?')) {
        detailCalls.push({ url, opts });
        return { data: { jobGeneralInformation: { qualifications: `JD for ${new URL(url).searchParams.get('jobId')}` } } };
      }
      return envelope(detailJobs, 1, 3);
    },
  });
  // The walk is oldest-first, so enrichment takes the NEWEST postings.
  const described = enriched.filter((j) => j.description);
  if (
    detailCalls.length === 2
    && detailCalls.every((c) => c.opts.redirect === 'error')
    && described.length === 2
    && described.every((j) => j.description === `JD for ${j.externalId}`)
    && enriched.find((j) => j.externalId === '1')?.description === undefined
  ) {
    pass('fetch() enriches the newest postings up to detailLimit, with redirect:"error" on each detail call');
  } else {
    fail(`fetch() detailLimit = ${JSON.stringify({ calls: detailCalls.map((c) => c.url), described: described.map((j) => j.description) })}`);
  }

  // A detail fetch that keeps failing is best-effort: the row survives.
  const failedDetailIds = [];
  const resilient = await kariyer.fetch({ name: 'Kariyer.net', kariyer: { fetchDetails: true, detailLimit: 3 } }, {
    transport: 'http',
    sleep: noSleep,
    fetchJson: async (url) => {
      if (url.includes('/job?')) {
        failedDetailIds.push(new URL(url).searchParams.get('jobId'));
        const err = new Error('HTTP 503 Service Unavailable');
        err.status = 503;
        throw err;
      }
      return envelope(detailJobs, 1, 3);
    },
  });
  // Each posting is retried by the shared policy (3 attempts), so the distinct
  // postings attempted — not the raw attempt count — is what detailLimit caps.
  if (new Set(failedDetailIds).size === 3 && resilient.length === 3 && resilient.every((j) => j.description === undefined)) {
    pass('fetch() keeps every listing row when detail enrichment fails after retries');
  } else {
    fail(`fetch() detail failure = ${JSON.stringify({ ids: failedDetailIds, rows: resilient.length })}`);
  }

  // A posting id that will not URI-encode (a lone surrogate survives
  // JSON.parse) must drop that one detail fetch, not throw out of the loop.
  const surrogateCalls = [];
  const withSurrogate = await kariyer.fetch({ name: 'Kariyer.net', kariyer: { fetchDetails: true, detailLimit: 3 } }, {
    transport: 'http',
    sleep: noSleep,
    fetchJson: async (url) => {
      if (url.includes('/job?')) {
        surrogateCalls.push(url);
        return { data: { jobGeneralInformation: { qualifications: 'JD' } } };
      }
      return envelope([mkItem('clean'), mkItem('s1', { id: '\uD800' })], 1, 2);
    },
  });
  if (withSurrogate.length === 2 && surrogateCalls.length === 1 && surrogateCalls[0].endsWith('jobId=clean')) {
    pass('fetch() skips the detail fetch for an id that will not URI-encode, keeping both rows');
  } else {
    fail(`fetch() surrogate id = ${JSON.stringify({ rows: withSurrogate.length, calls: surrogateCalls })}`);
  }

  // A probe never spends detail requests, even with fetchDetails on.
  const probeDetailCalls = [];
  await kariyer.fetch({ name: 'Kariyer.net', kariyer: { fetchDetails: true } }, {
    transport: 'http',
    maxPages: 1,
    sleep: noSleep,
    fetchJson: async (url) => {
      if (url.includes('/job?')) probeDetailCalls.push(url);
      return envelope(detailJobs, 1, 3);
    },
  });
  if (probeDetailCalls.length === 0) pass('fetch() skips detail enrichment while probing');
  else fail(`fetch() probe detail calls = ${JSON.stringify(probeDetailCalls)}`);
} catch (e) {
  fail(`kariyer provider test crashed: ${e?.message}`);
}
