// tests/browser-extract.test.mjs — unit coverage for the pure logic in
// browser-extract.mjs (config resolution + result normalizers). The Playwright
// navigation path is exercised live, not here.
import { pass, fail, rmSync, ROOT } from './helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

console.log('\nbrowser-extract.mjs (config + normalizers)');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'browser-extract.mjs')).href);
  const { resolveAtsApi, JD_TEXT_API_ATS } = await import(pathToFileURL(join(ROOT, 'liveness-api.mjs')).href);
  const {
    resolveExtractorMode, compactText, normalizeJd, normalizeListing, parseArgs,
    workdayCxsUrl, jdHtmlToText, normalizeWorkdayJob,
    normalizeAshbyJob, normalizeGreenhouseJob, normalizeLeverJob,
    fetchJdViaKnownApi, JD_FETCHERS,
  } = mod;

  // resolveExtractorMode — default mcp, explicit cli, garbage → mcp, missing → mcp
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-extractor-'));
  try {
    const write = (name, body) => { const p = join(tmp, name); writeFileSync(p, body); return p; };
    if (resolveExtractorMode(write('cli.yml', 'scan:\n  extractor: cli\n')) === 'cli') pass('resolveExtractorMode reads scan.extractor: cli');
    else fail('resolveExtractorMode should read cli');
    if (resolveExtractorMode(write('mcp.yml', 'scan:\n  extractor: mcp\n')) === 'mcp') pass('resolveExtractorMode reads scan.extractor: mcp');
    else fail('resolveExtractorMode should read mcp');
    if (resolveExtractorMode(write('none.yml', 'candidate:\n  full_name: X\n')) === 'mcp') pass('resolveExtractorMode defaults to mcp when the key is absent');
    else fail('resolveExtractorMode should default to mcp');
    if (resolveExtractorMode(write('bad.yml', 'scan:\n  extractor: nonsense\n')) === 'mcp') pass('resolveExtractorMode falls back to mcp for an unknown value');
    else fail('resolveExtractorMode should fall back to mcp on garbage');
    if (resolveExtractorMode(join(tmp, 'does-not-exist.yml')) === 'mcp') pass('resolveExtractorMode returns mcp when the profile is missing');
    else fail('resolveExtractorMode should return mcp for a missing file');
    if (resolveExtractorMode(write('malformed.yml', 'scan:\n  extractor: [cli\n')) === 'mcp') pass('resolveExtractorMode falls back to mcp on malformed YAML (catch branch)');
    else fail('resolveExtractorMode should return mcp when the YAML is invalid');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // parseArgs — index-based: a flag value is never mistaken for the URL, and 0 is honored
  const flagsFirst = parseArgs(['--mode', 'listing', 'https://x/careers']);
  if (flagsFirst.url === 'https://x/careers' && flagsFirst.mode === 'listing') pass('parseArgs finds the URL even when flags precede it');
  else fail(`parseArgs flags-first => ${JSON.stringify(flagsFirst)}`);
  const urlFirst = parseArgs(['https://x/1', '--mode', 'jd', '--max', '5']);
  if (urlFirst.url === 'https://x/1' && urlFirst.mode === 'jd' && urlFirst.max === 5) pass('parseArgs handles url-first with flags');
  else fail(`parseArgs url-first => ${JSON.stringify(urlFirst)}`);
  const zeroMax = parseArgs(['https://x/1', '--max', '0']);
  if (zeroMax.max === 0) pass('parseArgs honors --max 0 (not silently replaced by the default)');
  else fail(`parseArgs --max 0 => ${zeroMax.max}`);
  const badMax = parseArgs(['https://x/1', '--max', 'abc']);
  if (badMax.max === 200) pass('parseArgs falls back to the default for a non-integer --max');
  else fail(`parseArgs --max abc => ${badMax.max}`);

  // parseArgs --max-chars (#configurable JD cap): overrides the jd text cap,
  // defaults to 12000, and rejects non-positive/non-integer values.
  if (parseArgs(['https://x/1']).maxChars === 12000) pass('parseArgs defaults maxChars to the 12000 JD cap');
  else fail(`parseArgs default maxChars => ${parseArgs(['https://x/1']).maxChars}`);
  const bigChars = parseArgs(['https://x/1', '--max-chars', '40000']);
  if (bigChars.maxChars === 40000) pass('parseArgs honors an explicit --max-chars');
  else fail(`parseArgs --max-chars 40000 => ${bigChars.maxChars}`);
  const badChars = parseArgs(['https://x/1', '--max-chars', '0']);
  if (badChars.maxChars === 12000) pass('parseArgs ignores a non-positive --max-chars (keeps the default cap)');
  else fail(`parseArgs --max-chars 0 => ${badChars.maxChars}`);
  const nonIntChars = parseArgs(['https://x/1', '--max-chars', '1.5']);
  if (nonIntChars.maxChars === 12000) pass('parseArgs ignores a non-integer --max-chars (keeps the default cap)');
  else fail(`parseArgs --max-chars 1.5 => ${nonIntChars.maxChars}`);

  // compactText — collapse whitespace + cap length
  if (compactText('a   b\t\tc') === 'a b c') pass('compactText collapses runs of whitespace');
  else fail(`compactText => ${JSON.stringify(compactText('a   b\t\tc'))}`);
  const capped = compactText('x'.repeat(50), 10);
  if (capped.length === 11 && capped.endsWith('…')) pass('compactText caps length and appends an ellipsis');
  else fail(`compactText cap => ${JSON.stringify(capped)}`);

  // normalizeJd — shape { url, title, text }
  const jd = normalizeJd({ title: '  Senior Go  Engineer ', text: 'Line1\n\n\n\nLine2   end' }, 'https://x/1');
  if (jd.url === 'https://x/1' && jd.title === 'Senior Go Engineer' && jd.text === 'Line1\n\nLine2 end') {
    pass('normalizeJd shapes { url, title, text } and compacts both');
  } else {
    fail(`normalizeJd => ${JSON.stringify(jd)}`);
  }

  // normalizeJd honors a custom text cap (a long JD is truncated at the cap, not
  // silently at the 12000 default) while leaving the default behavior unchanged.
  const longText = 'y'.repeat(20000);
  const raised = normalizeJd({ title: 'Role', text: longText }, 'https://x/1', 15000);
  const defaulted = normalizeJd({ title: 'Role', text: longText }, 'https://x/1');
  if (raised.text.length === 15001 && raised.text.endsWith('…') &&
      defaulted.text.length === 12001 && defaulted.text.endsWith('…')) {
    pass('normalizeJd applies a custom textCap and defaults to the 12000 JD cap');
  } else {
    fail(`normalizeJd textCap => raised=${raised.text.length} default=${defaulted.text.length}`);
  }

  // workdayCxsUrl — Workday posting URLs map to the per-job CXS endpoint;
  // everything else (including a Workday BOARD url with no /job/ segment) is
  // left to the browser path.
  const cxs = workdayCxsUrl('https://spgi.wd5.myworkdayjobs.com/spgi_careers/job/London-UK/Lead-PM_329276-2');
  if (cxs === 'https://spgi.wd5.myworkdayjobs.com/wday/cxs/spgi/spgi_careers/job/London-UK/Lead-PM_329276-2') {
    pass('workdayCxsUrl derives the per-job CXS endpoint');
  } else {
    fail(`workdayCxsUrl => ${cxs}`);
  }
  const cxsLocale = workdayCxsUrl('https://acme.wd1.myworkdayjobs.com/en-US/External/job/Toronto-ON-CAN/Eng_R1');
  if (cxsLocale === 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External/job/Toronto-ON-CAN/Eng_R1') {
    pass('workdayCxsUrl drops the optional locale segment');
  } else {
    fail(`workdayCxsUrl locale => ${cxsLocale}`);
  }
  const notWorkday = [
    'https://boards.greenhouse.io/acme/jobs/123',          // another ATS — not our branch
    'https://acme.wd5.myworkdayjobs.com/External',         // a board, not a posting
    'not a url',
  ].map(workdayCxsUrl);
  if (notWorkday.every((v) => v === null)) pass('workdayCxsUrl returns null for non-Workday-posting URLs');
  else fail(`workdayCxsUrl non-workday => ${JSON.stringify(notWorkday)}`);

  // Path traversal in the job path must not survive into the fixed-host URL.
  if (workdayCxsUrl('https://acme.wd5.myworkdayjobs.com/External/job/../../evil') === null) {
    pass('workdayCxsUrl rejects a traversal segment in the job path');
  } else {
    fail('workdayCxsUrl must reject ".." in the job path');
  }

  // jdHtmlToText — block structure survives as newlines, entities decode
  // (including entity-escaped markup), script/style bodies are dropped.
  const html = jdHtmlToText('<h1>About</h1><p>We build&nbsp;things &amp; ship.</p><style>p{color:red}</style><ul><li>Own the roadmap</li><li>Ship</li></ul><p>Line<br/>break</p>');
  if (html === 'About\nWe build things & ship.\n\n- Own the roadmap\n- Ship\nLine\nbreak') {
    pass('jdHtmlToText keeps block breaks and bullets, decodes entities, drops <style>');
  } else {
    fail(`jdHtmlToText => ${JSON.stringify(html)}`);
  }
  if (jdHtmlToText('&lt;p&gt;Escaped &lt;b&gt;markup&lt;/b&gt;&lt;/p&gt;') === 'Escaped markup') {
    pass('jdHtmlToText double-decodes entity-escaped markup');
  } else {
    fail(`jdHtmlToText escaped => ${JSON.stringify(jdHtmlToText('&lt;p&gt;Escaped &lt;b&gt;markup&lt;/b&gt;&lt;/p&gt;'))}`);
  }
  if (jdHtmlToText(null) === '' && jdHtmlToText('') === '' && jdHtmlToText(42) === '') {
    pass('jdHtmlToText returns "" for a non-string / empty body');
  } else {
    fail('jdHtmlToText should return "" for non-string input');
  }

  // normalizeWorkdayJob — same { url, title, text } contract as the scraped path
  const wdPayload = {
    jobPostingInfo: {
      title: '  Lead Product Manager  ',
      jobDescription: '<p>Build the thing.</p><ul><li>Own it</li></ul>',
      location: 'London, UK',
      additionalLocations: ['Gurugram, Haryana'],
      timeType: 'Full time',
      postedOn: 'Posted 17 Days Ago',
      jobReqId: '329276',
      canApply: true,
    },
  };
  const wd = normalizeWorkdayJob(wdPayload, 'https://spgi.wd5.myworkdayjobs.com/spgi_careers/job/London-UK/Lead-PM_329276-2');
  if (wd
      && wd.url === 'https://spgi.wd5.myworkdayjobs.com/spgi_careers/job/London-UK/Lead-PM_329276-2'
      && wd.title === 'Lead Product Manager'
      && wd.text.includes('Location: London, UK | Gurugram, Haryana')
      && wd.text.includes('Job type: Full time')
      && wd.text.includes('Req ID: 329276')
      && wd.text.includes('Build the thing.')
      && wd.text.includes('- Own it')
      && !wd.text.includes('canApply')) {
    pass('normalizeWorkdayJob shapes { url, title, text } with a metadata header');
  } else {
    fail(`normalizeWorkdayJob => ${JSON.stringify(wd)}`);
  }

  // canApply:false is a liveness signal and must reach the JD text.
  const closed = normalizeWorkdayJob(
    { jobPostingInfo: { title: 'X', jobDescription: '<p>Body</p>', canApply: false } },
    'https://acme.wd5.myworkdayjobs.com/External/job/Loc/X_1',
  );
  if (closed && closed.text.includes('Applications closed (canApply: false)')) {
    pass('normalizeWorkdayJob surfaces canApply: false');
  } else {
    fail(`normalizeWorkdayJob canApply => ${JSON.stringify(closed)}`);
  }

  // Anything that isn't a job payload, or carries no description, returns null
  // so the caller falls through to the browser instead of emitting an empty JD.
  const nulls = [
    normalizeWorkdayJob(null, 'https://x/1'),
    normalizeWorkdayJob({}, 'https://x/1'),
    normalizeWorkdayJob({ jobPostingInfo: { title: 'X' } }, 'https://x/1'),
    normalizeWorkdayJob({ jobPostingInfo: { title: 'X', jobDescription: '<p> </p>' } }, 'https://x/1'),
  ];
  if (nulls.every((v) => v === null)) pass('normalizeWorkdayJob returns null for a non-job / description-less payload');
  else fail(`normalizeWorkdayJob nulls => ${JSON.stringify(nulls)}`);

  // The text cap applies to the CXS path too.
  const wdCapped = normalizeWorkdayJob(
    { jobPostingInfo: { title: 'X', jobDescription: `<p>${'word '.repeat(5000)}</p>` } },
    'https://x/1',
    500,
  );
  if (wdCapped && wdCapped.text.length <= 501) pass('normalizeWorkdayJob honors the text cap');
  else fail(`normalizeWorkdayJob cap => ${wdCapped && wdCapped.text.length}`);

  // normalizeAshbyJob — Ashby's public API is ORG-level, so the job is picked
  // out of the whole board by a case-insensitive id compare.
  const ashbyBoard = {
    jobs: [
      { id: 'OTHER-1', title: 'Decoy', descriptionPlain: 'Not this one.' },
      {
        id: 'ABC-123',
        title: '  Staff Engineer  ',
        descriptionPlain: 'Build the platform.',
        location: 'Remote (US)',
        secondaryLocations: [{ location: 'Berlin' }, { location: 'London' }],
        employmentType: 'FullTime',
      },
    ],
  };
  const ashby = normalizeAshbyJob(ashbyBoard, 'abc-123', 'https://jobs.ashbyhq.com/acme/ABC-123');
  if (ashby
      && ashby.url === 'https://jobs.ashbyhq.com/acme/ABC-123'
      && ashby.title === 'Staff Engineer'
      && ashby.text.includes('Location: Remote (US)')
      && ashby.text.includes('Additional locations: Berlin | London')
      && ashby.text.includes('Type: FullTime')
      && ashby.text.includes('Build the platform.')
      && !ashby.text.includes('Not this one.')) {
    pass('normalizeAshbyJob matches the job case-insensitively and shapes { url, title, text }');
  } else {
    fail(`normalizeAshbyJob => ${JSON.stringify(ashby)}`);
  }

  // workplaceType wins over isRemote whenever it is present: boards ship
  // `isRemote: true` beside `workplaceType: "Hybrid"` constantly (52 of 60
  // sampled ramp postings), and trusting isRemote would label those Remote.
  const ashbyHybrid = normalizeAshbyJob(
    { jobs: [{ id: 'x', title: 'X', descriptionPlain: 'Body.', workplaceType: 'Hybrid', isRemote: true }] },
    'x', 'https://x/1',
  );
  // ...and isRemote is still the fallback when the board omits workplaceType.
  const ashbyRemoteOnly = normalizeAshbyJob(
    { jobs: [{ id: 'x', title: 'X', descriptionPlain: 'Body.', isRemote: true }] },
    'x', 'https://x/1',
  );
  if (ashbyHybrid && ashbyHybrid.text.includes('Work model: Hybrid')
      && !ashbyHybrid.text.includes('Work model: Remote')
      && ashbyRemoteOnly && ashbyRemoteOnly.text.includes('Work model: Remote')) {
    pass('normalizeAshbyJob prefers workplaceType over isRemote, falls back to isRemote');
  } else {
    fail(`normalizeAshbyJob work model => ${JSON.stringify([ashbyHybrid, ashbyRemoteOnly])}`);
  }

  // isListed:false is Ashby's "served but delisted" signal, the counterpart of
  // Workday's canApply:false, and must reach the JD text.
  const delisted = normalizeAshbyJob(
    { jobs: [{ id: 'x', title: 'X', descriptionPlain: 'Body', isListed: false }] },
    'x',
    'https://jobs.ashbyhq.com/acme/x',
  );
  if (delisted && delisted.text.includes('Not currently listed (isListed: false)')) {
    pass('normalizeAshbyJob surfaces isListed: false');
  } else {
    fail(`normalizeAshbyJob isListed => ${JSON.stringify(delisted)}`);
  }

  const ashbyNulls = [
    normalizeAshbyJob(null, 'x', 'https://x/1'),
    normalizeAshbyJob({ jobs: [] }, 'x', 'https://x/1'),
    normalizeAshbyJob({ jobs: [{ id: 'other' }] }, 'x', 'https://x/1'),
    normalizeAshbyJob({ jobs: [{ id: 'x', descriptionPlain: '   ' }] }, 'x', 'https://x/1'),
  ];
  if (ashbyNulls.every((v) => v === null)) pass('normalizeAshbyJob returns null when the job is absent or bodyless');
  else fail(`normalizeAshbyJob nulls => ${JSON.stringify(ashbyNulls)}`);

  // normalizeGreenhouseJob — `content` is HTML (often entity-escaped), so it
  // goes through the same jdHtmlToText pass as Workday's jobDescription.
  const gh = normalizeGreenhouseJob(
    {
      title: 'Backend Engineer',
      content: '&lt;p&gt;Own the API.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Go&lt;/li&gt;&lt;/ul&gt;',
      location: { name: 'New York' },
      offices: [{ name: 'New York, NY ' }],
      requisition_id: 'R-4821',
    },
    'https://job-boards.greenhouse.io/acme/jobs/12345',
  );
  if (gh
      && gh.title === 'Backend Engineer'
      && gh.text.includes('Location: New York')
      && !gh.text.includes('New York, NY')
      && gh.text.includes('Req ID: R-4821')
      && gh.text.includes('Own the API.')
      && gh.text.includes('- Go')
      && !gh.text.includes('&lt;')) {
    pass('normalizeGreenhouseJob decodes entity-escaped content and reads location.name + req id');
  } else {
    fail(`normalizeGreenhouseJob => ${JSON.stringify(gh)}`);
  }

  // The regression nikitacometa flagged: reading offices[] alone dropped the
  // Location line for a job whose offices array is empty. location.name is the
  // primary field and stands on its own.
  const ghNoOffices = normalizeGreenhouseJob(
    { title: 'X', content: '<p>Body.</p>', location: { name: 'Remote' }, offices: [] },
    'https://x/1',
  );
  if (ghNoOffices && ghNoOffices.text.includes('Location: Remote')) {
    pass('normalizeGreenhouseJob emits location.name when offices[] is empty');
  } else {
    fail(`normalizeGreenhouseJob empty offices => ${JSON.stringify(ghNoOffices)}`);
  }

  // Enrichment fires only for a work-model-only location.name (providers/
  // greenhouse.mjs:196): the city lives in offices[] and would otherwise be
  // lost behind the string "Hybrid".
  const ghWorkModel = normalizeGreenhouseJob(
    { title: 'X', content: '<p>Body.</p>', location: { name: 'Hybrid' }, offices: [{ name: 'Berlin' }] },
    'https://x/1',
  );
  if (ghWorkModel && ghWorkModel.text.includes('Location: Hybrid · Berlin')) {
    pass('normalizeGreenhouseJob appends offices[] to a work-model-only location.name');
  } else {
    fail(`normalizeGreenhouseJob work-model location => ${JSON.stringify(ghWorkModel)}`);
  }

  const ghNulls = [
    normalizeGreenhouseJob(null, 'https://x/1'),
    normalizeGreenhouseJob({}, 'https://x/1'),
    normalizeGreenhouseJob({ title: 'X', content: '<p> </p>' }, 'https://x/1'),
  ];
  if (ghNulls.every((v) => v === null)) pass('normalizeGreenhouseJob returns null without a description body');
  else fail(`normalizeGreenhouseJob nulls => ${JSON.stringify(ghNulls)}`);

  // normalizeLeverJob — `lists` carries the labeled sections (Requirements,
  // etc.) as separate HTML blocks; dropping them loses half the JD.
  const lever = normalizeLeverJob(
    {
      text: 'Site Reliability Engineer',
      descriptionPlain: 'Keep it up.',
      lists: [
        { text: 'Requirements', content: '&lt;li&gt;Linux&lt;/li&gt;&lt;li&gt;Kubernetes&lt;/li&gt;' },
        { text: 'Nice to have', content: '&lt;li&gt;Rust&lt;/li&gt;' },
      ],
      additionalPlain: 'Our vision is to build a new financial ecosystem',
      categories: { location: 'Austin, TX', team: 'Infrastructure' },
    },
    'https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555',
  );
  // Position, not just presence: `.includes()` alone stays green if the three
  // body pieces are reordered, and the order is the contract — compactText
  // truncates the TAIL, so a lowered --max-chars has to drop the boilerplate
  // and keep the requirements, not the other way round. Each ordering compare
  // is guarded by the matching includes() above it, because indexOf returns
  // -1 for an absent needle and -1 sorts before every real index.
  const leverAt = (needle) => (lever ? lever.text.indexOf(needle) : -1);

  if (lever
      && lever.title === 'Site Reliability Engineer'
      && lever.text.includes('Location: Austin, TX')
      && lever.text.includes('Team: Infrastructure')
      && lever.text.includes('Keep it up.')
      && lever.text.includes('Requirements')
      && lever.text.includes('- Kubernetes')
      && lever.text.includes('Nice to have')
      && lever.text.includes('- Rust')
      && leverAt('Keep it up.') < leverAt('Requirements')) {
    pass('normalizeLeverJob appends the labeled lists after the main description');
  } else {
    fail(`normalizeLeverJob => ${JSON.stringify(lever)}`);
  }

  if (lever
      && lever.text.includes('Our vision is to build a new financial ecosystem')
      && leverAt('Nice to have') < leverAt('Our vision is to build a new financial ecosystem')) {
    pass('normalizeLeverJob appends the additional plain text after the labeled lists.');
  } else {
    fail(`normalizeLeverJob  => ${JSON.stringify(lever)}`);
  }

  const leverNulls = [
    normalizeLeverJob(null, 'https://x/1'),
    normalizeLeverJob({}, 'https://x/1'),
    normalizeLeverJob({ text: 'X', descriptionPlain: '  ', lists: [] }, 'https://x/1'),
  ];
  if (leverNulls.every((v) => v === null)) pass('normalizeLeverJob returns null without a body or lists');
  else fail(`normalizeLeverJob nulls => ${JSON.stringify(leverNulls)}`);

  // The text cap applies on every ATS path, not just Workday.
  const apiCapped = [
    normalizeAshbyJob({ jobs: [{ id: 'x', title: 'X', descriptionPlain: 'word '.repeat(5000) }] }, 'x', 'https://x/1', 400),
    normalizeGreenhouseJob({ title: 'X', content: `<p>${'word '.repeat(5000)}</p>` }, 'https://x/1', 400),
    normalizeLeverJob({ text: 'X', descriptionPlain: 'word '.repeat(5000) }, 'https://x/1', 400),
  ];
  if (apiCapped.every((v) => v && v.text.length <= 401)) pass('every ATS normalizer honors the text cap');
  else fail(`normalizer caps => ${JSON.stringify(apiCapped.map((v) => v && v.text.length))}`);

  // fetchJdViaKnownApi — the dispatch gate is pure: a host outside
  // JD_TEXT_API_ATS returns null WITHOUT a network call, which is what lets a
  // caller fall through to the browser path rather than hang on an unknown host.
  const notCovered = await Promise.all([
    fetchJdViaKnownApi('https://example.com/careers/1'),
    fetchJdViaKnownApi('https://www.linkedin.com/jobs/view/4123456789'),
    fetchJdViaKnownApi('not a url'),
    fetchJdViaKnownApi(''),
  ]);
  if (notCovered.every((v) => v === null)) {
    pass('fetchJdViaKnownApi returns null for a host with no JD-bearing API');
  } else {
    fail(`fetchJdViaKnownApi non-covered => ${JSON.stringify(notCovered)}`);
  }

  // resolveAtsApi carries a per-ATS timeout for the APIs that need one (Ashby:
  // 20 s, liveness-api.mjs:113). Both real callers pass an explicit 15 s, so
  // without this the dispatch silently shortens Ashby to a budget liveness
  // itself would not accept. Asserted by capturing the abort timer rather than
  // by waiting: fetch is stubbed to fail fast, so nothing here touches the
  // network. Both globals are restored in `finally` — a throw in between would
  // otherwise leave the rest of the suite running against the stubs.
  const realFetch = globalThis.fetch;
  const realSetTimeout = globalThis.setTimeout;
  /** @type {number[]} */
  let abortDelays = [];
  /** @type {Record<string, number[]>} */
  const budgets = {};
  try {
    globalThis.setTimeout = (/** @type {any} */ fn, /** @type {any} */ ms, /** @type {any[]} */ ...rest) => {
      abortDelays.push(ms);
      return realSetTimeout(fn, ms, ...rest);
    };
    globalThis.fetch = async () => /** @type {any} */ ({ ok: false, status: 503 });
    // Own list rather than ATS_URL_SHAPES: that const is declared further down
    // and would be in its temporal dead zone here.
    const TIMEOUT_PROBES = [
      ['greenhouse', 'https://job-boards.greenhouse.io/acme/jobs/12345'],
      ['lever', 'https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555'],
      ['ashby', 'https://jobs.ashbyhq.com/acme/some-job-id'],
      ['workday', 'https://acme.wd5.myworkdayjobs.com/External/job/Seattle-WA/Engineer_R1234'],
    ];
    for (const [ats, url] of TIMEOUT_PROBES) {
      abortDelays = [];
      await fetchJdViaKnownApi(url, 12_000, 15_000);
      budgets[ats] = abortDelays;
    }
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
  }
  if (budgets.ashby?.includes(20_000)
      && !budgets.ashby?.includes(15_000)
      && budgets.greenhouse?.includes(15_000)
      && budgets.lever?.includes(15_000)
      && budgets.workday?.includes(15_000)) {
    pass("fetchJdViaKnownApi honors resolveAtsApi's per-ATS timeout (Ashby 20s) over the caller's default");
  } else {
    fail(`fetchJdViaKnownApi timeouts => ${JSON.stringify(budgets)}`);
  }

  // Drift guard on the routing table. fetchJdViaKnownApi switches on
  // resolveAtsApi(url).ats, and JD_TEXT_API_ATS is the gate in front of that
  // switch — so the two agree only as long as the ats ids match the ones
  // liveness-api actually emits. Rename an id on either side and every posting
  // for that ATS starts falling through to the browser silently: no error, no
  // empty JD, just a slow path and a token bill. Nothing else reddens on that,
  // which is why this is asserted directly.
  const ATS_URL_SHAPES = [
    ['greenhouse', 'https://job-boards.greenhouse.io/acme/jobs/12345'],
    ['lever', 'https://jobs.lever.co/acme/11111111-2222-3333-4444-555555555555'],
    ['ashby', 'https://jobs.ashbyhq.com/acme/some-job-id'],
    ['workday', 'https://acme.wd5.myworkdayjobs.com/External/job/Seattle-WA/Engineer_R1234'],
  ];
  const routed = ATS_URL_SHAPES.map(([ats, url]) => {
    const resolved = resolveAtsApi(url);
    return { ats, got: resolved && resolved.ats, gated: JD_TEXT_API_ATS.has(ats) };
  });
  const fetcherIds = Object.keys(JD_FETCHERS).sort().join(',');
  const gatedIds = [...JD_TEXT_API_ATS].sort().join(',');
  if (fetcherIds === gatedIds && Object.values(JD_FETCHERS).every((f) => typeof f === 'function')) {
    pass('JD_FETCHERS covers exactly JD_TEXT_API_ATS (a dropped fetcher cannot go unnoticed)');
  } else {
    fail(`JD_FETCHERS keys => ${fetcherIds} vs JD_TEXT_API_ATS => ${gatedIds}`);
  }

  if (routed.every((r) => r.got === r.ats && r.gated)) {
    pass('every JD_TEXT_API_ATS id is the id resolveAtsApi emits for that ATS (routing cannot drift)');
    // Routing ids agreeing with resolveAtsApi is only half the guarantee: that
    // check never touches the dispatcher, so losing a fetcher entry leaves it
    // green. JD_FETCHERS' keys ARE the dispatcher, so comparing the two sets
    // is what actually reddens on a dropped ATS.
  } else {
    fail(`JD_TEXT_API_ATS routing drift => ${JSON.stringify(routed)}`);
  }

  // fetchAshbyJd is the one fetcher that needs a field off resolveAtsApi beyond
  // apiUrl: Ashby's API is org-level, so the posting is picked out of the board
  // by parts.jobId. If that field is ever renamed or stops being populated the
  // lookup gets an empty id, matches nothing, and returns null — which reads
  // as "no JD here" and falls back to the browser, rather than as a bug.
  const ashbyParts = resolveAtsApi('https://jobs.ashbyhq.com/acme/ABC-123');
  if (ashbyParts && ashbyParts.parts && ashbyParts.parts.jobId === 'ABC-123') {
    pass('resolveAtsApi populates parts.jobId for an Ashby posting (fetchAshbyJd selects on it)');
  } else {
    fail(`resolveAtsApi ashby parts => ${JSON.stringify(ashbyParts)}`);
  }

  // A Lever list block with no heading still contributes its content: the
  // heading is optional in the payload, and dropping the whole block when it is
  // missing would silently truncate the JD.
  const headless = normalizeLeverJob(
    { text: 'X', descriptionPlain: 'Body.', lists: [{ content: '&lt;li&gt;Unlabeled item&lt;/li&gt;' }] },
    'https://jobs.lever.co/acme/x',
  );
  if (headless && headless.text.includes('- Unlabeled item')) {
    pass('normalizeLeverJob keeps a list block that has no heading');
  } else {
    fail(`normalizeLeverJob headless list => ${JSON.stringify(headless)}`);
  }

  // normalizeListing — resolve relatives, drop nav/short labels, dedup, cap
  const anchors = [
    { href: '/jobs/1', label: 'Staff Engineer' },
    { href: 'https://x/jobs/1', label: 'Staff Engineer (dupe URL after resolve)' }, // different label, but…
    { href: '/jobs/2', label: 'Careers' },       // nav stopword → dropped
    { href: '/jobs/3', label: 'AI' },             // too short → dropped
    { href: 'javascript:void(0)', label: 'Broken Protocol Role' }, // non-http → dropped
    { href: '/jobs/4', label: 'ML Platform Lead' },
  ];
  const listed = normalizeListing(anchors, 'https://x/careers', 10);
  const urls = listed.jobs.map((j) => j.url);
  if (listed.url === 'https://x/careers' &&
      listed.jobs.length === 2 &&
      urls.includes('https://x/jobs/1') && urls.includes('https://x/jobs/4') &&
      listed.jobs[0].title === 'Staff Engineer') {
    pass('normalizeListing resolves relative URLs, dedups, drops nav/short/non-http anchors');
  } else {
    fail(`normalizeListing => ${JSON.stringify(listed.jobs)}`);
  }

  // dedup by resolved URL
  const dup = normalizeListing(
    [{ href: '/j/1', label: 'Role A' }, { href: 'https://x/j/1', label: 'Role A again' }],
    'https://x/careers',
  );
  if (dup.jobs.length === 1) pass('normalizeListing dedups by resolved URL');
  else fail(`normalizeListing dedup => ${JSON.stringify(dup.jobs)}`);

  // max cap
  const many = normalizeListing(
    Array.from({ length: 20 }, (_, i) => ({ href: `/j/${i}`, label: `Role Number ${i}` })),
    'https://x/careers',
    5,
  );
  if (many.jobs.length === 5) pass('normalizeListing respects the max cap');
  else fail(`normalizeListing max => ${many.jobs.length}`);

} catch (e) {
  fail(`browser-extract tests crashed: ${e.message}`);
}
