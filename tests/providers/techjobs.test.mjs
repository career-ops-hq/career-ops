// tests/providers/techjobs.test.mjs — provider-contract tests for the
// techjobs.vn board-wide JSON feed (providers/techjobs.mjs).
//
// The feed shape below mirrors https://techjobs.vn/feeds/jobs.json as measured
// on 2026-11-12 (envelope keys, item keys, ISO 8601 posted_at). Company names
// and URLs are fictional.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — techjobs');

const PER_PAGE = 500;

function item(id, over = {}) {
  return {
    id,
    title: `Backend Engineer ${id}`,
    company: 'Acme',
    company_slug: 'acme',
    location: 'Ho Chi Minh City, Vietnam',
    cities: ['hcm'],
    workplace_type: 'hybrid',
    employment_type: null,
    seniority: 'senior',
    skills: ['go'],
    posted_at: '2026-11-01T08:00:00.000Z',
    apply_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
    url: `https://techjobs.vn/companies/acme/jobs/${id}`,
    summary: 'Senior Backend role at Acme. Must-have skills: go.',
    ...over,
  };
}

function envelope(page, jobs, { total = 1000, next } = {}) {
  return {
    source: 'https://techjobs.vn',
    generated_at: '2026-11-12T00:00:00.000Z',
    total,
    page,
    per_page: PER_PAGE,
    pages: Math.ceil(total / PER_PAGE),
    next: next === undefined ? `https://techjobs.vn/feeds/jobs.json?page=${page + 1}&per_page=${PER_PAGE}` : next,
    jobs,
  };
}

function fullPage(page, startId) {
  return Array.from({ length: PER_PAGE }, (_, i) => item(startId + i));
}

/** ctx whose fetchJson serves pages from a function; records every call. */
function makeCtx(serve, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      transport: 'http',
      sleep: async () => {},
      fetchJson: async (url, opts) => {
        calls.push({ url, opts });
        return serve(url, calls.length);
      },
      ...extra,
    },
  };
}

function pageOf(url) {
  return Number(new URL(url).searchParams.get('page'));
}

