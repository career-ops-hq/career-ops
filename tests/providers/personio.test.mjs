// tests/providers/personio.test.mjs — moved verbatim from test-all.mjs (#1440).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — personio');


try {
  const personioModule = await import(pathToFileURL(join(ROOT, 'providers/personio.mjs')).href);
  const personio = personioModule.default;
  const { parsePersonioXml, parsePersonioHtml, parsePersonioListing } = personioModule;

  // Runs `fn` with console.warn captured, so a test can assert on (and keep out
  // of the run's output) the provider's warnings.
  const withWarnings = async (fn) => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => { warnings.push(args.join(' ')); };
    try {
      return { result: await fn(), warnings };
    } finally {
      console.warn = original;
    }
  };

  if (personio.id === 'personio') pass('personio.id is "personio"');
  else fail(`personio.id is ${JSON.stringify(personio.id)}`);

  // detect: <slug>.jobs.personio.de careers host → the careers page
  const hit = personio.detect({ name: 'Acme', careers_url: 'https://acme.jobs.personio.de/' });
  if (hit && hit.url === 'https://acme.jobs.personio.de/') {
    pass('personio.detect() resolves <slug>.jobs.personio.de → its careers page');
  } else {
    fail(`personio.detect() returned ${JSON.stringify(hit)}`);
  }

  // Explicit tenant pin — companies commonly embed the Personio tenant as an
  // iframe on a branded careers page, so careers_url is not on the feed host.
  const pinned = personio.detect({
    name: 'Acme',
    provider: 'personio',
    personio: 'acme',
    careers_url: 'https://www.acme.example/careers/',
  });
  if (pinned && pinned.url === 'https://acme.jobs.personio.de/') {
    pass('personio.detect() resolves an explicit personio: <slug> pin');
  } else {
    fail(`personio.detect() with slug pin returned ${JSON.stringify(pinned)}`);
  }

  // The pin must not become an injection point for an arbitrary host.
  const badPin = personio.detect({
    name: 'Evil',
    provider: 'personio',
    personio: 'evil.example/../x',
    careers_url: 'https://www.acme.example/careers/',
  });
  if (badPin === null) {
    pass('personio.detect() rejects a slug pin containing non-slug characters');
  } else {
    fail(`personio.detect() accepted a malformed slug pin: ${JSON.stringify(badPin)}`);
  }

  // detect: the .com TLD variant is also accepted
  const comHit = personio.detect({ name: 'Acme', careers_url: 'https://acme.jobs.personio.com/jobs' });
  if (comHit && comHit.url === 'https://acme.jobs.personio.com/') {
    pass('personio.detect() accepts the .com TLD variant');
  } else {
    fail(`personio.detect() .com → ${JSON.stringify(comHit)}`);
  }

  if (personio.detect({ name: 'X', careers_url: 'https://example.com/careers' }) === null) {
    pass('personio.detect() returns null for non-personio URLs');
  } else {
    fail('personio.detect() should return null for non-personio URLs');
  }

  if (personio.detect({ name: 'X', careers_url: null }) === null && personio.detect({ name: 'X', careers_url: 7 }) === null) {
    pass('personio.detect() returns null for non-string careers_url (null and 7)');
  } else {
    fail('personio.detect() should treat non-string careers_url as missing');
  }

  // SSRF: jobs.personio.de in the PATH (not host) must not be detected.
  if (personio.detect({ name: 'Spoof', careers_url: 'https://evil.example/acme.jobs.personio.de/xml' }) === null) {
    pass('personio.detect() rejects path-spoofed URLs');
  } else {
    fail('personio.detect() must NOT misdetect path-spoofed URLs');
  }

  // SSRF: a look-alike host (suffix attack) must be rejected.
  if (personio.detect({ name: 'Spoof', careers_url: 'https://acme.jobs.personio.de.evil.com/xml' }) === null) {
    pass('personio.detect() rejects suffix-spoofed look-alike hosts');
  } else {
    fail('personio.detect() must reject suffix-spoofed hosts');
  }

  // parsePersonioXml — the real <workzag-jobs> shape (confirmed live)
  const HOST = 'acme.jobs.personio.de';
  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position>
  <id>1834171</id>
  <office>Munich</office>
  <additionalOffices><office>Berlin</office></additionalOffices>
  <name>Staff Software Engineer, Data &amp; Platform</name>
  <createdAt>2024-11-13T14:10:41+00:00</createdAt>
