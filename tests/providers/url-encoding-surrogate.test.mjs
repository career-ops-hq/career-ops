// Cross-provider behaviour: each JSON-API provider that builds a job URL from a
// host-controlled id/slug must survive a lone UTF-16 surrogate in that field.
// encodeURIComponent throws URIError on a lone surrogate and a JSON string can
// carry one, so without a guard one malformed posting aborts the whole page's
// parse loop. Each provider routes the value through providers/_safe-url.mjs and
// drops just that posting on a null return.
//
// The helper itself is covered in _safe-url.test.mjs.
import { pass, fail, ROOT } from '../helpers.mjs';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProviders — job-URL encoding tolerates a lone surrogate (drops the one posting, not the page)');

const load = (f) => import(pathToFileURL(join(ROOT, 'providers/' + f)).href);

// A lone high surrogate: what encodeURIComponent rejects, and what a JSON
// string can hold (JSON.parse('"\\uD800x"') keeps it).
const LONE = '\uD800';

// ── Per-provider behaviour ──
// Each case: a batch/record with one lone-surrogate id and one clean one. The
// parse must not throw, must keep the clean job, and must drop the bad one.

/**
 * @param {string} label
 * @param {() => any} run  returns the parsed job list (or throws)
 * @param {(jobs: any[]) => boolean} ok  true when the clean job survived and the bad one is gone
 */
function check(label, run, ok) {
  let jobs;
  try {
    jobs = run();
  } catch (e) {
    fail(`${label}: threw on a lone-surrogate id (${e.constructor.name}: ${e.message})`);
    return;
  }
  if (ok(jobs)) pass(`${label}: drops the lone-surrogate posting, keeps the rest`);
  else fail(`${label}: unexpected result ${JSON.stringify(jobs)}`);
}

