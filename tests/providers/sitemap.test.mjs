// tests/providers/sitemap.test.mjs — offline coverage for the generic employer
// job-sitemap provider (#6626). The urlset fixture is a recorded live employer
// careers sitemap (2026-11-06), trimmed and with its host rewritten to
// careers.example.com. No test touches the network: robots.txt verdicts come
// from an injected gate and every body from a ctx.fetchText stub.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from '../helpers.mjs';

console.log('\nProvider — sitemap');

const fixture = (name) => readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8');
const JOB_PATH = '^/jobs/(?<posting_id>\\d+)/(?<slug>[^/]+)/?$';
const ENTRY = {
  name: 'Acme',
  provider: 'sitemap',
  careers_url: 'https://careers.example.com/jobs/',
  sitemap: { url: 'https://careers.example.com/sitemap.xml', job_path: JOB_PATH },
};
const allowAll = async () => ({ allowed: true, code: 'robots_allowed', reason: 'permits' });

/** Capture console.error lines while `fn` runs. */
async function captureWarnings(fn) {
  const lines = [];
  const orig = console.error;
  console.error = (...args) => { lines.push(args.join(' ')); };
  try { return { result: await fn(), lines }; } finally { console.error = orig; }
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/sitemap.mjs')).href);
  const { resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);
  const sitemap = mod.default;
  const make = (robotsGate = allowAll) => mod.createSitemapProvider({ robotsGate });

  if (sitemap.id === 'sitemap') pass('sitemap.id is "sitemap"');
  else fail(`sitemap.id=${JSON.stringify(sitemap.id)}`);

  // ── detect(): explicit-only ──────────────────────────────────────
  const hit = sitemap.detect(ENTRY);
  if (hit?.url === 'https://careers.example.com/sitemap.xml') pass('detect returns the configured sitemap URL for provider:sitemap');
  else fail(`detect=${JSON.stringify(hit)}`);

  if (sitemap.detect({ name: 'X', careers_url: 'https://careers.example.com/sitemap.xml' }) === null) {
    pass('detect is explicit-only (no provider:sitemap → null)');
  } else fail('detect claimed an entry without provider:sitemap');

  for (const url of [
    'http://careers.example.com/sitemap.xml',
    'https://127.0.0.1/sitemap.xml',
    'https://[::1]/sitemap.xml',
    'https://localhost/sitemap.xml',
    'https://jobs.internal/sitemap.xml',
    'https://singlelabel/sitemap.xml',
    'https://user:pass@careers.example.com/sitemap.xml',
    'https://careers.example.com:8443/sitemap.xml',
    'not a url',
    null,
    42,
  ]) {
    let out;
    try { out = sitemap.detect({ name: 'Bad', provider: 'sitemap', sitemap: { url, job_path: JOB_PATH } }); }
    catch (err) { out = `threw ${err.message}`; }
    if (out === null) pass(`detect rejects unsafe sitemap.url: ${String(url)}`);
    else fail(`detect accepted ${String(url)}: ${JSON.stringify(out)}`);
  }
  if (sitemap.detect({ provider: 'sitemap' }) === null && sitemap.detect(null) === null) {
    pass('detect returns null on a missing sitemap block / null entry');
  } else fail('detect did not return null on missing config');

  const routed = resolveProvider(ENTRY, new Map([['sitemap', sitemap]]));
  if (routed?.provider === sitemap) pass('registry resolves explicit provider:sitemap entries');
  else fail(`registry route=${JSON.stringify(routed)}`);

  // ── config validation ───────────────────────────────────────────
  const configErrors = [
    [{ ...ENTRY, sitemap: { url: ENTRY.sitemap.url } }, /job_path is required/],
    [{ ...ENTRY, sitemap: { url: ENTRY.sitemap.url, job_path: '^/jobs/(\\d+)/' } }, /\(\?<slug>/],
    [{ ...ENTRY, sitemap: { url: ENTRY.sitemap.url, job_path: '([' } }, /not a valid regex/],
    [{ ...ENTRY, sitemap: { url: 'https://careers.example.com/sitemap.xml.gz', job_path: JOB_PATH } }, /gzipped/],
    [{ ...ENTRY, sitemap: { url: 'http://careers.example.com/sitemap.xml', job_path: JOB_PATH } }, /public https URL/],
  ];
  for (const [entry, re] of configErrors) {
    let calls = 0;
    let gateCalls = 0;
    let message = '';
    try {
      await mod.createSitemapProvider({ robotsGate: async () => { gateCalls++; return { allowed: true }; } })
        .fetch(entry, { fetchText: async () => { calls++; return ''; } });
    } catch (err) { message = err.message; }
    if (re.test(message) && calls === 0 && gateCalls === 0) pass(`config error before any request: ${re}`);
    else fail(`config ${re}: message=${message} fetchCalls=${calls} gateCalls=${gateCalls}`);
  }

  if (mod.parseSitemapConfig({ ...ENTRY, sitemap: { ...ENTRY.sitemap, index_filter: '' } }).indexFilter === null) {
    pass('a blank index_filter (the portals.example.yml default) means no filter');
  } else fail('blank index_filter was compiled');

  // ── titleFromSlug ───────────────────────────────────────────────
  const titles = [
    ['sr-consultant-value-excellence', 'Sr Consultant Value Excellence'],
    ['staff-software-engineer-platform-cryptography', 'Staff Software Engineer Platform Cryptography'],
    ['senior-staff-inbound-product-manager-agentic-ai-platform-moveworks', 'Senior Staff Inbound Product Manager Agentic AI Platform Moveworks'],
    ['data-scientist--uk', 'Data Scientist - UK'],
    ['%E2%9C%93-bad-%E0%A4', '%E2%9C%93 Bad %E0%A4'],
  ];
  for (const [slug, want] of titles) {
    const got = mod.titleFromSlug(slug);
    if (got === want) pass(`titleFromSlug(${slug}) → ${want}`);
    else fail(`titleFromSlug(${slug}) = ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }

  // ── parseSitemapDocument: empty vs broken ───────────────────────
  if (mod.parseSitemapDocument('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>').locs.length === 0) {
    pass('an empty <urlset> parses to zero URLs');
  } else fail('empty sitemap handling changed');

  const truncated = [
    '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    '<?xml version="1.0"?><urlset><url><loc>https://careers.example.com/jobs/1/a/</loc></url>',
    '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://careers.example.com/s.xml</loc></sitemap>',
  ];
  let truncatedCount = 0;
  for (const body of truncated) {
    try { mod.parseSitemapDocument(body); } catch (err) { if (/truncated response/.test(err.message)) truncatedCount++; }
  }
  const selfClosing = mod.parseSitemapDocument('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>');
  if (truncatedCount === 3 && selfClosing.kind === 'urlset' && selfClosing.locs.length === 0) {
    pass('a root without its closing tag throws as truncated; a self-closing empty <urlset/> is a valid empty board');
  } else fail(`truncated count=${truncatedCount} selfClosing=${JSON.stringify(selfClosing)}`);

  let blankCount = 0;
  for (const body of ['', '   \n', null]) {
    try { mod.parseSitemapDocument(body); } catch (err) { if (/empty response/.test(err.message)) blankCount++; }
  }
  let blankFetchErr = '';
  try { await make().fetch(ENTRY, { fetchText: async () => '' }); } catch (err) { blankFetchErr = err.message; }
  if (blankCount === 3 && /empty response/.test(blankFetchErr)) pass('a zero-byte or blank sitemap response throws instead of reading as an empty board');
  else fail(`blank handling count=${blankCount} fetchErr=${blankFetchErr}`);

  let challengeThrew = false;
  try { mod.parseSitemapDocument('<!doctype html><title>Just a moment...</title>'); }
  catch (err) { challengeThrew = /expected an XML <urlset> or <sitemapindex>/.test(err.message); }
  if (challengeThrew) pass('a bot-challenge / HTML page throws instead of reading as zero jobs');
  else fail('HTML page did not throw');

  const entityDoc = mod.parseSitemapDocument('<urlset><url><loc>https://careers.example.com/jobs/1/r%26d-lead/?a=1&amp;b=2</loc></url><url><loc><![CDATA[https://careers.example.com/jobs/2/cdata-role/]]></loc></url></urlset>');
  if (entityDoc.locs[0] === 'https://careers.example.com/jobs/1/r%26d-lead/?a=1&b=2'
      && entityDoc.locs[1] === 'https://careers.example.com/jobs/2/cdata-role/') {
    pass('<loc> XML entities are decoded and CDATA is unwrapped');
  } else fail(`entity parse=${JSON.stringify(entityDoc)}`);

  // ── fetch(): recorded urlset ────────────────────────────────────
  const calls = [];
  const gateUrls = [];
  const jobs = await make(async (url) => { gateUrls.push(url); return allowAll(); }).fetch(ENTRY, {
    fetchText: async (url, opts) => { calls.push({ url, opts }); return fixture('sitemap-employer-urlset.xml'); },
  });
  const first = jobs[0];
  if (jobs.length === 10
      && first.title === 'Associate Customer Success Manager French'
      && first.url === 'https://careers.example.com/jobs/744000159261519/associate-customer-success-manager-french/'
      && first.externalId === '744000159261519'
      && !('requisitionId' in first)
      && first.company === 'Acme' && first.location === ''
      && jobs.every((j) => !('postedAt' in j))) {
    pass('recorded urlset: 10 job rows from 22 URLs, slug titles, posting id → externalId, lastmod not used as postedAt');
  } else fail(`urlset jobs=${JSON.stringify(jobs.slice(0, 2))} (n=${jobs.length})`);

  if (calls.length === 1 && calls[0].url === ENTRY.sitemap.url
      && calls[0].opts?.redirect === 'error'
      && calls[0].opts?.maxBytes === mod.MAX_SITEMAP_BYTES
      && mod.MAX_SITEMAP_BYTES === 52_428_800) {
    pass('one redirect-blocked sitemap request with the protocol 50 MB body cap');
  } else fail(`calls=${JSON.stringify(calls)}`);

  if (gateUrls.length === 1 && gateUrls[0] === ENTRY.sitemap.url) pass('robots.txt is consulted for the sitemap URL before fetching');
  else fail(`gate urls=${JSON.stringify(gateUrls)}`);

  // req_id group → requisitionId; same-host rule; dedup on posting id.
  const reqJobs = mod.jobsFromLocs([
    'https://careers.example.com/job/R-100/finance-manager',
    'https://careers.example.com/job/R-100/finance-manager?utm=x',
    'https://other.example.com/job/R-200/spoofed',
    'https://careers.example.com.evil.example/job/R-300/suffix-spoof',
    'http://careers.example.com/job/R-400/plain-http',
    'https://careers.example.com/about/',
  ], { url: new URL(ENTRY.sitemap.url), jobPath: /^\/job\/(?<req_id>R-\d+)\/(?<slug>[^/]+)$/ }, 'Acme');
  if (reqJobs.length === 2 && reqJobs[0].requisitionId === 'R-100' && !('externalId' in reqJobs[0])
      && reqJobs.every((j) => j.url.startsWith('https://careers.example.com/job/R-100/'))) {
    pass('req_id → requisitionId; off-host, suffix-spoofed, http and non-job URLs are dropped');
  } else fail(`reqJobs=${JSON.stringify(reqJobs)}`);

  // ── robots.txt refusal ──────────────────────────────────────────
  let robotsCalls = 0;
  let robotsErr = null;
  try {
    await make(async () => ({ allowed: false, code: 'robots_disallowed', reason: 'disallows /sitemap.xml for career-ops' }))
      .fetch(ENTRY, { fetchText: async () => { robotsCalls++; return ''; } });
  } catch (err) { robotsErr = err; }
  if (robotsErr?.code === 'robots_disallowed' && /robots\.txt disallows/.test(robotsErr.message) && robotsCalls === 0) {
    pass('a sitemap robots.txt disallows is refused with a named error and no fetch');
  } else fail(`robots refusal err=${robotsErr?.message} calls=${robotsCalls}`);

  // ── URL scheme change fails loud ────────────────────────────────
  let schemeErr = '';
  try {
    await make().fetch({ ...ENTRY, sitemap: { ...ENTRY.sitemap, job_path: '^/careers/(?<slug>[^/]+)$' } },
      { fetchText: async () => fixture('sitemap-employer-urlset.xml') });
  } catch (err) { schemeErr = err.message; }
  if (/22 sitemap URLs but none matched job_path/.test(schemeErr)) pass('a sitemap whose URLs match no job_path throws (not a silent empty board)');
  else fail(`scheme-change err=${schemeErr}`);

  const emptyJobs = await make().fetch(ENTRY, { fetchText: async () => '<?xml version="1.0"?><urlset></urlset>' });
  if (Array.isArray(emptyJobs) && emptyJobs.length === 0) pass('an empty <urlset> returns []');
  else fail('empty urlset did not return []');

  // ── sitemap index ───────────────────────────────────────────────
  const child1 = '<urlset><url><loc>https://careers.example.com/jobs/1/strategy-manager/</loc></url></urlset>';
  const child2 = '<urlset><url><loc>https://careers.example.com/jobs/2/bizops-lead/</loc></url><url><loc>https://careers.example.com/jobs/1/strategy-manager/</loc></url></urlset>';
  const indexCalls = [];
  const indexCtx = {
    fetchText: async (url, opts) => {
      indexCalls.push({ url, opts });
      if (url.endsWith('/sitemap.xml')) return fixture('sitemap-employer-index.xml');
      if (url.endsWith('/sitemap-jobs-1.xml')) return child1;
      if (url.endsWith('/sitemap-jobs-2.xml')) return child2;
      throw new Error(`unexpected ${url}`);
    },
  };
  const { result: indexJobs, lines: indexWarn } = await captureWarnings(() => make().fetch(
    { ...ENTRY, sitemap: { ...ENTRY.sitemap, index_filter: 'sitemap-jobs' } }, indexCtx));
  const indexUrls = indexCalls.map((c) => c.url);
  if (indexJobs.length === 2
      && indexUrls.length === 3
      && !indexUrls.some((u) => u.includes('evil') || u.includes('pages') || u.endsWith('.gz'))
      && indexCalls.every((c) => c.opts?.redirect === 'error')
      && indexWarn.some((l) => /gzipped child sitemap/.test(l))) {
    pass('sitemapindex: index_filter, same-host and .gz rules applied; children deduped; every request redirect-blocked');
  } else fail(`index jobs=${indexJobs.length} urls=${JSON.stringify(indexUrls)} warn=${JSON.stringify(indexWarn)}`);

  // max_sitemaps truncation is reported, never silent.
  const { result: cappedJobs, lines: capWarn } = await captureWarnings(() => make().fetch(
    { ...ENTRY, sitemap: { ...ENTRY.sitemap, index_filter: 'sitemap-jobs', max_sitemaps: 1 } }, indexCtx));
  if (cappedJobs.length === 1 && capWarn.some((l) => /lists 2 child sitemaps; read the first 1, raise sitemap\.max_sitemaps/.test(l))) {
    pass('max_sitemaps caps child fetches and warns naming the knob');
  } else fail(`capped=${cappedJobs.length} warn=${JSON.stringify(capWarn)}`);

  // Nested index and robots-denied child are skipped and reported.
  let nestedErr = '';
  const { lines: nestedWarn } = await captureWarnings(() => make(async (url) => (
    url.endsWith('/sitemap-jobs-2.xml')
      ? { allowed: false, code: 'robots_disallowed', reason: 'disallows /sitemap-jobs-2.xml for career-ops' }
      : allowAll()
  )).fetch({ ...ENTRY, sitemap: { ...ENTRY.sitemap, index_filter: 'sitemap-jobs' } }, {
    fetchText: async (url) => {
      if (url.endsWith('/sitemap.xml')) return fixture('sitemap-employer-index.xml');
      if (url.endsWith('/sitemap-jobs-1.xml')) return '<sitemapindex><sitemap><loc>https://careers.example.com/x.xml</loc></sitemap></sitemapindex>';
      throw new Error(`unexpected ${url}`);
    },
  }).catch((err) => { nestedErr = err.message; }));
  if (/none of the 2 child sitemaps read could be used/.test(nestedErr)
      && nestedWarn.some((l) => /nested sitemap index/.test(l))
      && nestedWarn.some((l) => /skipped child sitemap .*sitemap-jobs-2\.xml: robots\.txt disallows/.test(l))) {
    pass('nested index and robots-denied children are skipped with warnings, and an index with no readable child throws');
  } else fail(`nested err=${nestedErr} warn=${JSON.stringify(nestedWarn)}`);

  let typoErr = '';
  let typoCalls = 0;
  try {
    await make().fetch({ ...ENTRY, sitemap: { ...ENTRY.sitemap, index_filter: 'sitemap-jbos' } }, {
      fetchText: async (url) => { typoCalls++; return fixture('sitemap-employer-index.xml'); },
    });
  } catch (err) { typoErr = err.message; }
  if (/lists 5 child sitemaps but none is usable .*index_filter sitemap-jbos/.test(typoErr) && typoCalls === 1) {
    pass('an index_filter that matches no child throws instead of returning an empty board');
  } else fail(`typo err=${typoErr} calls=${typoCalls}`);

  let emptyIndexErr = '';
  try { await make().fetch(ENTRY, { fetchText: async () => '<?xml version="1.0"?><sitemapindex></sitemapindex>' }); }
  catch (err) { emptyIndexErr = err.message; }
  if (/lists no child sitemaps/.test(emptyIndexErr)) pass('an index with no <sitemap> entries throws (only an empty <urlset> is an empty board)');
  else fail(`empty sitemapindex err=${emptyIndexErr}`);

  const stripCases = [
    ['a<!-- x -->b', 'ab'],
    ['a<!--<!-- x -->-->b', 'a-->b'],
    ['a<!-- x --><!-- y -->b', 'ab'],
    ['<<!-- -->!-- x', '<!-- x'],
    ['a<!-- never closed <urlset>', 'a'],
  ];
  const stripOk = stripCases.every(([input, want]) => mod.stripXmlComments(input) === want);
  if (stripOk) pass('stripXmlComments removes comments in one linear pass; an unterminated comment drops the rest');
  else fail(`stripXmlComments=${JSON.stringify(stripCases.map(([i]) => mod.stripXmlComments(i)))}`);

  let commentErr = '';
  try { mod.parseSitemapDocument('<urlset><url><loc>https://careers.example.com/jobs/1/a/</loc></url><!-- </urlset> -->'); }
  catch (err) { commentErr = err.message; }
  const commented = mod.parseSitemapDocument('<urlset><!-- <url><loc>https://careers.example.com/jobs/9/ghost/</loc></url> --><url><loc>https://careers.example.com/jobs/1/a/</loc></url></urlset>');
  if (/truncated response/.test(commentErr) && commented.locs.length === 1 && commented.locs[0].endsWith('/jobs/1/a/')) {
    pass('XML comments are ignored: a commented-out </urlset> does not close a truncated root, a commented-out <url> is not an entry');
  } else fail(`comment err=${commentErr} commented=${JSON.stringify(commented)}`);

  // A failing child keeps the others and is reported.
  const { result: partialJobs, lines: partialWarn } = await captureWarnings(() => make().fetch(
    { ...ENTRY, sitemap: { ...ENTRY.sitemap, index_filter: 'sitemap-jobs' } }, {
      fetchText: async (url) => {
        if (url.endsWith('/sitemap.xml')) return fixture('sitemap-employer-index.xml');
        if (url.endsWith('/sitemap-jobs-1.xml')) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
        return child2;
      },
    }));
  if (partialJobs.length === 2 && partialWarn.some((l) => /sitemap-jobs-1\.xml failed .*missing from this scan/.test(l))) {
    pass('a failing child sitemap is reported and the rest are kept');
  } else fail(`partial=${partialJobs.length} warn=${JSON.stringify(partialWarn)}`);

  // ── 50,000-URL per-file limit ───────────────────────────────────
  const big = `<urlset>${Array.from({ length: 50_002 }, (_, i) => `<url><loc>https://careers.example.com/jobs/${i}/role-${i}/</loc></url>`).join('')}</urlset>`;
  const { result: bigJobs, lines: bigWarn } = await captureWarnings(() => make().fetch(ENTRY, { fetchText: async () => big }));
  if (bigJobs.length === 50_000 && bigWarn.some((l) => /50002 URLs, over the protocol's 50000-per-file limit/.test(l))) {
    pass('a file over the protocol 50,000-URL limit is capped with a warning');
  } else fail(`big=${bigJobs.length} warn=${JSON.stringify(bigWarn)}`);

  // ── parseJobPostingJsonLd ───────────────────────────────────────
  const detail = mod.parseJobPostingJsonLd(fixture('sitemap-employer-detail.html'));
  if (detail.title === 'Senior Strategy & Operations Manager'
      && detail.location === 'Santa Clara, CA, US'
      && /Own the operating plan & business reviews\./.test(detail.description || '')
      && detail.postedAt === Date.parse('2026-10-30')) {
    pass('JSON-LD JobPosting (@graph) → title, location, description, datePosted; entities decoded');
  } else fail(`detail=${JSON.stringify(detail)}`);
  if (Object.keys(mod.parseJobPostingJsonLd('<script type="application/ld+json">oops</script>')).length === 0
      && Object.keys(mod.parseJobPostingJsonLd('<!doctype html><title>Just a moment...</title>')).length === 0) {
    pass('malformed or challenge detail pages yield no enrichment');
  } else fail('malformed detail handling changed');

  // ── fetchDetails: only titles the scan keeps, bounded, paced, fail-open ──
  const detailCalls = [];
  const sleeps = [];
  const detailGate = [];
  const detailEntry = { ...ENTRY, sitemap: { ...ENTRY.sitemap, fetchDetails: true, detailLimit: 2 } };
  const { result: enriched, lines: enrichWarn } = await captureWarnings(() => make(async (url) => {
    detailGate.push(url);
    return allowAll();
  }).fetch(detailEntry, {
    titleWanted: (title) => /manager|engineer|executive/i.test(title),
    sleep: async (ms) => { sleeps.push(ms); },
    fetchText: async (url, opts) => {
      if (url === ENTRY.sitemap.url) return fixture('sitemap-employer-urlset.xml');
      detailCalls.push({ url, opts });
      if (url.includes('744000158473789')) throw new Error('HTTP 503');
      return fixture('sitemap-employer-detail.html');
    },
  }));
  const kept = enriched.filter((j) => j.title === 'Senior Strategy & Operations Manager');
  const detailUrls = [...new Set(detailCalls.map((c) => c.url))];
  if (detailUrls.length === 2
      && detailCalls.length === 4 // the 503 is retried twice by fetchTextWithRetry, then kept fail-open
      && detailCalls.every((c) => c.opts?.redirect === 'error')
      && detailUrls[0].includes('744000159261519')
      && kept.length === 1 && kept[0].location === 'Santa Clara, CA, US'
      && enriched.length === 10
      && enrichWarn.some((l) => /qualify for detail enrichment; enriched 2, raise sitemap\.detailLimit/.test(l))
      && detailGate.filter((u) => u.includes('/jobs/')).length === 2) {
    pass('fetchDetails enriches only title-filter survivors, capped at detailLimit, robots-checked, warns on the cap');
  } else fail(`detailCalls=${JSON.stringify(detailCalls.map((c) => c.url))} kept=${kept.length} warn=${JSON.stringify(enrichWarn)}`);

  // Default (no fetchDetails) and the probe never fetch detail pages.
  const probeCalls = [];
  const probed = await make().fetch({ ...detailEntry }, {
    maxPages: 1,
    fetchText: async (url) => { probeCalls.push(url); return fixture('sitemap-employer-urlset.xml'); },
  });
  if (probeCalls.length === 1 && probed.length === 10) pass('probe (ctx.maxPages) makes one list request and no detail requests');
  else fail(`probe calls=${JSON.stringify(probeCalls)}`);

  const probeErr = new Error('budget');
  let probeSeen = null;
  try {
    await captureWarnings(() => make().fetch({ ...ENTRY, sitemap: { ...ENTRY.sitemap, index_filter: 'sitemap-jobs' } }, {
      maxPages: 1,
      fetchText: async (url) => {
        if (url.endsWith('/sitemap.xml')) return fixture('sitemap-employer-index.xml');
        throw probeErr;
      },
    }));
  } catch (err) { probeSeen = err; }
  if (probeSeen === probeErr) pass('a ctx.fetch* rejection during a probe propagates unwrapped');
  else fail(`probe error=${probeSeen?.message}`);

  // A denied detail page keeps its sitemap row.
  const deniedCalls = [];
  const { result: deniedJobs, lines: deniedWarn } = await captureWarnings(() => make(async (url) => (
    url.includes('/jobs/') ? { allowed: false, code: 'robots_disallowed', reason: 'disallows' } : allowAll()
  )).fetch(detailEntry, {
    fetchText: async (url) => { deniedCalls.push(url); return fixture('sitemap-employer-urlset.xml'); },
  }));
  if (deniedCalls.length === 1 && deniedJobs.length === 10 && deniedWarn.some((l) => /robots\.txt disallows 2 detail page/.test(l))) {
    pass('robots-denied detail pages are not fetched; rows keep their sitemap title');
  } else fail(`denied calls=${JSON.stringify(deniedCalls)} warn=${JSON.stringify(deniedWarn)}`);
} catch (err) {
  fail(`sitemap provider tests crashed: ${err.stack || err.message}`);
}
