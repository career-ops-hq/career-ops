// tests/providers/zoho-recruit.test.mjs — offline contract coverage for the
// Zoho Recruit career-site provider: the list page's hidden `id="jobs"` input,
// the posting page's inline `JSON.parse('…')` record, and the opt-in detail
// enrichment. Fixtures are trimmed copies of the live page shapes with
// fictional content.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — zoho-recruit');

const fixture = (name) => readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');
const BOARD_URL = 'https://exampleco.zohorecruit.com/jobs/Careers';
const BOARD = { origin: 'https://exampleco.zohorecruit.com' };

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/zoho-recruit.mjs')).href);
  const { resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);
  const zoho = mod.default;

  if (zoho.id === 'zoho-recruit') pass('zoho-recruit.id is "zoho-recruit"');
  else fail(`zoho-recruit.id=${JSON.stringify(zoho.id)}`);

  // ── detect() ──
  // Only the hostname counts: every path (none, a portal, a posting, the
  // legacy site) and any port resolve to the fixed /jobs/Careers board.
  for (const careers_url of [
    'https://exampleco.zohorecruit.com/jobs/Careers',
    'https://exampleco.zohorecruit.com/jobs/careers/',
    'https://exampleco.zohorecruit.com/jobs/Emplois?source=site#top',
    'https://exampleco.zohorecruit.com/jobs/Careers/100000000048333021/QA-Engineer',
    'https://exampleco.zohorecruit.com:8443/jobs/Careers',
    'https://exampleco.zohorecruit.com/',
    'https://exampleco.zohorecruit.com',
    'https://exampleco.zohorecruit.com/recruit/Portal.na',
    'https://exampleco.zohorecruit.com/careers',
  ]) {
    const hit = zoho.detect({ name: 'ExampleCo', careers_url });
    if (hit?.url === BOARD_URL) pass(`detect claims ${careers_url} as ${BOARD_URL}`);
    else fail(`detect(${careers_url}) = ${JSON.stringify(hit)}, want ${BOARD_URL}`);
  }
  for (const tld of ['com', 'ca', 'eu', 'in', 'com.au', 'jp', 'sa', 'com.cn']) {
    const host = `exampleconsulting.zohorecruit.${tld}`;
    const hit = zoho.detect({ name: 'ExampleConsulting', careers_url: `https://${host}/jobs/Emplois/100000000048333021` });
    if (hit?.url === `https://${host}/jobs/Careers`) pass(`detect accepts the .${tld} regional domain`);
    else fail(`detect(.${tld}) = ${JSON.stringify(hit)}`);
  }
  if (zoho.detect({ name: 'ExampleCo', api: BOARD_URL })?.url === BOARD_URL) pass('detect also reads api:');
  else fail('detect ignored an api: board URL');

  for (const careers_url of [
    'http://exampleco.zohorecruit.com/jobs/Careers',
    'https://zohorecruit.com/jobs/Careers',
    'https://exampleco.zohorecruit.com.evil.example/jobs/Careers',
    'https://exampleco.evilzohorecruit.com/jobs/Careers',
    'https://exampleco.zohorecruit.com.evil.test/jobs/Careers',
    'https://exampleco.zohorecruit.ca.evil.test/jobs/Careers',
    'https://evil-zohorecruit.ca/jobs/Careers',
    'https://exampleconsulting.zohorecruit.xyz/jobs/Careers',
    'https://zohorecruit.ca/jobs/Careers',
    'http://exampleco.zohorecruit.com/',
    'not a url',
    '',
    null,
    42,
    undefined,
  ]) {
    let hit;
    try { hit = zoho.detect({ name: 'ExampleCo', careers_url }); }
    catch (err) { fail(`detect threw on ${JSON.stringify(careers_url)}: ${err.message}`); continue; }
    if (hit === null) pass(`detect returns null for ${JSON.stringify(careers_url)}`);
    else fail(`detect claimed ${JSON.stringify(careers_url)}: ${JSON.stringify(hit)}`);
  }
  if (zoho.detect(null) === null && zoho.detect({}) === null) pass('detect returns null for a null / empty entry');
  else fail('detect claimed a null / empty entry');

  const routed = resolveProvider({ name: 'ExampleCo', careers_url: BOARD_URL }, new Map([['zoho-recruit', zoho]]));
  if (routed?.provider === zoho) pass('registry routes a zohorecruit.com careers_url to zoho-recruit');
  else fail(`registry route=${JSON.stringify(routed)}`);

  // ── list page parsing ──
  const jobs = mod.parseZohoJobsPage(fixture('zoho-recruit-list.html'), BOARD, 'ExampleCo');
  const byTitle = Object.fromEntries(jobs.map((job) => [job.title, job]));
  if (jobs.length === 3) pass('list parser keeps the 3 open postings out of 8 records');
  else fail(`list parser returned ${jobs.length}: ${JSON.stringify(jobs.map((j) => j.title))}`);

  const remote = byTitle['QA Engineer'];
  if (remote
      && remote.url === `${BOARD_URL}/100000000048333021`
      && remote.company === 'ExampleCo'
      && remote.location === 'Remote'
      && remote.externalId === '100000000048333021'
      && !('postedAt' in remote) && !('description' in remote)) {
    pass('a remote posting with null location fields reads "Remote" and has no date or description');
  } else fail(`remote posting=${JSON.stringify(remote)}`);

  const rd = byTitle['R&D Engineer > Platform'];
  if (rd
      && rd.location === 'Barcelona, Catalonia, Spain'
      && rd.postedAt === Date.parse('2026-10-15')
      && rd.description === 'Company Description ExampleCo builds hotel software — day and night. We’re hiring an R&D engineer.') {
    pass('entity-escaped title, city/state/country, Date_Opened and list Job_Description are read');
  } else fail(`R&D posting=${JSON.stringify(rd)}`);

  // The decoded title must be what the scanner's keyword match sees.
  if (jobs.some((job) => /\bR&D\b/.test(job.title)) && !jobs.some((job) => job.title.includes('&amp;'))) {
    pass('titles are entity-decoded before any keyword match');
  } else fail('a title kept an HTML entity');

  const fallback = byTitle['Data Analyst'];
  if (fallback && fallback.location === 'Toronto, Canada, Remote') {
    pass('an empty Posting_Title falls back to Job_Opening_Name; Remote_Job is appended to the location');
  } else fail(`fallback posting=${JSON.stringify(fallback)}`);

  if (!byTitle['Customer Service Representative'] && !byTitle['Hidden Draft']) {
    pass('Is_Locked: true and Publish: false postings (shown as filled) are skipped');
  } else fail('a filled posting was kept');
  if (!byTitle['No Id Role'] && !jobs.some((job) => job.url.endsWith('/100000000000000006'))) {
    pass('rows without an id or without any title are dropped, not fatal');
  } else fail('a row missing id/title was kept');
  if (jobs.filter((job) => job.url.endsWith('/100000000048333021')).length === 1) {
    pass('a repeated id yields one posting');
  } else fail('a repeated id was emitted twice');

  // ── empty vs broken ──
  const empty = mod.parseZohoJobsPage(fixture('zoho-recruit-list-empty.html'), BOARD, 'ExampleCo');
  if (Array.isArray(empty) && empty.length === 0) pass('id="jobs" present with [] → [] (live, empty board)');
  else fail(`empty board=${JSON.stringify(empty)}`);

  const brokenCases = [
    ['a "Page does not exist" page (no id="jobs")', fixture('zoho-recruit-page-missing.html'), /no id="jobs" input.*Page does not exist/],
    ['an empty body', '', /empty careers page/],
    ['a non-string body', undefined, /empty careers page/],
    ['an id="jobs" value that is not JSON', '<input type="hidden" value="[{oops" id="jobs">', /not JSON/],
    ['an id="jobs" value that is an object', '<input type="hidden" value="{&#34;jobs&#34;:[]}" id="jobs">', /not an array, got: \{jobs\}/],
    ['an id="jobs" value that is null', '<input type="hidden" value="null" id="jobs">', /not an array, got: object|not an array/],
  ];
  for (const [label, html, re] of brokenCases) {
    let message = '';
    try { mod.parseZohoJobsPage(html, BOARD, 'ExampleCo'); }
    catch (err) { message = err.message; }
    if (re.test(message)) pass(`${label} throws descriptively`);
    else fail(`${label}: got ${JSON.stringify(message)}`);
  }

  // ── detail page parsing ──
  const detail = mod.parseZohoDetailPage(fixture('zoho-recruit-detail.html'));
  if (detail
      && detail.id === '100000000001853029'
      && detail.Salary === '65.000 EUR-75.000 EUR'
      && detail.Date_Opened === '2026-05-14'
      && detail.Posting_Title === 'Senior DevOps Engineer / Ruby'
      && detail.Job_Description.includes('<span id="spandesc">')
      && detail.Job_Description.includes("What you'll do")) {
    pass('detail parser unescapes the JS string literal (\\x22, \\/, \\-, \\x27, \\\\n) into the record');
  } else fail(`detail=${JSON.stringify(detail)}`);

  const locked = mod.parseZohoDetailPage(fixture('zoho-recruit-detail-locked.html'));
  if (locked && mod.isZohoRecordClosed(locked) && !mod.isZohoRecordClosed(detail)) {
    pass('isZohoRecordClosed reads Is_Locked / Publish off a detail record');
  } else fail(`locked detail=${JSON.stringify(locked)}`);

  if (mod.parseZohoDetailPage(fixture('zoho-recruit-detail-gone.html')) === null
      && mod.parseZohoDetailPage("var jobs = JSON.parse('[{oops');") === null
      && mod.parseZohoDetailPage('') === null
      && mod.parseZohoDetailPage(null) === null) {
    pass('a removed-posting page, a malformed literal, or no body → null');
  } else fail('detail parser returned a record for a page without one');

  const evalBait = mod.parseZohoDetailPage("var jobs = JSON.parse('[{\\x22id\\x22:\\x221\\x22,\\x22t\\x22:\\x22\\x27);globalThis.__zohoPwned=1;(\\x27\\x22}]');");
  if (evalBait?.t === "');globalThis.__zohoPwned=1;('" && globalThis.__zohoPwned === undefined) {
    pass('the detail literal is decoded as data, never evaluated');
  } else fail(`eval bait=${JSON.stringify(evalBait)}`);

  // ── salary ──
  const salaryCases = [
    ['$75,000-$100,000 USD', undefined, { min: 75000, max: 100000, currency: 'USD' }],
    ['65.000 EUR-75.000 EUR', undefined, { min: 65000, max: 75000, currency: 'EUR' }],
    ['$70,000 - $90,000', undefined, { min: 70000, max: 90000 }],
    ['$70,000 - $90,000', 'cad', { min: 70000, max: 90000, currency: 'CAD' }],
    ['€60.000 - €70.000', 'PLN', { min: 60000, max: 70000, currency: 'EUR' }],
    ['£55,000 - £65,000 per year', undefined, { min: 55000, max: 65000, currency: 'GBP' }],
    ['80-90k', 'EUR', { min: 80000, max: 90000, currency: 'EUR' }],
    ['$20-25/hr', 'USD', null],
    ['5.000 EUR per month', undefined, null],
    ['Competitive', 'USD', null],
    [null, 'USD', null],
    ['', undefined, null],
  ];
  for (const [text, currency, want] of salaryCases) {
    const got = mod.parseZohoSalary(text, currency);
    if (JSON.stringify(got) === JSON.stringify(want)) pass(`salary ${JSON.stringify(text)} (list currency ${currency ?? 'none'}) → ${JSON.stringify(want)}`);
    else fail(`salary ${JSON.stringify(text)} → ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }

  // ── fetch(): default path ──
  const calls = [];
  const fetched = await zoho.fetch(
    { name: 'ExampleCo', careers_url: 'https://exampleco.zohorecruit.com/jobs/Careers/100000000048333021' },
    { fetchText: async (url, opts) => { calls.push({ url, opts }); return fixture('zoho-recruit-list.html'); } },
  );
  if (calls.length === 1 && calls[0].url === BOARD_URL && calls[0].opts?.redirect === 'error'
      && fetched.length === 3 && fetched.every((job) => job.company === 'ExampleCo' && !job.salary)) {
    pass('default fetch is one redirect-blocked list request, no detail fetches');
  } else fail(`default fetch calls=${JSON.stringify(calls)}, jobs=${fetched.length}`);

  // ── fetch(): opt-in detail enrichment ──
  // The detail fixture's record, re-keyed to the posting the URL asks for.
  const detailFor = (url) => fixture('zoho-recruit-detail.html').replace('100000000001853029', url.split('/').pop());
  const detailCalls = [];
  const sleeps = [];
  let firstDetail = true;
  const enriched = await zoho.fetch(
    { name: 'ExampleCo', careers_url: BOARD_URL, zohoRecruit: { fetchDetails: true, detailLimit: 2 } },
    {
      sleep: async (ms) => { sleeps.push(ms); },
      fetchText: async (url, opts) => {
        if (url === BOARD_URL) return fixture('zoho-recruit-list.html');
        detailCalls.push({ url, opts });
        if (url.endsWith('/100000000048333021') && firstDetail) {
          firstDetail = false;
          throw Object.assign(new Error('HTTP 503'), { status: 503 });
        }
        if (url.endsWith('/100000000006043358')) throw Object.assign(new Error('HTTP 404'), { status: 404 });
        return detailFor(url);
      },
    },
  );
  const [qa, rdEnriched, analyst] = enriched;
  if (detailCalls.length === 3
      && detailCalls.every((call) => call.opts?.redirect === 'error')
      && qa.description.startsWith('This is a remote position. Job Title: Senior DevOps Engineer / Ruby & Rails')
      && qa.postedAt === Date.parse('2026-05-14')
      && JSON.stringify(qa.salary) === JSON.stringify({ min: 65000, max: 75000, currency: 'EUR' })
      && rdEnriched.description.startsWith('Company Description ExampleCo')
      && rdEnriched.postedAt === Date.parse('2026-10-15') && !rdEnriched.salary
      && !analyst.description && !analyst.salary) {
    pass('opt-in details: retried after a 503, a 404 keeps the list row, detailLimit caps the loop, every request redirect-blocked');
  } else fail(`detail calls=${JSON.stringify(detailCalls.map((c) => c.url))}, jobs=${JSON.stringify(enriched)}`);
  if (sleeps.includes(250)) pass('detail fetches are paced between requests');
  else fail(`detail pacing sleeps=${JSON.stringify(sleeps)}`);

  // A list row's own date wins over the detail page's.
  const keepDate = await zoho.fetch(
    { name: 'ExampleCo', careers_url: BOARD_URL, zohoRecruit: { fetchDetails: true, detailLimit: 3 } },
    {
      sleep: async () => {},
      fetchText: async (url) => (url === BOARD_URL ? fixture('zoho-recruit-list.html') : detailFor(url)),
    },
  );
  if (keepDate[1].postedAt === Date.parse('2026-10-15') && keepDate[0].postedAt === Date.parse('2026-05-14')) {
    pass('detail Date_Opened fills postedAt only when the list row has none');
  } else fail(`postedAt=${JSON.stringify(keepDate.map((j) => j.postedAt))}`);

  // A posting page that carries another posting's record enriches nothing.
  const wrongId = await zoho.fetch(
    { name: 'ExampleCo', careers_url: BOARD_URL, zohoRecruit: { fetchDetails: true, detailLimit: 1 } },
    {
      sleep: async () => {},
      fetchText: async (url) => (url === BOARD_URL ? fixture('zoho-recruit-list.html') : fixture('zoho-recruit-detail.html')),
    },
  );
  if (wrongId[0].externalId === '100000000048333021' && !wrongId[0].description && !wrongId[0].salary && !('postedAt' in wrongId[0])) {
    pass('a detail record whose id is not the posting\'s own leaves the list row unchanged');
  } else fail(`wrong-id detail=${JSON.stringify(wrongId[0])}`);

  // detailLimit bounds the loop however many postings the board holds.
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `2000000000000${String(i).padStart(5, '0')}`, Posting_Title: `Engineer ${i}`, Job_Opening_Name: `Engineer ${i}`,
    Is_Locked: false, Publish: true, Remote_Job: true, City: null, Country: null,
  }));
  const manyPage = `<input type="hidden" value="${JSON.stringify(many).replace(/"/g, '&#34;')}" id="jobs">`;
  let manyDetailCalls = 0;
  const manyJobs = await zoho.fetch(
    { name: 'ExampleCo', careers_url: BOARD_URL, zohoRecruit: { fetchDetails: true, detailLimit: 10 } },
    { sleep: async () => {}, fetchText: async (url) => { if (url === BOARD_URL) return manyPage; manyDetailCalls++; return ''; } },
  );
  if (manyJobs.length === 40 && manyDetailCalls === 10) pass('detailLimit: 10 issues exactly 10 detail fetches for 40 postings');
  else fail(`detailLimit run: jobs=${manyJobs.length}, detail calls=${manyDetailCalls}`);

  // ── probe cooperation ──
  let probeCalls = 0;
  const probed = await zoho.fetch(
    { name: 'ExampleCo', careers_url: BOARD_URL, zohoRecruit: { fetchDetails: true } },
    { maxPages: 1, fetchText: async () => { probeCalls++; return fixture('zoho-recruit-list.html'); } },
  );
  if (probeCalls === 1 && probed.length === 3 && probed.every((job) => !job.salary)) {
    pass('ctx.maxPages probe: exactly one list request, no detail fetches');
  } else fail(`probe calls=${probeCalls}, jobs=${JSON.stringify(probed)}`);

  class ProbePageBudgetReached extends Error {}
  let probeErr;
  try {
    await zoho.fetch(
      { name: 'ExampleCo', careers_url: BOARD_URL },
      { maxPages: 1, sleep: async () => {}, fetchText: async () => { throw new ProbePageBudgetReached('budget'); } },
    );
  } catch (err) { probeErr = err; }
  if (probeErr instanceof ProbePageBudgetReached) pass('a ctx.fetch* rejection during a probe propagates unwrapped');
  else fail(`probe rejection became ${probeErr?.constructor?.name}: ${probeErr?.message}`);

  // ── config guards run before any request ──
  let guardedCalls = 0;
  const guardCtx = { fetchText: async () => { guardedCalls++; return fixture('zoho-recruit-list.html'); } };
  for (const [careers_url, re] of [
    ['http://exampleco.zohorecruit.com/jobs/Careers', /needs an https:\/\/<tenant>\.zohorecruit\./],
    ['https://exampleco.zohorecruit.com.evil.example/jobs/Careers', /needs an https:\/\/<tenant>\.zohorecruit\./],
    ['https://exampleconsulting.zohorecruit.ca.evil.test/jobs/Careers', /needs an https:\/\/<tenant>\.zohorecruit\./],
    ['https://169.254.169.254/jobs/Careers', /needs an https:\/\/<tenant>\.zohorecruit\./],
  ]) {
    let message = '';
    try { await zoho.fetch({ name: 'ExampleCo', provider: 'zoho-recruit', careers_url }, guardCtx); }
    catch (err) { message = err.message; }
    if (re.test(message)) pass(`fetch refuses ${careers_url} with a named error`);
    else fail(`fetch(${careers_url}): ${JSON.stringify(message)}`);
  }
  if (guardedCalls === 0) pass('URL guards run before fetchText');
  else fail(`refused configs caused ${guardedCalls} fetchText call(s)`);

  // ── any configured path reads the fixed board ──
  for (const careers_url of ['https://exampleco.zohorecruit.com/', 'https://exampleco.zohorecruit.com/recruit/Portal.na', 'https://exampleco.zohorecruit.com/jobs/Emplois']) {
    const calls = [];
    const got = await zoho.fetch(
      { name: 'ExampleCo', careers_url },
      { fetchText: async (url, opts) => { calls.push({ url, opts }); return fixture('zoho-recruit-list.html'); } },
    );
    if (calls.length === 1 && calls[0].url === BOARD_URL && calls[0].opts?.redirect === 'error'
        && got.length === 3 && got.every((job) => job.url.startsWith(`${BOARD_URL}/`))) {
      pass(`careers_url ${careers_url} → one redirect-blocked request to ${BOARD_URL}, posting URLs under it`);
    } else fail(`${careers_url}: calls=${JSON.stringify(calls.map((c) => [c.url, c.opts?.redirect]))}, jobs=${JSON.stringify(got.map((j) => j.url))}`);
  }

  // A tenant with only the legacy site answers /jobs/Careers with "Page does not exist".
  let legacyMessage = '';
  try {
    await zoho.fetch(
      { name: 'ExampleCo', careers_url: 'https://exampleco.zohorecruit.com/recruit/Portal.na' },
      { fetchText: async () => fixture('zoho-recruit-page-missing.html') },
    );
  } catch (err) { legacyMessage = err.message; }
  if (/no id="jobs" input on \/jobs\/Careers — an unknown tenant, or one with only the legacy career site, which is not supported/.test(legacyMessage)) {
    pass('a legacy-only tenant fails with a named error, not as an empty board');
  } else fail(`legacy-only tenant: ${JSON.stringify(legacyMessage)}`);
} catch (err) {
  fail(`zoho-recruit provider tests crashed: ${err.stack || err.message}`);
}