async function quietly(fn) {
  const orig = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    return { result: await fn(), warnings };
  } finally {
    console.warn = orig;
  }
}

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/techjobs.mjs')).href);
  const techjobs = mod.default;
  const { normalizeTechjobsJob, resolveTechjobsUrl, jobsOf, buildPageUrl } = mod;

  if (techjobs.id === 'techjobs') pass('techjobs.id is "techjobs"');
  else fail(`techjobs.id is ${JSON.stringify(techjobs.id)}`);

  // ── detect(): explicit-only ──
  const hit = techjobs.detect({ name: 'techjobs.vn', provider: 'techjobs' });
  if (hit && hit.url === 'https://techjobs.vn/feeds/jobs.json?page=1&per_page=500') {
    pass('detect() resolves provider:techjobs → the feed URL, no careers_url needed');
  } else fail(`detect() returned ${JSON.stringify(hit)}`);
  const misses = [
    null, undefined, 'x', 42, {}, { name: 'techjobs.vn' },
    { provider: 'greenhouse' }, { careers_url: 'https://techjobs.vn/jobs' },
  ];
  if (misses.every((e) => techjobs.detect(e) === null)) pass('detect() returns null without provider:techjobs (junk input included)');
  else fail('detect() must claim only provider:techjobs entries');

  if (buildPageUrl(3) === 'https://techjobs.vn/feeds/jobs.json?page=3&per_page=500') pass('buildPageUrl() pins host, path and per_page');
  else fail(`buildPageUrl drift: ${buildPageUrl(3)}`);

  // ── normalization / rule 2 URL choice ──
  const n = normalizeTechjobsJob(item(7));
  if (n && n.title === 'Backend Engineer 7' && n.url === 'https://job-boards.greenhouse.io/acme/jobs/7'
      && n.company === 'Acme' && n.location === 'Ho Chi Minh City, Vietnam'
      && n.postedAt === Date.parse('2026-11-01T08:00:00.000Z') && !('description' in n)) {
    pass('normalize: employer apply_url is the URL; title/company/location/postedAt mapped; summary not emitted as description');
  } else fail(`normalize = ${JSON.stringify(n)}`);

  if (resolveTechjobsUrl(item(8, { apply_url: 'http://acme.example/jobs/8' })) === 'https://techjobs.vn/companies/acme/jobs/8') {
    pass('resolve URL: non-https apply_url falls back to the techjobs.vn page');
  } else fail('non-https apply_url fallback');
  if (resolveTechjobsUrl(item(9, { apply_url: 'not a url' })) === 'https://techjobs.vn/companies/acme/jobs/9') {
    pass('resolve URL: malformed apply_url falls back to the techjobs.vn page');
  } else fail('malformed apply_url fallback');
  if (resolveTechjobsUrl(item(10, { apply_url: null, url: 'https://evil.example/jobs/10' })) === '') {
    pass('resolve URL: a fallback page off techjobs.vn is refused');
  } else fail('off-host fallback must be refused');

  // ── workplace_type → workplaceType (read by _country.mjs's workplace policy) ──
  const remote = normalizeTechjobsJob(item(20, { workplace_type: 'Remote', location: 'Da Nang, Vietnam' }));
  if (remote?.workplaceType === 'remote' && remote.location === 'Da Nang, Vietnam') {
    pass('normalize: a remote posting that names a city keeps workplaceType "remote"');
  } else fail(`remote = ${JSON.stringify(remote)}`);
  if (normalizeTechjobsJob(item(21))?.workplaceType === 'hybrid'
      && normalizeTechjobsJob(item(22, { workplace_type: 'onsite' }))?.workplaceType === 'onsite') {
    pass('normalize: hybrid and onsite pass through as workplaceType');
  } else fail('hybrid/onsite workplaceType');
  const unmapped = [null, 'field', 'rotational-shift', 7].map((w) => normalizeTechjobsJob(item(23, { workplace_type: w })));
  if (unmapped.every((j) => j && !('workplaceType' in j))) pass('normalize: null or values the policy does not know omit workplaceType');
  else fail(`unmapped = ${JSON.stringify(unmapped)}`);

  {
    // End to end through the scanner's workplace policy: on-site only in Ho Chi
    // Minh City, remote from Vietnam. A remote Da Nang posting must stay in;
    // the same posting without its remote tag reads as on-site in Da Nang.
    const { buildWorkplacePolicy } = await import(pathToFileURL(join(ROOT, 'providers/_country.mjs')).href);
    const policy = buildWorkplacePolicy({ onsite_locations: ['Ho Chi Minh City'], remote_countries: ['Vietnam'] });
    const tagged = normalizeTechjobsJob(item(24, { workplace_type: 'remote', location: 'Da Nang, Vietnam' }));
    const untagged = normalizeTechjobsJob(item(25, { workplace_type: null, location: 'Da Nang, Vietnam' }));
    const kept = policy(tagged.location, tagged.title, tagged);
    const dropped = policy(untagged.location, untagged.title, untagged);
    if (kept.eligible && !dropped.eligible) pass('workplace_policy: the remote tag keeps a remote Da Nang posting that an untagged one loses');
    else fail(`workplace_policy: tagged=${JSON.stringify(kept)} untagged=${JSON.stringify(dropped)}`);
  }

  const noDate = normalizeTechjobsJob(item(11, { posted_at: 'yesterday' }));
  if (noDate && !('postedAt' in noDate)) pass('normalize: unparseable posted_at omits postedAt (NaN-safe)');
  else fail(`bad date = ${JSON.stringify(noDate)}`);

  const dropped = [
    null, 'x', item(12, { title: '   ' }), item(13, { title: 5 }),
    item(14, { apply_url: '', url: '' }),
  ].map(normalizeTechjobsJob);
  if (dropped.every((x) => x === null)) pass('normalize: rows missing title or any usable URL are dropped');
  else fail(`dropped = ${JSON.stringify(dropped)}`);

  // ── empty vs broken envelope ──
  if (Array.isArray(jobsOf({ jobs: [] }, 1)) && jobsOf({ jobs: [] }, 1).length === 0) pass('jobsOf: present-and-empty jobs[] → []');
  else fail('jobsOf empty');
  for (const bad of [{}, { jobs: null }, { jobs: {} }, { results: [] }, '', 0, true, null]) {
    try {
      jobsOf(bad, 1);
      fail(`jobsOf(${JSON.stringify(bad)}) should throw`);
    } catch (e) {
      if (!/techjobs: unexpected response/.test(String(e.message))) fail(`jobsOf wrong error: ${e.message}`);
    }
  }
  pass('jobsOf: missing/wrong-typed envelope and bare non-objects throw a descriptive error');

  {
    const { ctx } = makeCtx(() => envelope(1, [], { total: 0, next: null }));
    const out = await techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx);
    if (Array.isArray(out) && out.length === 0 && !out.truncated) pass('fetch: empty feed → [] (not truncated)');
    else fail(`empty feed = ${JSON.stringify(out)}`);
  }
  {
    const { ctx } = makeCtx(() => ({ error: 'oops' }));
    try {
      await techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx);
      fail('fetch must throw on an undocumented envelope');
    } catch (e) {
      if (/expected \{ jobs/.test(e.message) && /error/.test(e.message)) pass('fetch: undocumented envelope throws, naming the keys it got');
      else fail(`wrong error: ${e.message}`);
    }
  }

  // ── full walk: redirect:'error' on every request, stop on short page ──
  {
    const { ctx, calls } = makeCtx((url) => {
      const p = pageOf(url);
      if (p === 1) return envelope(1, [...fullPage(1, 1).slice(0, PER_PAGE - 1), item(1, { title: '' })], { total: 700 });
      return envelope(2, [item(600), item(601), item(1)], { total: 700, next: null });
    });
    const out = await techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx);
    if (calls.length === 2) pass('fetch: a full page (raw count, one malformed row) continues; the short last page stops');
    else fail(`full walk made ${calls.length} calls`);
    if (calls.every((c) => c.opts?.redirect === 'error')) pass("fetch: every request passes redirect:'error'");
    else fail(`redirect opts = ${JSON.stringify(calls.map((c) => c.opts))}`);
    if (calls.every((c) => new URL(c.url).hostname === 'techjobs.vn')) pass('fetch: only techjobs.vn is ever requested');
    else fail('fetch requested another host');
    if (out.length === PER_PAGE - 1 + 2 && !out.truncated) pass('fetch: rows de-duplicated by URL, malformed dropped, result not truncated');
    else fail(`walk returned ${out.length} rows, truncated=${JSON.stringify(out.truncated)}`);
  }

  // ── `next: null` on a full page ends the walk ──
  {
    const { ctx, calls } = makeCtx(() => envelope(1, fullPage(1, 1), { total: PER_PAGE, next: null }));
    await techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx);
    if (calls.length === 1) pass('fetch: next:null stops the walk even on a full page');
    else fail(`next:null made ${calls.length} calls`);
  }

  // ── a full page must carry `next` (URL or null); absent / wrong type throws ──
  for (const [label, next] of [['missing', undefined], ['a number', 2], ['an empty string', '']]) {
    const { ctx, calls } = makeCtx(() => {
      const env = envelope(1, fullPage(1, 1));
      if (next === undefined) delete env.next;
      else env.next = next;
      return env;
    });
    try {
      await techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx);
      fail(`full page with next ${label} must throw`);
    } catch (e) {
      if (/is full but next is/.test(e.message) && calls.length === 1) pass(`fetch: a full page with next ${label} throws instead of stopping silently`);
      else fail(`next ${label}: ${e.message}`);
    }
  }
  {
    const { ctx } = makeCtx(() => {
      const env = envelope(1, [item(1), item(2)]);
      delete env.next;
      return env;
    });
    const out = await techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx);
    if (out.length === 2 && !out.truncated) pass('fetch: a short page still ends the walk without needing next');
    else fail(`short page without next: ${out.length}`);
  }

  // ── page ceiling: DEFAULT_MAX_PAGES bounds a feed claiming endless pages ──
  {
    const { ctx, calls } = makeCtx((url) => envelope(pageOf(url), fullPage(pageOf(url), pageOf(url) * 1000), { total: 10_000_000 }));
    const { result, warnings } = await quietly(() => techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx));
    if (calls.length === 40) pass('fetch: own DEFAULT_MAX_PAGES (40) bounds the walk whatever the feed reports');
    else fail(`unbounded feed made ${calls.length} calls`);
    if (result.truncated?.reason === 'page-cap' && result.truncated.total === 10_000_000) pass('fetch: a ceiling stop marks jobs.truncated = page-cap');
    else fail(`truncated = ${JSON.stringify(result.truncated)}`);
    if (warnings.some((w) => /raise max_pages/.test(w))) pass('fetch: a ceiling stop warns to raise max_pages');
    else fail('missing max_pages warning');
  }
  {
    const { ctx, calls } = makeCtx((url) => envelope(pageOf(url), fullPage(pageOf(url), pageOf(url) * 1000)));
    await quietly(() => techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs', max_pages: 100000 }, ctx));
    if (calls.length === 200) pass('fetch: a user max_pages is clamped to MAX_PAGES_CAP (200)');
    else fail(`clamp made ${calls.length} calls`);
  }

  // ── health probe: one request, rejection propagates unwrapped ──
  {
    const { ctx, calls } = makeCtx((url) => envelope(pageOf(url), fullPage(pageOf(url), 1)), { maxPages: 1 });
    const { result, warnings } = await quietly(() => techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx));
    if (calls.length === 1 && !result.truncated && warnings.length === 0) pass('probe (maxPages:1): exactly one list request, no cap warning or truncation mark');
    else fail(`probe made ${calls.length} calls, truncated=${JSON.stringify(result.truncated)}, warnings=${warnings.length}`);
  }
  {
    class ProbeBudget extends Error {}
    const sentinel = new ProbeBudget('budget');
    const { ctx } = makeCtx((url) => {
      if (pageOf(url) === 2) throw sentinel;
      return envelope(1, fullPage(1, 1));
    }, { maxPages: 2 });
    try {
      await techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx);
      fail('probe: a fetch rejection must propagate');
    } catch (e) {
      if (e === sentinel) pass('probe: a ctx.fetchJson rejection propagates unwrapped (identity kept)');
      else fail(`probe rejection rewrapped: ${e?.message}`);
    }
  }

  // ── transient failure mid-walk in a real scan: keep pages, mark fetch-error ──
  {
    const { ctx } = makeCtx((url) => {
      if (pageOf(url) === 2) {
        const err = new Error('HTTP 503');
        /** @type {any} */ (err).status = 503;
        throw err;
      }
      return envelope(1, fullPage(1, 1));
    });
    const { result, warnings } = await quietly(() => techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx));
    if (result.length === PER_PAGE && result.truncated?.reason === 'fetch-error') pass('page-2 failure after retries: page 1 kept, jobs.truncated = fetch-error');
    else fail(`page-2 failure: ${result.length} rows, truncated=${JSON.stringify(result.truncated)}`);
    if (!warnings.some((w) => /raise max_pages/.test(w))) pass('page-2 failure does not fire the raise-max_pages warning');
    else fail('fetch-error stop misfired the max_pages warning');
  }
  {
    const { ctx } = makeCtx(() => {
      const err = new Error('HTTP 404');
      /** @type {any} */ (err).status = 404;
      throw err;
    });
    try {
      await techjobs.fetch({ name: 'techjobs.vn', provider: 'techjobs' }, ctx);
      fail('a failing first page must throw');
    } catch (e) {
      if (/404/.test(e.message)) pass('fetch: a failing first page throws (broken board, not empty)');
      else fail(`first-page error: ${e.message}`);
    }
  }
} catch (e) {
  fail(`techjobs tests crashed: ${e?.stack ?? e}`);
}