try {
  // arbeitsagentur.normalizeJob — refnr is the dedup key; a bad one must yield null.
  const { normalizeJob: aaNormalize } = await load('arbeitsagentur.mjs');
  check(
    'arbeitsagentur.normalizeJob',
    () => [
      aaNormalize({ referenznummer: `${LONE}-bad`, stellenangebotsTitel: 'Bad Refnr' }),
      aaNormalize({ referenznummer: 'ok-123', stellenangebotsTitel: 'Good' }),
    ],
    ([bad, good]) => bad === null && good !== null && good.url.includes('ok-123'),
  );

  // bamboohr.parseBambooHRResponse — .map() over one page.
  const { parseBambooHRResponse } = await load('bamboohr.mjs');
  check(
    'bamboohr.parseBambooHRResponse',
    () => parseBambooHRResponse(
      { result: [{ id: `${LONE}bad`, jobOpeningName: 'Bad Id' }, { id: 5, jobOpeningName: 'Good Id' }] },
      'X', 'https://x.bamboohr.com',
    ),
    (jobs) => jobs.length === 1 && jobs[0].url === 'https://x.bamboohr.com/careers/5',
  );

  // jibeapply.parseJibeapplyResponse — .map().filter(Boolean) over one page.
  const { parseJibeapplyResponse } = await load('jibeapply.mjs');
  const jibeEntry = { name: 'Acme', careers_url: 'https://acme.jibeapply.com/jobs' };
  check(
    'jibeapply.parseJibeapplyResponse',
    () => parseJibeapplyResponse(
      { jobs: [{ title: 'Bad Slug', slug: `${LONE}bad` }, { title: 'Good Slug', slug: 'good-1' }] },
      jibeEntry,
    ),
    (jobs) => jobs.length === 1 && jobs[0].url.endsWith('/good-1'),
  );

  // alibaba.parseAlibabaResponse — for…of over content.datas.
  const { parseAlibabaResponse } = await load('alibaba.mjs');
  check(
    'alibaba.parseAlibabaResponse',
    () => parseAlibabaResponse(
      { content: { datas: [{ name: 'Bad', id: `${LONE}bad` }, { name: 'Good', id: 'g-1' }], totalCount: 2 } },
      'Acme',
    ).jobs,
    (jobs) => jobs.length === 1 && jobs[0].url.includes('g-1'),
  );

  // meituan.parseMeituanResponse — for…of over data.list.
  const { parseMeituanResponse } = await load('meituan.mjs');
  check(
    'meituan.parseMeituanResponse',
    () => parseMeituanResponse(
      { data: { list: [{ name: 'Bad', jobUnionId: `${LONE}bad` }, { name: 'Good', jobUnionId: 'g-1' }], page: { totalCount: 2 } } },
      'Acme',
    ).jobs,
    (jobs) => jobs.length === 1 && jobs[0].url.includes('g-1'),
  );

  // phenom.parseRefineSearch — for…of over refineSearch.data.jobs; jobId is the dedup key.
  const { parseRefineSearch } = await load('phenom.mjs');
  check(
    'phenom.parseRefineSearch',
    () => parseRefineSearch(
      { refineSearch: { totalHits: 2, data: { jobs: [
        { jobId: `${LONE}bad`, title: 'Bad' },
        { jobId: 'g-1', title: 'Good' },
      ] } } },
      { origin: 'https://x.phenom.com', urlPrefix: 'careers' },
    ).rows,
    (rows) => rows.length === 1 && rows[0].id === 'g-1',
  );

  // tkms.parseQuery — for…of over jobs[].data; id is the dedup key.
  const { parseQuery } = await load('tkms.mjs');
  check(
    'tkms.parseQuery',
    () => parseQuery(
      { totalHits: 2, jobs: [
        { data: { id: `${LONE}bad`, title: 'Bad' } },
        { data: { id: 'g-1', title: 'Good' } },
      ] },
      { origin: 'https://x.tkms.com', locale: 'en' },
    ).rows,
    (rows) => rows.length === 1 && rows[0].id === 'g-1',
  );

  // vdab.normalizeJob — id is the dedup key; a bad one must yield null.
  const { normalizeJob: vdabNormalize } = await load('vdab.mjs');
  check(
    'vdab.normalizeJob',
    () => [
      vdabNormalize({ id: { id: `${LONE}bad` }, vacaturefunctie: { naam: 'Bad' } }),
      vdabNormalize({ id: { id: 'g-1' }, vacaturefunctie: { naam: 'Good' } }),
    ],
    ([bad, good]) => bad === null && good !== null && good.url.includes('g-1'),
  );

  // thehub.normalizeHubJob — id is the dedup key (byUrl); a bad one must yield null.
  const { normalizeHubJob } = await load('thehub.mjs');
  check(
    'thehub.normalizeHubJob',
    () => [
      normalizeHubJob({ id: `${LONE}bad`, title: 'Bad' }),
      normalizeHubJob({ id: 'g-1', title: 'Good' }),
    ],
    ([bad, good]) => bad === null && good !== null && good.url.includes('g-1'),
  );

  // manfred.normalizeManfredOffer — slug feeds the URL; a bad one must yield null.
  const { normalizeManfredOffer } = await load('manfred.mjs');
  check(
    'manfred.normalizeManfredOffer',
    () => [
      normalizeManfredOffer({ status: 'ACTIVE', position: 'Bad', id: 5, slug: `${LONE}bad` }),
      normalizeManfredOffer({ status: 'ACTIVE', position: 'Good', id: 6, slug: 'good-1' }),
    ],
    ([bad, good]) => bad === null && good !== null && good.url.includes('good-1'),
  );

  // feishu-jobs.parseFeishuJobsResponse — for…of over data.job_post_list; id feeds the detail URL.
  const { parseFeishuJobsResponse } = await load('feishu-jobs.mjs');
  check(
    'feishu-jobs.parseFeishuJobsResponse',
    () => parseFeishuJobsResponse(
      { data: { count: 2, job_post_list: [
        { id: `${LONE}bad`, title: 'Bad' },
        { id: 'g-1', title: 'Good' },
      ] } },
      'Acme', 'https://acme.jobs.feishu.cn',
    ).jobs,
    (jobs) => jobs.length === 1 && jobs[0].url.includes('g-1'),
  );

  // mokahr.parseMokaHrJobs — for…of over data.jobs; id feeds the SPA #/job/ route.
  const { parseMokaHrJobs } = await load('mokahr.mjs');
  check(
    'mokahr.parseMokaHrJobs',
    () => parseMokaHrJobs(
      { data: { jobs: [
        { id: `${LONE}bad`, title: 'Bad' },
        { id: 'g-1', title: 'Good' },
      ] } },
      'Acme', 'https://app.mokahr.com/social-recruitment/acme/123456',
    ),
    (jobs) => jobs.length === 1 && jobs[0].url.includes('g-1'),
  );
} catch (e) {
  fail(`per-provider surrogate tests crashed: ${e.message}`);
}