</position>
<position>
  <id>900100</id>
  <office>Remote</office>
  <name><![CDATA[Senior Engineer (m/f/d)]]></name>
  <createdAt>2025-01-02T09:00:00+00:00</createdAt>
</position>
<position>
  <id>777</id>
  <office>Cologne</office>
  <name></name>
</position>
<position>
  <id>not-a-number</id>
  <office>Hamburg</office>
  <name>Bad ID Role</name>
</position>
</workzag-jobs>`;
  const jobs = parsePersonioXml(sample, 'Acme', HOST);

  if (jobs.length === 2) pass('parsePersonioXml keeps 2 positions (drops empty name + non-numeric id)');
  else fail(`parsePersonioXml returned ${jobs.length} positions (expected 2)`);

  if (jobs[0]?.title === 'Staff Software Engineer, Data & Platform' && jobs[0]?.company === 'Acme') {
    pass('parsePersonioXml decodes &amp; in the title');
  } else {
    fail(`row 0 = ${JSON.stringify(jobs[0])}`);
  }

  if (jobs[0]?.url === 'https://acme.jobs.personio.de/job/1834171') {
    pass('parsePersonioXml builds the job URL from host + numeric id');
  } else {
    fail(`row 0 url = ${JSON.stringify(jobs[0]?.url)}`);
  }

  if (jobs[0]?.location === 'Munich, Berlin') {
    pass('parsePersonioXml joins primary + additionalOffices');
  } else {
    fail(`row 0 location = ${JSON.stringify(jobs[0]?.location)}, expected "Munich, Berlin"`);
  }

  if (jobs[0]?.postedAt === Date.parse('2024-11-13T14:10:41+00:00')) {
    pass('parsePersonioXml parses createdAt → postedAt');
  } else {
    fail(`row 0 postedAt = ${JSON.stringify(jobs[0]?.postedAt)}`);
  }

  if (jobs[1]?.title === 'Senior Engineer (m/f/d)') {
    pass('parsePersonioXml unwraps a CDATA name');
  } else {
    fail(`row 1 title = ${JSON.stringify(jobs[1]?.title)}`);
  }

  if (parsePersonioXml('', 'X', HOST).length === 0 && parsePersonioXml(null, 'X', HOST).length === 0) {
    pass('empty / non-string feed → empty result (no crash)');
  } else {
    fail('empty / non-string feed should yield empty result');
  }

  // Hardening: <jobDescriptions> carries per-section <name>/<value> pairs whose
  // nested <name> must NOT be mistaken for the position's own title; numeric
  // entities decode; an office wrapped in CDATA unwraps.
  const tricky = `<workzag-jobs><position>
    <id>42</id>
    <office><![CDATA[München]]></office>
    <name>Real Title &#38; More</name>
    <jobDescriptions>
      <jobDescription><name>Your tasks</name><value>do things</value></jobDescription>
    </jobDescriptions>
    <createdAt>2025-03-04T00:00:00+00:00</createdAt>
  </position></workzag-jobs>`;
  const tj = parsePersonioXml(tricky, 'Acme', HOST);
  if (tj.length === 1 && tj[0].title === 'Real Title & More') {
    pass('parsePersonioXml ignores nested <jobDescriptions><name> + decodes numeric entity');
  } else {
    fail(`tricky title = ${JSON.stringify(tj[0]?.title)} (len ${tj.length})`);
  }
  if (tj[0]?.location === 'München') {
    pass('parsePersonioXml unwraps a CDATA <office>');
  } else {
    fail(`tricky location = ${JSON.stringify(tj[0]?.location)}`);
  }

  // Hardening: a <jobDescriptions> value carrying a literal "</position>" must
  // not truncate the block split. Stripping descriptions from the whole feed
  // first keeps both positions intact.
  const sneaky = `<workzag-jobs><position>
    <id>1</id><name>First</name>
    <jobDescriptions><jobDescription><name>About</name><value>uses &lt;/position&gt; literally: </position></value></jobDescription></jobDescriptions>
  </position><position>
    <id>2</id><name>Second</name>
  </position></workzag-jobs>`;
  const sj2 = parsePersonioXml(sneaky, 'Acme', HOST);
  if (sj2.length === 2 && sj2[0].title === 'First' && sj2[1].title === 'Second') {
    pass('parsePersonioXml survives a literal </position> inside <jobDescriptions>');
  } else {
    fail(`sneaky parse = ${JSON.stringify(sj2.map(j => j.title))} (len ${sj2.length})`);
  }

  // fetch() passes redirect:'error' to fetchText on every request (careers page
  // and feed alike) — SSRF hardening must not regress.
  const capturedOpts = [];
  await personio.fetch(
    { name: 'Acme', careers_url: 'https://acme.jobs.personio.de/' },
    { fetchText: async (_url, opts) => { capturedOpts.push(opts); return '<workzag-jobs></workzag-jobs>'; } },
  );
  if (capturedOpts.length === 2 && capturedOpts.every(opts => opts?.redirect === 'error')) {
    pass('personio.fetch() passes redirect:"error" to fetchText on every request');
  } else {
    fail(`personio.fetch() should pass redirect:"error", got: ${JSON.stringify(capturedOpts)}`);
  }

  // fetch() throws when no feed URL can be derived (non-personio careers_url).
  try {
    await personio.fetch(
      { name: 'NoFeed', careers_url: 'https://example.com/careers' },
      { fetchText: async () => { throw new Error('must not be called'); } },
    );
    fail('personio.fetch() should throw when the feed URL cannot be derived');
  } catch (e) {
    if (/cannot derive feed URL for NoFeed/.test(e.message)) {
      pass('personio.fetch() throws "cannot derive feed URL" for underivable entries');
    } else {
      fail(`personio.fetch() threw the wrong error: ${e.message}`);
    }
  }

  // parsePersonioHtml — real page markup shape served when /xml is disabled.
  const HTML_HOST = 'acme.jobs.personio.de';
  const htmlSample = `<ul><li>
    <a class="page_job__haA3E job-box" href="/job/2378948"><div class="page_jobHeaderContent__c_2JP">
      <h3 class="page_jobTitle__K0ilk jb-title">ML-QA Engineer</h3>
      <div class="page_jobMeta__GhU10 jb-description">
        <div class="page_jobMetaItem__olmVi"><span class="page_jobMetaText__5yzux">Berlin AI Campus, Munich</span></div>
        <div class="page_jobMetaItem__olmVi"><span class="page_jobMetaText__5yzux">Vollzeit</span></div>
      </div>
    </div></a>
  </li><li>
    <a class="page_job__haA3E job-box" href="/job/2540715?language=en"><div class="page_jobHeaderContent__c_2JP">
      <h3 class="page_jobTitle__K0ilk jb-title">Senior Engineer (m/f/d) &amp; Lead</h3>
      <div class="page_jobMeta__GhU10 jb-description">
        <div class="page_jobMetaItem__olmVi"><span class="page_jobMetaText__5yzux">Remote</span></div>
      </div>
    </div></a>
  </li><li>
    <a class="nav-link" href="/privacy-policy">Datenschutzerklärung</a>
  </li></ul>`;
  const htmlJobs = parsePersonioHtml(htmlSample, 'Acme', HTML_HOST);

  if (htmlJobs.length === 2) pass('parsePersonioHtml keeps 2 job-box anchors (ignores unrelated links)');
  else fail(`parsePersonioHtml returned ${htmlJobs.length} jobs (expected 2)`);

  if (htmlJobs[0]?.title === 'ML-QA Engineer' && htmlJobs[0]?.url === 'https://acme.jobs.personio.de/job/2378948') {
    pass('parsePersonioHtml extracts title + builds url from host + numeric id');
  } else {
    fail(`row 0 = ${JSON.stringify(htmlJobs[0])}`);
  }

  if (htmlJobs[0]?.location === 'Berlin AI Campus, Munich' && htmlJobs[0]?.company === 'Acme') {
    pass('parsePersonioHtml extracts the first jobMetaText span as location');
  } else {
    fail(`row 0 location/company = ${JSON.stringify({ location: htmlJobs[0]?.location, company: htmlJobs[0]?.company })}`);
  }

  if (htmlJobs[1]?.title === 'Senior Engineer (m/f/d) & Lead') {
    pass('parsePersonioHtml decodes &amp; in the title');
  } else {
    fail(`row 1 title = ${JSON.stringify(htmlJobs[1]?.title)}`);
  }

  if (htmlJobs[1]?.url === 'https://acme.jobs.personio.de/job/2540715') {
    pass('parsePersonioHtml strips a ?language=en query string from href, keeping the numeric id');
  } else {
    fail(`row 1 url = ${JSON.stringify(htmlJobs[1]?.url)}`);
  }

  if (htmlJobs.every((j) => j.postedAt === undefined)) {
    pass('parsePersonioHtml never sets postedAt (not exposed on the listing page)');
  } else {
    fail('parsePersonioHtml should never set postedAt');
  }

  // href before class on the anchor must still match (attribute order isn't
  // guaranteed across tenants).
  const hrefFirstSample = `<a href="/job/999001" class="job-box page_job__haA3E"><h3>Ops Lead</h3></a>`;
  const hrefFirstJobs = parsePersonioHtml(hrefFirstSample, 'Acme', HTML_HOST);
  if (hrefFirstJobs.length === 1 && hrefFirstJobs[0]?.title === 'Ops Lead' && hrefFirstJobs[0]?.url === 'https://acme.jobs.personio.de/job/999001') {
    pass('parsePersonioHtml matches an anchor with href before class');
  } else {
    fail(`href-before-class variant: ${JSON.stringify(hrefFirstJobs)}`);
  }

  if (parsePersonioHtml('', 'X', HTML_HOST).length === 0 && parsePersonioHtml(null, 'X', HTML_HOST).length === 0) {
    pass('parsePersonioHtml: empty / non-string page → empty result (no crash)');
  } else {
    fail('parsePersonioHtml: empty / non-string page should yield empty result');
  }

  // fetch() falls back to the careers page's job links when the page carries no
  // readable payload and /xml 404s — reusing the page it already fetched.
  {
    const calls = [];
    const { result: jobsFromFallback, warnings } = await withWarnings(() => personio.fetch(
      { name: 'Acme', careers_url: 'https://acme.jobs.personio.de/' },
      {
        fetchText: async (url, opts) => {
          calls.push(url);
          if (url.endsWith('/xml')) {
            const err = new Error('HTTP 404 Not Found');
            err.status = 404;
            throw err;
          }
          return htmlSample;
        },
      },
    ));
    if (calls.length === 2 && calls[0] === 'https://acme.jobs.personio.de/' && calls[1].endsWith('/xml')) {
      pass('personio.fetch() reads the careers page once, then /xml, when the page has no payload');
    } else {
      fail(`personio.fetch() fallback calls = ${JSON.stringify(calls)}`);
    }
    if (jobsFromFallback.length === 2) {
      pass('personio.fetch() returns jobs parsed from the job-link fallback');
    } else {
      fail(`personio.fetch() fallback returned ${jobsFromFallback.length} jobs`);
    }
    // The page links jobs, yet its payload yielded none: a changed page build.
    if (warnings.length === 1 && /Acme: careers page links jobs but its payload yielded none/.test(warnings[0])) {
      pass('personio.fetch() warns when the careers page links jobs its payload does not list');
    } else {
      fail(`personio.fetch() page-build warning: ${JSON.stringify(warnings)}`);
    }
  }

  // An empty board (no job links, no payload postings) falls back without a warning.
  {
    const { warnings } = await withWarnings(() => personio.fetch(
      { name: 'Acme', careers_url: 'https://acme.jobs.personio.de/' },
      { fetchText: async (url) => (url.includes('/xml') ? '<workzag-jobs></workzag-jobs>' : '<html><body></body></html>') },
    ));
    if (warnings.length === 0) pass('personio.fetch() does not warn for a careers page with no job links');
    else fail(`personio.fetch() warned on an empty board: ${JSON.stringify(warnings)}`);
  }

  // A transient /xml failure is retried before the feed is given up on.
  {
    const calls = [];
    const { result: jobs } = await withWarnings(() => personio.fetch(
      { name: 'Acme', careers_url: 'https://acme.jobs.personio.de/' },
      {
        fetchText: async (url) => {
          calls.push(url);
          if (!url.includes('/xml')) return htmlSample;
          if (calls.filter(u => u.includes('/xml')).length === 1) {
            const err = new Error('HTTP 503'); err.status = 503; throw err;
          }
          return sample;
        },
        sleep: async () => {},
      },
    ));
    if (calls.filter(u => u.includes('/xml')).length === 2 && jobs.length === 2) {
      pass('personio.fetch() retries a transient /xml failure');
    } else {
      fail(`personio.fetch() /xml retry: calls=${JSON.stringify(calls)} jobs=${jobs.length}`);
    }
  }

  // fetch() re-throws non-404 errors from the /xml feed (no silent fallback).
  try {
    await personio.fetch(
      { name: 'Acme', careers_url: 'https://acme.jobs.personio.de/' },
      {
        fetchText: async () => { const err = new Error('HTTP 500 Internal Server Error'); err.status = 500; throw err; },
        sleep: async () => {},
      },
    );
    fail('personio.fetch() should re-throw non-404 errors instead of falling back');
  } catch (e) {
    if (/HTTP 500/.test(e.message)) {
      pass('personio.fetch() re-throws non-404 errors without falling back to HTML');
    } else {
      fail(`personio.fetch() threw the wrong error: ${e.message}`);
    }
  }

  // ── Careers-page payload (the primary source) ──────────────────────
  // The page streams its Next.js payload as self.__next_f.push([1,"<chunk>"])
  // scripts whose JSON string chunks concatenate; postings are JSON objects in
  // it. The fixture is built the same way, split mid-object across two chunks.
  const flightPage = (...objects) => {
    const payload = `7:["$","div",null,{"jobs":[${objects.map(o => JSON.stringify(o)).join(',')}]}]\n`;
    const mid = Math.floor(payload.length / 2);
    return '<html><body><script>self.__next_f.push([0])</script>'
      + [payload.slice(0, mid), payload.slice(mid)]
        .map(chunk => `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`).join('')
      + '</body></html>';
  };
  const posting = (id, name, available, current, extra = {}) => ({
    id: String(id),
    name,
    main_office: 'Berlin',
    additional_offices: ['Remote', 'Berlin'],
    available_languages: available,
    default_locale: available[0],
    current_locale: current,
    created_at: '2026-10-02T09:00:00Z',
    ...extra,
  });

  {
    const listing = parsePersonioListing(flightPage(
      posting(101, 'QA Engineer (m/w/d)', ['de', 'en'], 'de'),
      { id: '5', title: 'not a posting' },
      { id: 'abc', name: 'Non-numeric', available_languages: ['en'] },
      posting(102, 'Lead {"id":"9"} "Quoted" Engineer', ['EN', 'not a code!'], 'EN'),
      posting(101, 'QA Engineer (m/w/d)', ['de', 'en'], 'de'),
    ));
    if (listing.length === 2 && listing[0].id === '101' && listing[1].id === '102') {
      pass('parsePersonioListing keeps postings only, in page order, once per id');
    } else {
      fail(`parsePersonioListing ids = ${JSON.stringify(listing.map(p => p.id))}`);
    }
    if (listing[0]?.name === 'QA Engineer (m/w/d)' && listing[0]?.mainOffice === 'Berlin'
      && JSON.stringify(listing[0]?.additionalOffices) === '["Remote","Berlin"]'
      && listing[0]?.createdAt === '2026-10-02T09:00:00Z'
      && JSON.stringify(listing[0]?.availableLanguages) === '["de","en"]' && listing[0]?.currentLocale === 'de') {
      pass('parsePersonioListing reads name, offices, created_at, available_languages, current_locale');
    } else {
      fail(`parsePersonioListing row 0 = ${JSON.stringify(listing[0])}`);
    }
    if (listing[1]?.name === 'Lead {"id":"9"} "Quoted" Engineer') {
      pass('parsePersonioListing survives braces and quotes inside a name');
    } else {
      fail(`parsePersonioListing row 1 name = ${JSON.stringify(listing[1]?.name)}`);
    }
    if (JSON.stringify(listing[1]?.availableLanguages) === '["en"]' && listing[1]?.currentLocale === 'en') {
      pass('parsePersonioListing lowercases language codes and drops malformed ones');
    } else {
      fail(`parsePersonioListing row 1 languages = ${JSON.stringify(listing[1])}`);
    }
    if (parsePersonioListing(htmlSample).length === 0 && parsePersonioListing('').length === 0 && parsePersonioListing(null).length === 0) {
      pass('parsePersonioListing: page without a payload / empty / non-string → empty');
    } else {
      fail('parsePersonioListing should yield nothing without a payload');
    }
  }

  // A tenant: A is German by default with an English version, B is English
  // only, C is French by default with a German version. A page asked for a
  // language a posting lacks renders that posting in its default language.
  const BASE = 'https://acme.jobs.personio.de/';
  const tenantPages = {
    [BASE]: flightPage(
      posting(1, 'A de', ['de', 'en'], 'de'), posting(2, 'B en', ['en'], 'en'), posting(3, 'C fr', ['de', 'fr'], 'fr')),
    [`${BASE}?language=de`]: flightPage(
      posting(1, 'A de', ['de', 'en'], 'de'), posting(2, 'B en', ['en'], 'en'), posting(3, 'C de', ['de', 'fr'], 'de')),
    [`${BASE}?language=en`]: flightPage(
      posting(1, 'A en', ['de', 'en'], 'en'), posting(2, 'B en', ['en'], 'en'), posting(3, 'C fr', ['de', 'fr'], 'fr')),
    [`${BASE}?language=fr`]: flightPage(
      posting(1, 'A de', ['de', 'en'], 'de'), posting(2, 'B en', ['en'], 'en'), posting(3, 'C fr', ['de', 'fr'], 'fr')),
  };
  const tenantCtx = (extra = {}, failing = new Set()) => {
    const calls = [];
    let sleeps = 0;
    return {
      calls,
      sleeps: () => sleeps,
      ctx: {
        fetchText: async (url, opts) => {
          calls.push(url);
          if (opts?.redirect !== 'error') throw new Error(`redirect:'error' missing for ${url}`);
          if (failing.has(url)) { const err = new Error('HTTP 500'); err.status = 500; throw err; }
          if (url in tenantPages) return tenantPages[url];
          const err = new Error(`HTTP 404 ${url}`); err.status = 404; throw err;
        },
        sleep: async () => { sleeps++; },
        ...extra,
      },
    };
  };
  const brief = jobs => jobs.map(j => `${j.url.replace(BASE, '')}|${j.language ?? '-'}|${j.title}`);

  {
    const { ctx, calls } = tenantCtx();
    const jobs = await personio.fetch({ name: 'Acme', careers_url: BASE }, ctx);
    if (calls.length === 1 && calls[0] === BASE
      && JSON.stringify(brief(jobs)) === JSON.stringify(['job/1?language=de|de|A de', 'job/2?language=en|en|B en', 'job/3?language=fr|fr|C fr'])) {
      pass('personio.fetch(): one careers-page fetch, each posting in its own default language, language on url and Job');
    } else {
      fail(`personio.fetch() defaults: calls=${JSON.stringify(calls)} jobs=${JSON.stringify(brief(jobs))}`);
    }
    if (jobs[0]?.location === 'Berlin, Remote' && jobs[0]?.company === 'Acme'
      && jobs[0]?.postedAt === Date.parse('2026-10-02T09:00:00Z')) {
      pass('personio.fetch(): payload postings map to location (de-duplicated offices), company, postedAt');
    } else {
      fail(`personio.fetch() job 0 = ${JSON.stringify(jobs[0])}`);
    }
  }

  {
    const { ctx, calls } = tenantCtx();
    const jobs = await personio.fetch({ name: 'Acme', careers_url: `${BASE}?language=en` }, ctx);
    if (calls.length === 1 && calls[0] === `${BASE}?language=en`
      && JSON.stringify(brief(jobs)) === JSON.stringify(['job/1?language=en|en|A en', 'job/2?language=en|en|B en', 'job/3?language=fr|fr|C fr'])) {
      pass('personio.fetch(): a ?language= on careers_url asks for that language wherever a posting has it');
    } else {
      fail(`personio.fetch() preferred language: calls=${JSON.stringify(calls)} jobs=${JSON.stringify(brief(jobs))}`);
    }
  }

  {
    const { ctx, calls, sleeps } = tenantCtx({ dedupIncludeLanguage: true });
    const jobs = await personio.fetch({ name: 'Acme', careers_url: `${BASE}?language=en` }, ctx);
    const expected = [
      'job/1?language=de|de|A de', 'job/1?language=en|en|A en',
      'job/2?language=en|en|B en',
      'job/3?language=fr|fr|C fr', 'job/3?language=de|de|C de',
    ];
    if (JSON.stringify(calls) === JSON.stringify([BASE, `${BASE}?language=de`, `${BASE}?language=en`])) {
      pass('personio.fetch() with dedupIncludeLanguage: defaults page, then one page per further language');
    } else {
      fail(`personio.fetch() all languages: calls=${JSON.stringify(calls)}`);
    }
    if (JSON.stringify(brief(jobs)) === JSON.stringify(expected)) {
      pass('personio.fetch() with dedupIncludeLanguage: every version, each posting\'s default language first');
    } else {
      fail(`personio.fetch() all languages: jobs=${JSON.stringify(brief(jobs))}`);
    }
    if (sleeps() === 1) pass('personio.fetch(): the per-language fetches are paced');
    else fail(`personio.fetch(): expected 1 pacing sleep, got ${sleeps()}`);
  }

  {
    const { ctx } = tenantCtx({ dedupIncludeLanguage: true }, new Set([`${BASE}?language=de`]));
    const jobs = await personio.fetch({ name: 'Acme', careers_url: BASE }, ctx);
    if (JSON.stringify(brief(jobs)) === JSON.stringify(['job/1?language=de|de|A de', 'job/1?language=en|en|A en', 'job/2?language=en|en|B en', 'job/3?language=fr|fr|C fr'])) {
      pass('personio.fetch(): a failing language fetch drops only that language\'s versions');
    } else {
      fail(`personio.fetch() failing language: jobs=${JSON.stringify(brief(jobs))}`);
    }
  }

  // The languages to fetch come from the payload, so their number is capped.
  {
    const extra = ['ar', 'cs', 'da', 'es', 'fi', 'fr', 'it'];
    const calls = [];
    const page = flightPage(posting(1, 'A de', ['de', ...extra], 'de'));
    const { warnings } = await withWarnings(() => personio.fetch({ name: 'Acme', careers_url: BASE }, {
      fetchText: async (url) => { calls.push(url); return page; },
      sleep: async () => {},
      dedupIncludeLanguage: true,
    }));
    const fetched = calls.slice(1).map(url => url.replace(`${BASE}?language=`, ''));
    if (JSON.stringify(fetched) === JSON.stringify(extra.slice(0, 5))) {
      pass('personio.fetch(): at most 5 further languages are fetched, in code order');
    } else {
      fail(`personio.fetch() language cap: fetched ${JSON.stringify(fetched)}`);
    }
    if (warnings.length === 1 && /Acme: 7 further languages exceed the cap of 5; skipped fr, it/.test(warnings[0])) {
      pass('personio.fetch(): the language cap names the languages it skipped');
    } else {
      fail(`personio.fetch() language-cap warning: ${JSON.stringify(warnings)}`);
    }
  }

  // A health probe (ctx.maxPages) gets the one listing request and no fan-out.
  {
    const { ctx, calls } = tenantCtx({ dedupIncludeLanguage: true, maxPages: 1 });
    const jobs = await personio.fetch({ name: 'Acme', careers_url: BASE }, ctx);
    if (JSON.stringify(calls) === JSON.stringify([BASE]) && jobs.length === 3) {
      pass('personio.fetch(): under ctx.maxPages the language fan-out is skipped');
    } else {
      fail(`personio.fetch() probe: calls=${JSON.stringify(calls)} jobs=${jobs.length}`);
    }
  }

  // The payload is undocumented: when the careers page fails or yields nothing,
  // the documented XML feed answers instead.
  {
    const calls = [];
    const jobs = await personio.fetch({ name: 'Acme', careers_url: BASE }, {
      fetchText: async (url) => {
        calls.push(url);
        if (url === BASE) { const err = new Error('HTTP 403'); err.status = 403; throw err; }
        return sample;
      },
      sleep: async () => {},
    });
    if (JSON.stringify(calls) === JSON.stringify([BASE, `${BASE}xml`]) && jobs.length === 2
      && jobs[0].url === 'https://acme.jobs.personio.de/job/1834171' && jobs[0].language === undefined) {
      pass('personio.fetch(): a failing careers page falls back to the XML feed (no language)');
    } else {
      fail(`personio.fetch() careers-page failure: calls=${JSON.stringify(calls)} jobs=${JSON.stringify(jobs)}`);
    }
  }
  {
    const calls = [];
    await withWarnings(() => personio.fetch({ name: 'Acme', careers_url: `${BASE}?language=en` }, {
      fetchText: async (url) => { calls.push(url); return url.includes('/xml') ? sample : htmlSample; },
    }));
    if (JSON.stringify(calls) === JSON.stringify([`${BASE}?language=en`, `${BASE}xml?language=en`])) {
      pass('personio.fetch(): a careers page without a payload falls back to the feed, keeping the asked-for language');
    } else {
      fail(`personio.fetch() no-payload fallback: calls=${JSON.stringify(calls)}`);
    }
  }
  {
    const calls = [];
    const jobs = await personio.fetch({ name: 'Acme', careers_url: BASE }, {
      fetchText: async (url) => {
        calls.push(url);
        if (calls.length === 1) { const err = new Error('HTTP 403'); err.status = 403; throw err; }
        if (url.endsWith('/xml')) { const err = new Error('HTTP 404'); err.status = 404; throw err; }
        return htmlSample;
      },
      sleep: async () => {},
    });
    if (JSON.stringify(calls) === JSON.stringify([BASE, `${BASE}xml`, BASE]) && jobs.length === 2) {
      pass('personio.fetch(): careers page and feed both failing → careers page re-fetched for its job links');
    } else {
      fail(`personio.fetch() double failure: calls=${JSON.stringify(calls)} jobs=${jobs.length}`);
    }
  }

} catch (e) {
  fail(`personio provider tests crashed: ${e.message}`);
}

