// tests/providers/peoplesoft.test.mjs
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — peoplesoft (PeopleSoft Fluid Candidate Gateway)');

const { makeHttpCtx } = await import(pathToFileURL(join(ROOT, 'providers/_http.mjs')).href);

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/peoplesoft.mjs')).href);
  const peoplesoft = mod.default;
  const {
    resolveConfig,
    buildSearchUrl,
    buildDetailUrl,
    createCookieJar,
    updateCookieJar,
    cookieHeader,
    extractById,
    extractTextById,
    parseFormState,
    parseReportedTotal,
    parsePeopleSoftDate,
    parseSearchPage,
    createSession,
    fetchSearchPage,
    fetchAdditionalResults,
    parseJobDetail,
    sanitizeHtml,
  } = mod;

  const fx = (name) => readFileSync(join(ROOT, 'tests/fixtures', name), 'utf-8');
  const searchFixture = fx('peoplesoft-search-page.html');
  const emptyFixture = fx('peoplesoft-search-page-empty.html');
  const loginFixture = fx('peoplesoft-login-page.html');
  const detailFixture = fx('peoplesoft-detail-page.html');
  const detailMismatchFixture = fx('peoplesoft-detail-page-mismatched.html');

  const SEARCH_URL = 'https://recruit.exampleu.ca/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&Action=U&FOCUS=Applicant&SiteId=1';
  const CONFIG = { origin: 'https://recruit.exampleu.ca', site: 'exu1', searchUrl: buildSearchUrl('https://recruit.exampleu.ca', 'exu1') };

  if (peoplesoft.id === 'peoplesoft') pass('peoplesoft.id is "peoplesoft"');
  else fail(`peoplesoft.id is ${JSON.stringify(peoplesoft.id)}`);

  // ── resolveConfig() / detect() — tenant-agnostic path signature ─────────

  {
    const cfg = resolveConfig({ name: 'ExampleU', careers_url: SEARCH_URL });
    if (cfg && cfg.origin === 'https://recruit.exampleu.ca' && cfg.site === 'exu1') {
      pass('resolveConfig() extracts origin + site from the search-page URL');
    } else {
      fail(`resolveConfig() wrong: ${JSON.stringify(cfg)}`);
    }
  }

  {
    // Regression for the real scan transport: makeHttpCtx().fetchResponse used
    // to throw on the manual 302 before requestWithSession could inspect it.
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response(null, { status: 302, headers: { location: '/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&Action=U&FOCUS=Applicant&SiteId=1&' } });
      }
      return new Response(emptyFixture, { status: 200 });
    };
    try {
      const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, { ...makeHttpCtx(), sleep: async () => {} });
      if (Array.isArray(jobs) && jobs.length === 0 && calls === 2) {
        pass('makeHttpCtx production path follows a validated same-origin manual redirect');
      } else {
        fail(`makeHttpCtx same-origin redirect wrong: calls=${calls} jobs=${JSON.stringify(jobs)}`);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
    };
    let caught = null;
    try {
      await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, { ...makeHttpCtx(), sleep: async () => {} });
    } catch (error) {
      caught = error;
    } finally {
      globalThis.fetch = realFetch;
    }
    if (calls === 1 && /untrusted origin/i.test(caught?.message || '')) {
      pass('makeHttpCtx production path rejects an off-origin manual redirect before following it');
    } else {
      fail(`makeHttpCtx off-origin redirect wrong: calls=${calls} error=${caught?.message}`);
    }
  }

  {
    // Different, unrelated real-shaped host — proves detection is NOT a
    // hostname guess, only the PeopleSoft path signature.
    const cfg = resolveConfig({ name: 'OtherU', careers_url: 'https://careers.otheru.example/psc/otheru1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL' });
    if (cfg && cfg.origin === 'https://careers.otheru.example' && cfg.site === 'otheru1') {
      pass('resolveConfig() works on an entirely different branded host — detection is path-based, not domain-based');
    } else {
      fail(`resolveConfig() cross-tenant case wrong: ${JSON.stringify(cfg)}`);
    }
  }

  {
    const hit = peoplesoft.detect({ name: 'ExampleU', careers_url: SEARCH_URL });
    if (hit && hit.url.includes('Page=HRS_APP_SCHJOB_FL') && hit.url.startsWith('https://recruit.exampleu.ca/psc/exu1/')) {
      pass('peoplesoft.detect() matches the Fluid search path and builds the canonical search URL');
    } else {
      fail(`peoplesoft.detect() returned ${JSON.stringify(hit)}`);
    }
  }

  // Non-HTTPS, wrong path, malformed/missing/null — all null, never throw.
  {
    const cases = [
      { name: 'X', careers_url: SEARCH_URL.replace('https://', 'http://') },
      { name: 'X', careers_url: 'https://recruit.exampleu.ca/some/other/path.GBL' },
      { name: 'X', careers_url: 'https://recruit.exampleu.ca/psp/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL' }, // /psp/ not /psc/
      { name: 'X', careers_url: 'not a url' },
      { name: 'X', careers_url: null },
      { name: 'X' },
      null,
    ];
    let allNull = true;
    let threw = false;
    for (const c of cases) {
      try {
        if (peoplesoft.detect(c) !== null) allNull = false;
      } catch {
        threw = true;
      }
    }
    if (allNull && !threw) pass('peoplesoft.detect() returns null (never throws) for non-HTTPS/wrong-path/malformed/missing/null input');
    else fail(`peoplesoft.detect() bad-input handling failed: allNull=${allNull} threw=${threw}`);
  }

  {
    // entry.api takes precedence over careers_url, same convention as
    // greenhouse/ashby/workday/adp-workforcenow.
    const hit = peoplesoft.detect({ name: 'X', careers_url: 'https://example.com/careers', api: SEARCH_URL });
    if (hit) pass('peoplesoft.detect() honors api: over a non-matching careers_url');
    else fail('peoplesoft.detect() should honor api: over careers_url');
  }

  // ── buildSearchUrl() / buildDetailUrl() ──────────────────────────────────

  {
    const url = buildSearchUrl('https://recruit.exampleu.ca', 'exu1');
    if (url.includes('Page=HRS_APP_SCHJOB_FL') && url.includes('Action=U') && url.includes('FOCUS=Applicant') && url.includes('SiteId=1')) {
      pass('buildSearchUrl() sets the documented query params');
    } else {
      fail(`buildSearchUrl() wrong: ${url}`);
    }
  }

  {
    const url = buildDetailUrl(CONFIG, 'JR00012345', 1);
    if (url.includes('Page=HRS_APP_JBPST_FL') && url.includes('JobOpeningId=JR00012345') && url.includes('PostingSeq=1')) {
      pass('buildDetailUrl() sets Page/JobOpeningId/PostingSeq');
    } else {
      fail(`buildDetailUrl() wrong: ${url}`);
    }
    const url2 = buildDetailUrl(CONFIG, 'JR00012345', 2);
    if (url2.includes('PostingSeq=2')) pass('buildDetailUrl() honors the postingSeq argument');
    else fail(`buildDetailUrl() postingSeq=2 wrong: ${url2}`);
  }

  // ── cookie jar ────────────────────────────────────────────────────────

  {
    const jar = createCookieJar();
    updateCookieJar(jar, ['PS_TOKEN=abc123; Path=/; HttpOnly', 'JSESSIONID=xyz789; Secure']);
    if (cookieHeader(jar) === 'PS_TOKEN=abc123; JSESSIONID=xyz789') {
      pass('cookie jar builds a Cookie header from Set-Cookie values, dropping attributes');
    } else {
      fail(`cookie jar header wrong: ${JSON.stringify(cookieHeader(jar))}`);
    }
    // A later Set-Cookie for the SAME name overwrites (rotation across hops).
    updateCookieJar(jar, ['PS_TOKEN=rotated456; Path=/']);
    if (cookieHeader(jar) === 'PS_TOKEN=rotated456; JSESSIONID=xyz789') {
      pass('cookie jar merges across multiple hops, last value per name wins (session rotation)');
    } else {
      fail(`cookie jar merge wrong: ${JSON.stringify(cookieHeader(jar))}`);
    }
    // Junk entries (no '=', empty name) are ignored, not thrown.
    updateCookieJar(jar, ['garbage-no-equals', '=novaluename', null, 42]);
    if (cookieHeader(jar) === 'PS_TOKEN=rotated456; JSESSIONID=xyz789') {
      pass('cookie jar ignores malformed Set-Cookie entries without throwing');
    } else {
      fail(`cookie jar malformed-entry handling wrong: ${JSON.stringify(cookieHeader(jar))}`);
    }
    if (cookieHeader(createCookieJar()) === '') pass('cookie jar header is "" for an empty jar');
    else fail('cookie jar header should be "" for an empty jar');
  }

  // ── extractById() / extractTextById() ────────────────────────────────────

  {
    const html = '<div><span id="a">hello <b>world</b></span><span id="b">plain</span></div>';
    if (extractById(html, 'a') === 'hello <b>world</b>') pass('extractById() returns raw inner HTML, tracking nested same-tag depth');
    else fail(`extractById() nested case wrong: ${JSON.stringify(extractById(html, 'a'))}`);
    if (extractTextById(html, 'a') === 'hello world') pass('extractTextById() strips tags and collapses whitespace');
    else fail(`extractTextById() wrong: ${JSON.stringify(extractTextById(html, 'a'))}`);
    if (extractById(html, 'missing') === null) pass('extractById() returns null when the id is absent');
    else fail('extractById() should return null for a missing id');
    if (extractTextById('<input id="c" value="x"/>', 'c') === '') pass('extractById() handles a self-closing tag (empty content, not a crash)');
    else fail('extractById() self-closing handling wrong');
  }

  // ── parseFormState() ──────────────────────────────────────────────────

  {
    const state = parseFormState(searchFixture);
    if (state && state.action === '/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL') {
      pass('parseFormState() extracts the form action attribute');
    } else {
      fail(`parseFormState() action wrong: ${JSON.stringify(state?.action)}`);
    }
    if (state && state.fields.ICStateNum === '4' && state.fields.ICSID === 'fake-session-id-0001') {
      pass('parseFormState() extracts hidden input fields by name/value, not just the ones the provider reads directly');
    } else {
      fail(`parseFormState() hidden fields wrong: ${JSON.stringify(state?.fields)}`);
    }
    if (state && state.fields.HRS_SCH_WRK_KEYWORD_SW === 'Y') {
      pass('parseFormState() includes a checked checkbox');
    } else {
      fail(`parseFormState() checkbox wrong: ${JSON.stringify(state?.fields.HRS_SCH_WRK_KEYWORD_SW)}`);
    }
    if (parseFormState(loginFixture) === null) pass('parseFormState() returns null when form[name="win0"] is absent');
    else fail('parseFormState() should return null for the login page');
  }

  // ── parseReportedTotal() / parsePeopleSoftDate() ─────────────────────────

  if (parseReportedTotal('1-3 of 42 Results') === 42) pass('parseReportedTotal() reads the "of N" total');
  else fail(`parseReportedTotal() wrong: ${parseReportedTotal('1-3 of 42 Results')}`);
  if (parseReportedTotal('0 of 0 Results') === 0) pass('parseReportedTotal() reads a zero total');
  else fail('parseReportedTotal() zero case wrong');
  if (parseReportedTotal(null) === null && parseReportedTotal('') === null) pass('parseReportedTotal() returns null for absent/empty text');
  else fail('parseReportedTotal() should return null for absent text');
  if (parseReportedTotal('no numbers here') === null) pass('parseReportedTotal() returns null when no number is present');
  else fail('parseReportedTotal() should return null with no digits');

  if (parsePeopleSoftDate('08/15/2026') === Date.UTC(2026, 7, 15)) pass('parsePeopleSoftDate() parses M/D/YYYY');
  else fail(`parsePeopleSoftDate() wrong: ${parsePeopleSoftDate('08/15/2026')}`);
  if (parsePeopleSoftDate('not-a-real-date') === undefined) pass('parsePeopleSoftDate() returns undefined (never guesses) for an unrecognized format — raw string is preserved separately by the caller');
  else fail('parsePeopleSoftDate() should return undefined for an unrecognized format');
  if (parsePeopleSoftDate('13/40/2026') === undefined) pass('parsePeopleSoftDate() rejects an out-of-range month/day rather than producing a wrapped date');
  else fail('parsePeopleSoftDate() should reject 13/40/2026');
  if (parsePeopleSoftDate(null) === undefined && parsePeopleSoftDate('') === undefined) pass('parsePeopleSoftDate() returns undefined for absent/empty input');
  else fail('parsePeopleSoftDate() should return undefined for absent input');

  // ── parseSearchPage() ─────────────────────────────────────────────────

  {
    const page = parseSearchPage(searchFixture, CONFIG);
    if (page.valid === true && page.rows.length === 3) pass('parseSearchPage() parses a valid page with 3 rows');
    else fail(`parseSearchPage() row count wrong: valid=${page.valid} rows=${page.rows.length}`);
    if (page.reportedTotal === 3) pass('parseSearchPage() reads the reported total off the rowcnt element ("N rows" text, no "of" — the real observed live format)');
    else fail(`parseSearchPage() reportedTotal wrong: ${page.reportedTotal}`);
    if (page.rows[0].jobId === 'JR00012345' && page.rows[0].title === 'Instructional Designer' && page.rows[0].location === 'London, ON, Canada' && page.rows[0].department === 'Faculty of Education') {
      pass('parseSearchPage() row 0 fields extracted correctly');
    } else {
      fail(`parseSearchPage() row 0 wrong: ${JSON.stringify(page.rows[0])}`);
    }
    if (page.rows[0].postedAt === Date.UTC(2026, 7, 15)) pass('parseSearchPage() row 0 postedAt parsed');
    else fail(`parseSearchPage() row 0 postedAt wrong: ${page.rows[0].postedAt}`);
    if (page.rows[1].title === 'Learning & Development Specialist') {
      pass('parseSearchPage() decodes HTML entities in the title (&amp; -> &) before any downstream keyword match');
    } else {
      fail(`parseSearchPage() entity decoding wrong: ${JSON.stringify(page.rows[1].title)}`);
    }
    if (page.rows[2].postedAt === undefined && page.rows[2].postedRaw === 'not-a-real-date') {
      pass('parseSearchPage() keeps an unparseable date as raw text with postedAt left undefined (never guesses a format)');
    } else {
      fail(`parseSearchPage() row 2 date handling wrong: ${JSON.stringify(page.rows[2])}`);
    }
    if (page.formAction && page.formFields.ICSID === 'fake-session-id-0001') {
      pass('parseSearchPage() carries the full form state through for a later "load more" replay');
    } else {
      fail('parseSearchPage() should carry formAction/formFields');
    }
  }

  {
    const unquoted = `<form name="win0"><li id=HRS_AGNT_RSLT_I$0_row_7><a id="SCH_JOB_TITLE$7">Unquoted Row</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$7">J7</span></li></form>`;
    const page = parseSearchPage(unquoted, CONFIG);
    if (page.valid && page.rows.length === 1 && page.rows[0].jobId === 'J7') pass('parseSearchPage() accepts an unquoted PeopleSoft row id');
    else fail(`parseSearchPage() unquoted row id failed: ${JSON.stringify(page)}`);
  }

  {
    const page = parseSearchPage(emptyFixture, CONFIG);
    if (page.valid === true && page.rows.length === 0 && page.reportedTotal === 0) {
      pass('parseSearchPage() treats a genuinely empty (but well-formed) result as valid:true, rows:[]');
    } else {
      fail(`parseSearchPage() empty-page case wrong: ${JSON.stringify(page)}`);
    }
  }

  {
    // THE most important distinction in this provider: a login/session-expired
    // page must NEVER be reported as "zero postings".
    const page = parseSearchPage(loginFixture, CONFIG);
    if (page.valid === false && page.errorReason === 'unexpected-page' && page.rows.length === 0) {
      pass('parseSearchPage() distinguishes a login/session-expired page (valid:false) from a genuine empty result');
    } else {
      fail(`parseSearchPage() login-page case wrong: ${JSON.stringify(page)}`);
    }
  }

  // ── sanitizeHtml() — no script/event-handler injection survives ─────────

  {
    const clean = sanitizeHtml('<p onclick="alert(1)">safe text</p><script>alert(2)</script><img src=x onerror="alert(3)"><a href="javascript:alert(4)">bad link</a><a href="https://example.com/apply">good link</a>');
    if (!/onclick|onerror|alert\(/i.test(clean)) pass('sanitizeHtml() strips event handlers and inline script content entirely');
    else fail(`sanitizeHtml() leaked dangerous content: ${clean}`);
    if (!/<script/i.test(clean)) pass('sanitizeHtml() removes <script> tags');
    else fail(`sanitizeHtml() left a <script> tag: ${clean}`);
    if (!/javascript:/i.test(clean)) pass('sanitizeHtml() drops a javascript: href');
    else fail(`sanitizeHtml() kept a javascript: href: ${clean}`);
    if (clean.includes('safe text') && clean.includes('good link') && clean.includes('href="https://example.com/apply"')) {
      pass('sanitizeHtml() preserves safe text and a validated https href');
    } else {
      fail(`sanitizeHtml() dropped legitimate content: ${clean}`);
    }
    if (!/<img/i.test(clean)) pass('sanitizeHtml() drops a non-allowlisted tag (img) entirely');
    else fail(`sanitizeHtml() kept a non-allowlisted tag: ${clean}`);
  }
  {
    const html = sanitizeHtml('<!--[if IE]><script>alert(1)</script><![endif]--><p>text</p>');
    if (!/alert\(/i.test(html) && html.includes('<p>text</p>')) pass('sanitizeHtml() strips HTML comments (conditional-comment payloads included)');
    else fail(`sanitizeHtml() comment stripping wrong: ${html}`);
  }
  {
    const html = sanitizeHtml('<scr<script>ipt>alert(1)</scr</script>ipt><p>safe</p>');
    if (!/<script/i.test(html) && html.includes('<p>safe</p>')) {
      pass('sanitizeHtml() cannot reconstitute a script tag from text around a removed tag');
    } else {
      fail(`sanitizeHtml() leaked a reconstituted script payload: ${html}`);
    }
  }
  {
    const html = sanitizeHtml('<p>before</p><script>alert(1)<p>inside</p>');
    if (html === '<p>before</p>') pass('sanitizeHtml() discards the remainder owned by an unterminated script element');
    else fail(`sanitizeHtml() kept content from an unterminated script element: ${html}`);
  }

  // ── parseJobDetail() ──────────────────────────────────────────────────

  {
    const detail = parseJobDetail(detailFixture, 'JR00012345');
    if (detail.valid === true && detail.jobId === 'JR00012345') pass('parseJobDetail() accepts a matching job id');
    else fail(`parseJobDetail() valid case wrong: ${JSON.stringify({ valid: detail.valid, jobId: detail.jobId })}`);
    if (detail.title === 'Instructional Designer' && detail.location === 'London, ON, Canada' && detail.employmentType === 'Full-Time') {
      pass('parseJobDetail() extracts title/location/employmentType');
    } else {
      fail(`parseJobDetail() header fields wrong: ${JSON.stringify({ title: detail.title, location: detail.location, employmentType: detail.employmentType })}`);
    }
    if (detail.sections.length === 2 && detail.sections[0].label === 'Description' && detail.sections[1].label === 'Qualifications') {
      pass('parseJobDetail() concatenates JD sections in DOM order');
    } else {
      fail(`parseJobDetail() sections wrong: ${JSON.stringify(detail.sections.map((s) => s.label))}`);
    }
    if (detail.descriptionText.includes('Instructional Designer') && detail.descriptionText.includes("Master's degree")) {
      pass('parseJobDetail() descriptionText concatenates all sections as plain text');
    } else {
      fail(`parseJobDetail() descriptionText wrong: ${JSON.stringify(detail.descriptionText)}`);
    }
    if (!/onclick|onerror|<script|javascript:/i.test(detail.descriptionHtml)) {
      pass('parseJobDetail() descriptionHtml has no surviving script/event-handler injection from the second section');
    } else {
      fail(`parseJobDetail() descriptionHtml leaked dangerous markup: ${detail.descriptionHtml}`);
    }
    if (detail.descriptionHtml.includes('href="https://example.com/apply"')) {
      pass('parseJobDetail() descriptionHtml preserves a safe href');
    } else {
      fail('parseJobDetail() should keep the safe https href in descriptionHtml');
    }
  }

  {
    // Same fixture, wrong expected id — must reject, not misattribute content.
    const detail = parseJobDetail(detailFixture, 'JR00099999');
    if (detail.valid === false && detail.reason === 'job-id-mismatch' && detail.jobId === 'JR00012345') {
      pass('parseJobDetail() rejects a job whose page id does not match the requested id');
    } else {
      fail(`parseJobDetail() mismatch case wrong: ${JSON.stringify(detail)}`);
    }
  }

  {
    const detail = parseJobDetail(detailMismatchFixture, 'JR00012345');
    if (detail.valid === false && detail.reason === 'job-id-mismatch' && detail.jobId === 'JR99999999') {
      pass('parseJobDetail() rejects the dead-PostingSeq-redirected-to-a-generic-page fixture');
    } else {
      fail(`parseJobDetail() dead-link fixture wrong: ${JSON.stringify(detail)}`);
    }
  }

  {
    const detail = parseJobDetail(loginFixture, 'JR00012345');
    if (detail.valid === false && detail.reason === 'unexpected-page') {
      pass('parseJobDetail() treats a page with no job-opening-id element as unexpected-page, not a mismatch');
    } else {
      fail(`parseJobDetail() unexpected-page case wrong: ${JSON.stringify(detail)}`);
    }
  }

  // ── createSession() / fetchSearchPage() ──────────────────────────────

  {
    const ctx = {
      sleep: async () => {},
      fetchResponse: async (url, opts) => {
        if (opts.method && opts.method !== 'GET') throw new Error(`unexpected method ${opts.method}`);
        return new Response(searchFixture, { status: 200, headers: new Headers([['set-cookie', 'PS_TOKEN=abc123; Path=/']]) });
      },
    };
    const session = await createSession(ctx);
    const page = await fetchSearchPage(CONFIG, session);
    if (page.valid && page.rows.length === 3) pass('fetchSearchPage() GETs the search URL under a session and parses it');
    else fail(`fetchSearchPage() wrong: ${JSON.stringify({ valid: page.valid, rows: page.rows.length })}`);
    if (cookieHeader(session.jar) === 'PS_TOKEN=abc123') pass('fetchSearchPage() captures Set-Cookie from the GET into the session jar');
    else fail(`fetchSearchPage() session jar wrong: ${JSON.stringify(cookieHeader(session.jar))}`);
  }

  // ── fetchAdditionalResults() — the POST-replay "load more" flow ─────────

  {
    let seenOpts = null;
    let seenBody = null;
    const ctx = {
      sleep: async () => {},
      fetchResponse: async (url, opts) => {
        seenOpts = opts;
        seenBody = opts.body;
        return new Response(emptyFixture, { status: 200 });
      },
    };
    const session = { ctx, jar: updateCookieJar(createCookieJar(), ['PS_TOKEN=abc123']), config: CONFIG };
    const state = parseSearchPage(searchFixture, CONFIG);
    await fetchAdditionalResults(state, session);

    if (seenOpts.method === 'POST' && seenOpts.redirect === 'manual') {
      pass("fetchAdditionalResults() POSTs with redirect:'manual' (validated same-origin redirect following, not a blind follow)");
    } else {
      fail(`fetchAdditionalResults() request shape wrong: ${JSON.stringify({ method: seenOpts.method, redirect: seenOpts.redirect })}`);
    }
    if (seenOpts.headers.cookie === 'PS_TOKEN=abc123') pass('fetchAdditionalResults() replays the session cookie on the POST');
    else fail(`fetchAdditionalResults() cookie header wrong: ${JSON.stringify(seenOpts.headers.cookie)}`);
    const posted = new URLSearchParams(seenBody);
    if (posted.get('ICAction') === 'HRS_AGNT_RSLT_I$hdown$0') {
      pass('fetchAdditionalResults() overrides ICAction to the "load more" trigger');
    } else {
      fail(`fetchAdditionalResults() ICAction override wrong: ${JSON.stringify(posted.get('ICAction'))}`);
    }
    if (posted.get('ICSID') === 'fake-session-id-0001') {
      pass('fetchAdditionalResults() replays the FULL captured form state, not just fields this provider reads directly');
    } else {
      fail(`fetchAdditionalResults() did not replay full form state: ICSID=${posted.get('ICSID')}`);
    }
  }

  {
    // SSRF: a page-controlled form action pointing off-origin must be
    // rejected BEFORE any network call — never followed.
    let calls = 0;
    const ctx = { sleep: async () => {}, fetchResponse: async () => { calls++; return new Response(emptyFixture, { status: 200 }); } };
    const session = { ctx, jar: createCookieJar(), config: CONFIG };
    const evilState = { formAction: 'https://evil.example/steal', formFields: {} };
    let threw = false;
    try {
      await fetchAdditionalResults(evilState, session);
    } catch {
      threw = true;
    }
    if (threw && calls === 0) pass('fetchAdditionalResults() rejects an off-origin form action before any network call (SSRF guard)');
    else fail(`fetchAdditionalResults() SSRF guard failed: threw=${threw} calls=${calls}`);
  }

  // ── fetch() — end-to-end: cross-page dedup, cookies, completeness ───────

  {
    // Page 1 (the initial GET): 2 rows, reports a total of 3.
    const page1Html = `<form name="win0" action="/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL"><input type="hidden" name="ICStateNum" value="1">
      <span id="win0divHRS_AGNT_RSLT_Irowcnt$0">1-2 of 3 Results</span>
      <li id="HRS_AGNT_RSLT_I$0_row_0"><a id="SCH_JOB_TITLE$0">Role A</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0">J1</span><span id="LOCATION$0">Toronto</span></li>
      <li id="HRS_AGNT_RSLT_I$0_row_1"><a id="SCH_JOB_TITLE$1">Role B</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$1">J2</span><span id="LOCATION$1">Toronto</span></li>
      </form>`;
    // Page 2 (the "load more" POST replay): repeats J2 (dedup) + one new row J3.
    const page2Html = `<form name="win0" action="/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL"><input type="hidden" name="ICStateNum" value="2">
      <span id="win0divHRS_AGNT_RSLT_Irowcnt$0">1-3 of 3 Results</span>
      <li id="HRS_AGNT_RSLT_I$0_row_0"><a id="SCH_JOB_TITLE$0">Role B dup</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0">J2</span><span id="LOCATION$0">Toronto</span></li>
      <li id="HRS_AGNT_RSLT_I$0_row_1"><a id="SCH_JOB_TITLE$1">Role C</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$1">J3</span><span id="LOCATION$1">Ottawa</span></li>
      </form>`;
    let call = 0;
    const seenMethods = [];
    const ctx = {
      sleep: async () => {},
      fetchResponse: async (url, opts) => {
        seenMethods.push(opts.method || 'GET');
        call++;
        const body = call === 1 ? page1Html : call === 2 ? page2Html : '<form name="win0"></form>';
        return new Response(body, { status: 200, headers: new Headers([['set-cookie', `S=${call}`]]) });
      },
    };
    const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    if (jobs.length === 3) pass('fetch() dedups a job repeated across the "load more" POST replay, ending with 3 unique postings');
    else fail(`fetch() dedup wrong: ${jobs.length} jobs — ${JSON.stringify(jobs.map((j) => j.url))}`);
    if (seenMethods[0] === 'GET' && seenMethods[1] === 'POST') {
      pass('fetch() GETs the search page first, then POSTs the "load more" replay');
    } else {
      fail(`fetch() request sequence wrong: ${JSON.stringify(seenMethods)}`);
    }
    if (call === 2) pass('fetch() stops once the running unique count reaches the reported total (no wasted 3rd request)');
    else fail(`fetch() made ${call} requests, expected exactly 2`);
    if (jobs.every((j) => j.url.includes('Page=HRS_APP_JBPST_FL') && j.url.includes('PostingSeq=1'))) {
      pass('fetch() builds each job.url as the canonical PostingSeq=1 detail URL');
    } else {
      fail(`fetch() job URLs wrong: ${JSON.stringify(jobs.map((j) => j.url))}`);
    }
    if (jobs.every((j) => j._jobId === undefined)) pass('fetch() strips the internal _jobId plumbing field from output rows');
    else fail('fetch() leaked _jobId into a Job row');
    if (jobs.peoplesoftIncomplete === undefined) pass('fetch() carries no incomplete marker when the collected count reaches the reported total');
    else fail(`fetch() should not mark complete results incomplete: ${JSON.stringify(jobs.peoplesoftIncomplete)}`);
  }

  // ── fetch() — reported-total mismatch marks the result incomplete ──────

  {
    // Server always reports total=100 but the SAME 1 row forever (no
    // progress) — pagination must stop (fresh===0) and mark incomplete,
    // never silently claim "0 more postings exist" or loop forever.
    const stuckPage = `<form name="win0" action="/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL">
      <span id="win0divHRS_AGNT_RSLT_Irowcnt$0">1-1 of 100 Results</span>
      <li id="HRS_AGNT_RSLT_I$0_row_0"><a id="SCH_JOB_TITLE$0">Only Role</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0">ONLY</span><span id="LOCATION$0">Remote</span></li>
      </form>`;
    let calls = 0;
    const ctx = { sleep: async () => {}, fetchResponse: async () => { calls++; return new Response(stuckPage, { status: 200 }); } };
    const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    if (jobs.length === 1) pass('fetch() stops when a "load more" page returns no new rows (never loops forever)');
    else fail(`fetch() stuck-page case wrong: ${jobs.length} jobs after ${calls} calls`);
    if (jobs.peoplesoftIncomplete && jobs.peoplesoftIncomplete.complete === false && jobs.peoplesoftIncomplete.reason === 'load-more-no-progress') {
      pass('fetch() marks the result explicitly incomplete when parsed count < reported total (never silently "those postings closed")');
    } else {
      fail(`fetch() should mark incomplete: ${JSON.stringify(jobs.peoplesoftIncomplete)}`);
    }
    if (jobs.peoplesoftIncomplete?.collected === 1 && jobs.peoplesoftIncomplete?.reportedTotal === 100) {
      pass('fetch() incomplete marker reports the actual collected/reportedTotal numbers');
    } else {
      fail(`fetch() incomplete marker numbers wrong: ${JSON.stringify(jobs.peoplesoftIncomplete)}`);
    }
  }

  // ── fetch() — login/session-expired page is an error, never "0 jobs" ────

  {
    const ctx = { sleep: async () => {}, fetchResponse: async () => new Response(loginFixture, { status: 200 }) };
    let threw = false;
    let message = '';
    try {
      await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    } catch (e) {
      threw = true;
      message = e.message;
    }
    if (threw && /login|session|challenge|unexpected/i.test(message)) {
      pass('fetch() throws (not "0 jobs") when the search response has no form[name="win0"]');
    } else {
      fail(`fetch() should throw a diagnosable error for a login/session-expired page: threw=${threw} message=${message}`);
    }
  }

  // ── fetch() — redirect:'manual' + same-origin validation on every request ─
  // (NOT redirect:'error' — see peoplesoft.mjs's transport header comment:
  // PeopleSoft's own portal bootstrap issues a legitimate same-origin
  // redirect on the correct URL, so 'error' would break every real fetch.
  // Same-origin-only validation happens per hop instead — see the SSRF test
  // above and the off-origin-redirect test below.)

  {
    const ctx = { sleep: async () => {}, fetchResponse: async () => new Response(emptyFixture, { status: 200 }) };
    const seen = [];
    const wrapped = { ...ctx, fetchResponse: async (url, opts) => { seen.push(opts.redirect); return ctx.fetchResponse(); } };
    await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, wrapped);
    if (seen.length > 0 && seen.every((r) => r === 'manual')) pass("fetch() passes redirect:'manual' on every request (validated per-hop, never a blind follow)");
    else fail(`fetch() redirect option wrong: ${JSON.stringify(seen)}`);
  }

  {
    // A same-origin redirect (PeopleSoft's own portal bootstrap bounce) must
    // be followed transparently, with Set-Cookie captured at every hop.
    const target = CONFIG.origin + '/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?Page=HRS_APP_SCHJOB_FL&Action=U&FOCUS=Applicant&SiteId=1&';
    let call = 0;
    const ctx = {
      sleep: async () => {},
      fetchResponse: async () => {
        call++;
        if (call === 1) {
          return new Response(null, { status: 302, headers: new Headers([['location', target], ['set-cookie', 'HOP1=a']]) });
        }
        return new Response(emptyFixture, { status: 200, headers: new Headers([['set-cookie', 'HOP2=b']]) });
      },
    };
    const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    if (Array.isArray(jobs) && call === 2) pass('fetch() follows a same-origin redirect (PeopleSoft\'s own portal bootstrap bounce) and lands on the real page');
    else fail(`fetch() same-origin redirect handling wrong: call=${call} jobs=${JSON.stringify(jobs)}`);
  }

  {
    // An OFF-origin redirect must be rejected, not followed — this is the
    // actual SSRF-relevant case (a compromised/malicious response trying to
    // send the scanner somewhere else).
    let call = 0;
    const ctx = {
      sleep: async () => {},
      fetchResponse: async () => {
        call++;
        return new Response(null, { status: 302, headers: new Headers([['location', 'https://evil.example/steal']]) });
      },
    };
    let threw = false;
    let message = '';
    try {
      await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    } catch (e) {
      threw = true;
      message = e.message;
    }
    if (threw && call === 1 && /untrusted origin/i.test(message)) {
      pass('fetch() rejects an off-origin redirect before following it (the real SSRF guard)');
    } else {
      fail(`fetch() off-origin redirect handling wrong: threw=${threw} call=${call} message=${message}`);
    }
  }

  {
    // A redirect loop (or a chain longer than the bound) must not hang the
    // sweep forever.
    const ctx = {
      sleep: async () => {},
      fetchResponse: async (url) => new Response(null, { status: 302, headers: new Headers([['location', String(url)]]) }),
    };
    let threw = false;
    try {
      await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    } catch {
      threw = true;
    }
    if (threw) pass('fetch() throws rather than looping forever on a same-origin redirect loop');
    else fail('fetch() should throw on an unbounded/looping redirect chain');
  }

  // ── fetch() — ctx.maxPages health-probe cooperation ─────────────────

  {
    let calls = 0;
    const bigPage = `<form name="win0" action="/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL">
      <span id="win0divHRS_AGNT_RSLT_Irowcnt$0">1-1 of 500 Results</span>
      <li id="HRS_AGNT_RSLT_I$0_row_0"><a id="SCH_JOB_TITLE$0">Role</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0">J1</span><span id="LOCATION$0">Remote</span></li>
      </form>`;
    const ctx = { sleep: async () => {}, maxPages: 1, fetchResponse: async () => { calls++; return new Response(bigPage, { status: 200 }); } };
    const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL, peoplesoft: { fetchDetails: true } }, ctx);
    if (calls === 1) pass('fetch() honors ctx.maxPages: exactly one request during a health probe (no load-more, no detail fetch)');
    else fail(`fetch() made ${calls} requests under ctx.maxPages:1, expected 1`);
    if (jobs.length === 1 && jobs[0].description === undefined) pass('fetch() skips fetchDetails enrichment during a probe even when opted in');
    else fail('fetch() should skip detail enrichment during a probe');
    if (jobs.peoplesoftIncomplete === undefined) pass('fetch() omits the incomplete marker during a probe (completeness is meaningless there)');
    else fail('fetch() should not attach an incomplete marker during a probe');
  }

  {
    // A rejection during a probe must propagate UNWRAPPED, not be swallowed.
    const boom = new Error('HTTP 503 Service Unavailable');
    boom.status = 503;
    const ctx = { sleep: async () => {}, maxPages: 1, fetchResponse: async () => { throw boom; } };
    let caught = null;
    try {
      await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    } catch (e) {
      caught = e;
    }
    // fetchResponseWithRetry retries a 503 up to its policy before giving up,
    // so the exact object may differ by retry wrapping metadata, but the
    // status must survive unrewrapped (not caught-and-turned-into-[]).
    if (caught && caught.status === 503) pass('fetch() propagates a probe-time fetch rejection unwrapped (status preserved), never swallowed to []');
    else fail(`fetch() probe rejection handling wrong: ${JSON.stringify(caught)}`);
  }

  // ── fetch() — retry then success on a transient 5xx ──────────────────

  {
    let calls = 0;
    const ctx = {
      sleep: async () => {},
      fetchResponse: async () => {
        calls++;
        if (calls === 1) {
          const err = new Error('HTTP 503 Service Unavailable');
          err.status = 503;
          throw err;
        }
        return new Response(emptyFixture, { status: 200 });
      },
    };
    const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    if (Array.isArray(jobs) && jobs.length === 0 && calls === 2) {
      pass('fetch() retries a transient 5xx on the initial GET and succeeds on the next attempt');
    } else {
      fail(`fetch() retry-then-success wrong: calls=${calls} jobs=${JSON.stringify(jobs)}`);
    }
  }

  {
    // A non-retryable 403 must fail fast (not exhaust the retry budget).
    let calls = 0;
    const ctx = {
      sleep: async () => {},
      fetchResponse: async () => {
        calls++;
        const err = new Error('HTTP 403 Forbidden');
        err.status = 403;
        throw err;
      },
    };
    let threw = false;
    try {
      await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    } catch {
      threw = true;
    }
    if (threw && calls === 1) pass('fetch() does not retry a 403 (non-transient) — fails on the first attempt');
    else fail(`fetch() 403 handling wrong: threw=${threw} calls=${calls}`);
  }

  // ── fetch() — detail enrichment: PostingSeq=1 fails, PostingSeq=2 succeeds ─

  {
    const onePage = `<form name="win0" action="/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL">
      <span id="win0divHRS_AGNT_RSLT_Irowcnt$0">1-1 of 1 Results</span>
      <li id="HRS_AGNT_RSLT_I$0_row_0"><a id="SCH_JOB_TITLE$0">Instructional Designer</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0">JR00012345</span><span id="LOCATION$0">London, ON, Canada</span></li>
      </form>`;
    const seenDetailUrls = [];
    const ctx = {
      sleep: async () => {},
      fetchResponse: async (url) => {
        const u = String(url);
        if (u.includes('Page=HRS_APP_JBPST_FL')) {
          seenDetailUrls.push(u);
          if (u.includes('PostingSeq=1')) return new Response(detailMismatchFixture, { status: 200 }); // wrong job — reject
          return new Response(detailFixture, { status: 200 }); // PostingSeq=2 — correct job
        }
        return new Response(onePage, { status: 200 });
      },
    };
    const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL, peoplesoft: { fetchDetails: true } }, ctx);
    if (jobs.length === 1 && jobs[0].description && jobs[0].description.includes('Instructional Designer')) {
      pass('fetch() detail enrichment retries PostingSeq=2 after a PostingSeq=1 job-id mismatch, and succeeds');
    } else {
      fail(`fetch() PostingSeq retry wrong: ${JSON.stringify(jobs)}`);
    }
    if (seenDetailUrls.some((u) => u.includes('PostingSeq=1')) && seenDetailUrls.some((u) => u.includes('PostingSeq=2'))) {
      pass('fetch() tried both PostingSeq=1 and PostingSeq=2');
    } else {
      fail(`fetch() did not try both PostingSeq values: ${JSON.stringify(seenDetailUrls)}`);
    }
  }

  {
    // Neither PostingSeq works (both mismatched) — enrichment is dropped,
    // the LISTING result survives without a description.
    const onePage = `<form name="win0" action="/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL">
      <span id="win0divHRS_AGNT_RSLT_Irowcnt$0">1-1 of 1 Results</span>
      <li id="HRS_AGNT_RSLT_I$0_row_0"><a id="SCH_JOB_TITLE$0">Instructional Designer</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0">JR00012345</span><span id="LOCATION$0">London, ON, Canada</span></li>
      </form>`;
    const ctx = {
      sleep: async () => {},
      fetchResponse: async (url) => {
        const u = String(url);
        if (u.includes('Page=HRS_APP_JBPST_FL')) return new Response(detailMismatchFixture, { status: 200 }); // always the wrong job
        return new Response(onePage, { status: 200 });
      },
    };
    const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL, peoplesoft: { fetchDetails: true } }, ctx);
    if (jobs.length === 1 && jobs[0].description === undefined) {
      pass('fetch() keeps the listing row when detail enrichment fails on both PostingSeq attempts (fail-open)');
    } else {
      fail(`fetch() should keep the listing without a description: ${JSON.stringify(jobs)}`);
    }
  }

  {
    // fetchDetails is off by default — zero detail requests made.
    const onePage = `<form name="win0" action="/psc/exu1/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL">
      <span id="win0divHRS_AGNT_RSLT_Irowcnt$0">1-1 of 1 Results</span>
      <li id="HRS_AGNT_RSLT_I$0_row_0"><a id="SCH_JOB_TITLE$0">Role</a><span id="HRS_APP_JBSCH_I_HRS_JOB_OPENING_ID$0">J1</span><span id="LOCATION$0">Remote</span></li>
      </form>`;
    let detailCalls = 0;
    const ctx = {
      sleep: async () => {},
      fetchResponse: async (url) => {
        if (String(url).includes('Page=HRS_APP_JBPST_FL')) { detailCalls++; return new Response(detailFixture, { status: 200 }); }
        return new Response(onePage, { status: 200 });
      },
    };
    const jobs = await peoplesoft.fetch({ name: 'ExampleU', careers_url: SEARCH_URL }, ctx);
    if (detailCalls === 0 && jobs[0]?.description === undefined) {
      pass('fetch() never fetches job detail unless peoplesoft.fetchDetails:true is set (zero-token default)');
    } else {
      fail(`fetch() made ${detailCalls} unsolicited detail calls`);
    }
  }
} catch (e) {
  fail(`peoplesoft provider tests crashed: ${e.message}\n${e.stack}`);
}