// ── Source-level guard ──
// The behaviour cases above cover the current providers. This guards a new one:
// no job-URL line in providers/ may pass a value straight through
// encodeURIComponent.
//
// "job-URL line" = a line that assigns a `url:` property or a `url` variable and
// also calls encodeURIComponent on it. Deliberately narrow: it does not fire on
// config-scoped calls (a portals.yml keyword, a country code, a company slug
// from the entry) or on calls inside their own try/catch, none of which is the
// batch-aborting shape. `safeEncodeURIComponent` does not match — the token is
// the bare builtin, lower-case `e`, with a word boundary before it.
{
  const dir = join(ROOT, 'providers');
  const SHARED_IMPORT = /\bfrom\s*['"]\.\/_safe-url\.mjs['"]/;
  const HELPER_USE = /\bsafeEncodeURIComponent\b/;
  const BARE_ON_URL_LINE = /\burl\s*[:=][^\n]*\bencodeURIComponent\s*\(/;

  // Every provider that routes a job-URL segment through the helper. Each must
  // import _safe-url.mjs and call safeEncodeURIComponent; dropping either is the
  // regression this list catches.
  const CONVERTED = [
    'alibaba.mjs', 'arbeitsagentur.mjs', 'bamboohr.mjs', 'feishu-jobs.mjs', 'jibeapply.mjs',
    'manfred.mjs', 'meituan.mjs', 'mokahr.mjs', 'phenom.mjs', 'thehub.mjs', 'tkms.mjs', 'vdab.mjs',
  ];

  // Bare `encodeURIComponent` on a url line that is reviewed as safe: the value
  // is config-derived or already charset-checked, not a host-controlled field
  // that could abort a batch. Listed with a reason rather than silently skipped.
  const ALLOWLIST = {
    'csod.mjs': 'corpName comes from portals.yml (careers_url), not from the API response',
    '4dayweek.mjs': 'slug is already validated against SLUG_RE, which rejects a surrogate before this line',
  };

  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== '_safe-url.mjs');
  } catch (e) {
    files = null;
    fail(`cannot read ${dir}: ${e.message}`);
  }

  if (files) {
    const read = (f) => {
      try { return readFileSync(join(dir, f), 'utf-8'); } catch (e) { return { err: e.message }; }
    };

    // 1. The converted set stays converted.
    const regressed = [];
    for (const f of CONVERTED) {
      const src = read(f);
      if (typeof src !== 'string') { regressed.push(`${f} (unreadable: ${src.err})`); continue; }
      if (!SHARED_IMPORT.test(src)) regressed.push(`${f} (no longer imports _safe-url.mjs)`);
      else if (!HELPER_USE.test(src)) regressed.push(`${f} (imports _safe-url.mjs but no longer calls safeEncodeURIComponent)`);
    }
    if (regressed.length === 0) pass(`all ${CONVERTED.length} converted providers still import and use safeEncodeURIComponent`);
    else fail(`converted provider regressed: ${regressed.join('; ')}`);

    // 2. safeEncodeURIComponent is never referenced without importing it.
    const unimported = [];
    for (const f of files) {
      const src = read(f);
      if (typeof src !== 'string') continue;
      if (HELPER_USE.test(src) && !SHARED_IMPORT.test(src)) unimported.push(f);
    }
    if (unimported.length === 0) pass('no provider references safeEncodeURIComponent without importing it');
    else fail(`safeEncodeURIComponent used without importing _safe-url.mjs in: ${unimported.join(', ')}`);

    // 3. No new bare encodeURIComponent on a job-URL line.
    const offenders = [];
    for (const f of files) {
      const src = read(f);
      if (typeof src !== 'string') continue;
      const lines = src.split('\n');
      const hits = lines
        .map((line, i) => (BARE_ON_URL_LINE.test(line) ? i + 1 : 0))
        .filter(Boolean);
      if (hits.length === 0) continue;
      if (f in ALLOWLIST) continue; // reviewed — see ALLOWLIST reasons above
      offenders.push(`${f}:${hits.join(',')}`);
    }
    if (offenders.length === 0) {
      pass('no unreviewed provider builds a job URL with a bare encodeURIComponent');
    } else {
      fail(`bare encodeURIComponent on a job-URL line (route it through _safe-url.mjs, or add to ALLOWLIST with a reason): ${offenders.join('; ')}`);
    }

    // Positive control: the guard must fire on the shape it forbids, so a regex
    // slip that matches nothing is caught here rather than passing silently.
    const planted = 'jobs.push({ url: `${o}/j/${encodeURIComponent(id)}` });';
    if (BARE_ON_URL_LINE.test(planted)) pass('positive control: guard fires on a bare encodeURIComponent job-URL line');
    else fail('positive control: guard no longer detects the bare shape it exists to forbid');

    // Negative control: routing through the helper is correct and must stay clean.
    const clean = 'jobs.push({ url: `${o}/j/${safeEncodeURIComponent(id)}` });';
    if (!BARE_ON_URL_LINE.test(clean)) pass('negative control: a safeEncodeURIComponent job-URL line is not flagged');
    else fail('negative control: guard flags the helper call it is meant to allow');
  }
}
