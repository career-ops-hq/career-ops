// tests/providers/a16z-speedrun-talent.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { fetchJsonWithRetry } from '../../providers/_http.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — a16z-speedrun-talent');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/a16z-speedrun-talent.mjs')).href);
  const provider = mod.default;
  const { normalizeSpeedrunJob } = mod;

  if (provider.id === 'a16z-speedrun-talent') pass('a16z-speedrun-talent.id is "a16z-speedrun-talent"');
  else fail(`a16z-speedrun-talent.id is ${JSON.stringify(provider.id)}`);

  // normalizeSpeedrunJob — full mapping.
  const full = normalizeSpeedrunJob(
    { id: 'job-abc123', title: '  Founding Engineer  ', url: 'https://speedrun-talent-network.com/jobs/founding-engineer-light-abc123', company: '  Light  ', location: '  New York, NY  ', remote: false, published_at: '2026-07-01T12:00:00.000Z' },
    'Fallback',
  );
  if (full && full.title === 'Founding Engineer'
      && full.url === 'https://speedrun-talent-network.com/jobs/founding-engineer-light-abc123'
      && full.company === 'Light' && full.location === 'New York, NY'
      && full.postedAt === Date.parse('2026-07-01T12:00:00.000Z')
      && full.externalId === 'job-abc123') {
    pass('normalizeSpeedrunJob maps title/url/company/location + published_at → postedAt + id → externalId');
  } else {
    fail(`normalizeSpeedrunJob full row = ${JSON.stringify(full)}`);
  }

  // workplaceType comes from workplace_type (any case).
  const speedrunUrl = 'https://speedrun-talent-network.com/jobs/w';
  const wtJob = (extra) => normalizeSpeedrunJob({ title: 'W', url: speedrunUrl, ...extra });
  const wt = (extra) => wtJob(extra)?.workplaceType;
  if (wt({ workplace_type: 'Remote', remote: true }) === 'remote' && wt({ workplace_type: 'Hybrid', remote: false }) === 'hybrid'
      && wt({ workplace_type: 'OnSite' }) === 'onsite' && wt({ workplace_type: 'Onsite' }) === 'onsite') {
    pass('normalizeSpeedrunJob sets workplaceType from workplace_type');
  } else {
    fail(`normalizeSpeedrunJob workplace_type = ${JSON.stringify(['Remote', 'Hybrid', 'OnSite', 'Onsite'].map((v) => wt({ workplace_type: v })))}`);
  }
  const unset = [{ workplace_type: null, remote: true }, { remote: true }, { workplace_type: 'Unspecified' }].map(wtJob);
  if (unset.every((j) => j && !('workplaceType' in j))) {
    pass('normalizeSpeedrunJob leaves workplaceType unset for a null, absent or unknown workplace_type');
  } else {
    fail('normalizeSpeedrunJob should read workplaceType only from workplace_type');
  }

  // "Remote" appended when remote is true; location may be null.
  const remoteLoc = normalizeSpeedrunJob({ title: 'R', url: 'https://speedrun-talent-network.com/jobs/r', location: 'SF Bay Area', remote: true });
  const remoteOnly = normalizeSpeedrunJob({ title: 'R', url: 'https://speedrun-talent-network.com/jobs/r2', location: null, remote: true });
  if (remoteLoc?.location === 'SF Bay Area, Remote' && remoteOnly?.location === 'Remote') {
    pass('normalizeSpeedrunJob appends "Remote" when remote and handles null location');
  } else {
    fail(`normalizeSpeedrunJob remote locations = ${JSON.stringify({ a: remoteLoc?.location, b: remoteOnly?.location })}`);
  }

  // company fallbacks: entry name, then "a16z speedrun talent network".
  const coEntry = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/c1', company: '' }, 'Entry Name');
  const coDefault = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/c2' });
  const coBlank = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/c3' }, '   ');
  if (coEntry?.company === 'Entry Name' && coDefault?.company === 'a16z speedrun talent network' && coBlank?.company === 'a16z speedrun talent network') {
    pass('normalizeSpeedrunJob falls back company → entry name → "a16z speedrun talent network"');
  } else {
    fail(`normalizeSpeedrunJob company fallbacks = ${JSON.stringify({ a: coEntry?.company, b: coDefault?.company, c: coBlank?.company })}`);
  }

  // externalId omitted when the feed carries no usable id (absent / blank / non-string).
  const noId = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/ni' });
  const blankId = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/bi', id: '   ' });
  const objId = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/oi', id: {} });
  if (noId && !('externalId' in noId) && blankId && !('externalId' in blankId) && objId && !('externalId' in objId)) {
    pass('normalizeSpeedrunJob omits externalId when id is absent / blank / non-string');
  } else {
    fail(`normalizeSpeedrunJob externalId presence = ${JSON.stringify({ noId, blankId, objId })}`);
  }

  // postedAt omitted when published_at absent/unparseable.
  const noDate = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/nd', published_at: null });
  const badDate = normalizeSpeedrunJob({ title: 'T', url: 'https://speedrun-talent-network.com/jobs/bd', published_at: 'not-a-date' });
  if (noDate && !('postedAt' in noDate) && badDate && !('postedAt' in badDate)) {
    pass('normalizeSpeedrunJob omits postedAt when published_at is absent or unparseable');
  } else {
    fail(`normalizeSpeedrunJob date handling = ${JSON.stringify({ noDate, badDate })}`);
  }

  // host-lock + drops: off-host url, non-https url, missing url, empty title, non-object.
  const drops = [
    normalizeSpeedrunJob({ title: 'Off host', url: 'https://evil.example/jobs/x' }),
    normalizeSpeedrunJob({ title: 'Insecure', url: 'http://speedrun-talent-network.com/jobs/x' }),
    normalizeSpeedrunJob({ title: 'No URL' }),
    normalizeSpeedrunJob({ title: '', url: 'https://speedrun-talent-network.com/jobs/x' }),
    normalizeSpeedrunJob(null),
  ];
  if (drops.every((r) => r === null)) {
    pass('normalizeSpeedrunJob host-locks url to speedrun-talent-network.com and drops off-host/non-https/no-url/empty-title/non-object');
  } else {
    fail(`normalizeSpeedrunJob drops = ${JSON.stringify(drops)}`);
  }

  // detect(): claims careers_url / api on the trusted host, ignores others.
  const hit = provider.detect({ careers_url: 'https://speedrun-talent-network.com/jobs' });
  const hitApi = provider.detect({ api: 'https://speedrun-talent-network.com/api/v1/jobs' });
  const missHost = provider.detect({ careers_url: 'https://jobs.example.com' });
  const missNone = provider.detect({ name: 'no urls' });
  if (hit?.url && hitApi?.url && missHost === null && missNone === null) {
    pass('detect() claims speedrun-talent-network.com careers_url/api and ignores other hosts');
  } else {
    fail(`detect() = ${JSON.stringify({ hit, hitApi, missHost, missNone })}`);
  }

  // fetch(): 0-based pagination with source tag, stop on short page; q passthrough.
  const mk = (i) => ({ id: `job-${i}`, title: `Role ${i}`, url: `https://speedrun-talent-network.com/jobs/x${i}`, company: `Co ${i}`, location: 'New York, NY', remote: false, published_at: '2026-07-01T00:00:00.000Z' });
  const page0 = { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), total: 53, page: 0, page_size: 50, total_pages: 2 };
  const page1 = { jobs: [mk(50), mk(51), { title: '', url: 'https://speedrun-talent-network.com/jobs/bad' }], total: 53, page: 1, page_size: 50, total_pages: 2 };
  const calls = [];
  const ctx = {
    fetchJson: async (url) => {
      calls.push(url);
      const page = new URL(url).searchParams.get('page');
      return page === '0' ? page0 : page1;
    },
  };
  const jobs = await provider.fetch({ name: 'a16z speedrun talent network', max_pages: 5, q: 'engineer' }, ctx);
  const urlsOk = calls.length === 2
    && calls.every((u) => u.startsWith('https://speedrun-talent-network.com/api/v1/jobs?'))
    && calls.every((u) => new URL(u).searchParams.get('source') === 'career-ops')
    && calls.every((u) => new URL(u).searchParams.get('q') === 'engineer')
    && new URL(calls[0]).searchParams.get('page') === '0'
    && new URL(calls[1]).searchParams.get('page') === '1';
  if (urlsOk && jobs.length === 52 && jobs[0].title === 'Role 0' && jobs[51].title === 'Role 51') {
    pass('fetch() paginates 0-based with source=career-ops + q passthrough, stops after total_pages, drops invalid rows');
  } else {
    fail(`fetch() = ${JSON.stringify({ calls, count: jobs.length })}`);
  }

  // fetch() carries the feed id through to externalId on every returned row.
  if (jobs[0].externalId === 'job-0' && jobs[51].externalId === 'job-51') {
    pass('fetch() carries the feed id through as externalId');
  } else {
    fail(`fetch() externalId = ${JSON.stringify({ first: jobs[0]?.externalId, last: jobs[51]?.externalId })}`);
  }

  // fetch(): max_pages caps ahead of total_pages.
  const capCalls = [];
  const capCtx = { fetchJson: async (url) => { capCalls.push(url); return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), total_pages: 50 }; } };
  const capped = await provider.fetch({ max_pages: 2 }, capCtx);
  if (capCalls.length === 2 && capped.length === 100) pass('fetch() honors max_pages ahead of total_pages');
  else fail(`fetch() cap = ${JSON.stringify({ calls: capCalls.length, jobs: capped.length })}`);

  // Regression: the live feed serves exactly 50 jobs/page. A full 50-row page
  // must NOT be mistaken for a short page — the old hardcoded PER_PAGE=100
  // made 50 < 100 true, broke after page 0, and silently truncated a
  // 16k-job board to its newest 50 rows.
  const liveShapeCalls = [];
  const liveShapeCtx = {
    fetchJson: async (url) => {
      liveShapeCalls.push(url);
      return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), total: 16830, page: liveShapeCalls.length - 1, page_size: 50, total_pages: 337 };
    },
  };
  const liveWarnings = [];
  const liveRealConsoleError = console.error;
  let liveShape;
  try {
    console.error = (...args) => liveWarnings.push(args.join(' '));
    liveShape = await provider.fetch({ max_pages: 2 }, liveShapeCtx);
  } finally {
    console.error = liveRealConsoleError;
  }
  const livePagesOk = liveShapeCalls.length === 2
    && new URL(liveShapeCalls[0]).searchParams.get('page') === '0'
    && new URL(liveShapeCalls[1]).searchParams.get('page') === '1';
  if (livePagesOk && liveShape.length === 100) pass('fetch() keeps paginating past a full 50-row page (live feed shape)');
  else fail(`live-shape pagination = ${JSON.stringify({ calls: liveShapeCalls, jobs: liveShape?.length })}`);
  if (liveWarnings.some((w) => w.includes('truncated at max_pages=2'))) pass('fetch() warns when max_pages truncates the live-shape feed');
  else fail(`live-shape truncation warning missing; captured = ${JSON.stringify(liveWarnings)}`);
  // The warned cut is also marked, so scan.mjs logs the board partial, not reachable.
  if (liveShape.truncated?.reason === 'page-cap' && liveShape.truncated.fetched === 100) pass('fetch() marks the board page-cap when max_pages truncates the feed');
  else fail(`live-shape cut: truncated = ${JSON.stringify(liveShape.truncated)}`);

  // The health probe (ctx.maxPages: 1) reads one page of a long feed, and is
  // never warned about or marked as a max_pages cut, including on a max_pages: 1
  // entry, where the probe's page is also the entry's last (#7180).
  for (const probeEntry of [{}, { max_pages: 1 }]) {
    const probeCalls = [];
    const probeWarnings = [];
    let probed;
    try {
      console.error = (...args) => probeWarnings.push(args.join(' '));
      probed = await provider.fetch(probeEntry, {
        maxPages: 1,
        fetchJson: async (url) => { probeCalls.push(url); return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), total: 16830, page_size: 50, total_pages: 337 }; },
      });
    } finally {
      console.error = liveRealConsoleError;
    }
    const label = JSON.stringify(probeEntry);
    if (probeCalls.length === 1 && probed.length === 50 && probeWarnings.length === 0 && probed.truncated === undefined) pass(`fetch() reads one page under a ctx.maxPages: 1 probe and reports no cut (entry ${label})`);
    else fail(`probe on entry ${label} = ${JSON.stringify({ calls: probeCalls.length, jobs: probed?.length, warnings: probeWarnings, truncated: probed?.truncated })}`);
  }

  // #2547: total_pages outranks the short-page break. On a board that rotates
  // while a sweep runs, a page can legitimately come back 49/50 because a
  // listing was deleted between requests — that is not the last page, and the
  // feed's own total_pages says so. Before the fix iteration stopped there and
  // returned 149 of 300 jobs, silently: the truncation warning is gated on
  // max_pages, and page 2 of 6 never reaches the cap. Repro shape from
  // @FReptar0 on #2547.
  const rotCalls = [];
  const rotCtx = {
    fetchJson: async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      rotCalls.push(page);
      const rows = page === 2 ? 49 : 50;
      return { jobs: Array.from({ length: rows }, (_, i) => mk(page * 50 + i)), total: 300, page, page_size: 50, total_pages: 6 };
    },
  };
  const rotWarnings = [];
  const rotRealConsoleError = console.error;
  let rotated;
  try {
    console.error = (...args) => rotWarnings.push(args.join(' '));
    rotated = await provider.fetch({ max_pages: 6 }, rotCtx);
  } finally {
    console.error = rotRealConsoleError;
  }
  if (rotCalls.join(',') === '0,1,2,3,4,5' && rotated.length === 299) {
    pass('fetch() keeps paginating past a short-but-nonempty page while total_pages says there is more (#2547)');
  } else {
    fail(`#2547 mid-sweep short page = ${JSON.stringify({ pages: rotCalls, jobs: rotated?.length })}`);
  }
  // A sweep that lands exactly on max_pages === total_pages is complete, not
  // truncated: no false "raise max_pages" warning on a board read in full.
  if (rotWarnings.length === 0) pass('fetch() does not warn when max_pages exactly covers total_pages');
  else fail(`unexpected warning on a complete sweep = ${JSON.stringify(rotWarnings)}`);
  if (rotated.truncated === undefined) pass('fetch() leaves a sweep that exactly covers total_pages unmarked');
  else fail(`complete sweep was marked: ${JSON.stringify(rotated.truncated)}`);

  // Trusting total_pages is only safe because an empty page ends iteration
  // unconditionally: an OVER-reporting feed stops at the first empty response
  // instead of burning the page budget. This is the lying-server risk that
  // sank the page_size variant in #2419, bounded here.
  const overCalls = [];
  const overCtx = {
    fetchJson: async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      overCalls.push(page);
      return { jobs: page < 3 ? Array.from({ length: 50 }, (_, i) => mk(page * 50 + i)) : [], total_pages: 50 };
    },
  };
  const over = await provider.fetch({ max_pages: 20 }, overCtx);
  if (overCalls.length === 4 && over.length === 150) pass('fetch() stops at the first empty page when total_pages over-reports (#2547)');
  else fail(`over-reported total_pages = ${JSON.stringify({ calls: overCalls.length, jobs: over.length })}`);

  // The other direction, pinned as deliberate: an UNDER-reporting total_pages
  // truncates, and that is the accepted trade-off — the feed's own count is
  // the best available statement of board size, and ignoring it is the bug
  // above. Do not "fix" this back into a short-page race.
  const underCalls = [];
  const underCtx = {
    fetchJson: async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      underCalls.push(page);
      return { jobs: Array.from({ length: 50 }, (_, i) => mk(page * 50 + i)), total_pages: 2 };
    },
  };
  const under = await provider.fetch({ max_pages: 10 }, underCtx);
  if (underCalls.length === 2 && under.length === 100) pass('fetch() honours total_pages as the terminator even when the feed under-reports (#2547, deliberate)');
  else fail(`under-reported total_pages = ${JSON.stringify({ calls: underCalls.length, jobs: under.length })}`);

  // A non-positive total_pages counts as ABSENT, not as "one page". A feed
  // reporting 0 (or a negative) alongside 50 real rows contradicts itself, and
  // `page + 1 >= 0` is true at page 0 — so the metadata branch used to end the
  // sweep immediately and hand back exactly 50 jobs, the #2419 failure shape,
  // while the SAME feed with the field omitted swept the full budget. The
  // assertion is that asymmetry: each non-positive value must produce the same
  // pages and the same job count as the field-absent control, so the two arms
  // cannot drift apart later. (CodeRabbit, PR #3358.)
  const sweep = async (total_pages) => {
    const calls = [];
    const ctx = {
      fetchJson: async (url) => {
        const page = Number(new URL(url).searchParams.get('page'));
        calls.push(page);
        const body = { jobs: Array.from({ length: 50 }, (_, i) => mk(page * 50 + i)) };
        if (total_pages !== undefined) body.total_pages = total_pages;
        return body;
      },
    };
    const jobs = await provider.fetch({ max_pages: 6 }, ctx);
    return { pages: calls.join(','), jobs: jobs.length };
  };
  const absent = await sweep(undefined);
  const zero = await sweep(0);
  const negative = await sweep(-1);
  const matchesAbsent = (r) => r.pages === absent.pages && r.jobs === absent.jobs;
  if (absent.pages === '0,1,2,3,4,5' && absent.jobs === 300 && matchesAbsent(zero) && matchesAbsent(negative)) {
    pass('fetch() treats total_pages 0 and -1 as absent, sweeping identically to a feed that omits the field');
  } else {
    fail(`non-positive total_pages = ${JSON.stringify({ absent, zero, negative })}`);
  }

  // PER_PAGE fallback pinned from both directions when the response omits
  // page_size/total_pages — the path a short page still ends iteration on
  // (#2547; shared with the non-positive total_pages case above): a full
  // 50-row page continues (fails if PER_PAGE regresses above 50), a 49-row
  // page stops (fails if it regresses below 50).
  const bareCalls = [];
  const bareCtx = {
    fetchJson: async (url) => {
      bareCalls.push(url);
      return { jobs: Array.from({ length: bareCalls.length === 1 ? 50 : 49 }, (_, i) => mk(i)) };
    },
  };
  const bare = await provider.fetch({ max_pages: 5 }, bareCtx);
  if (bareCalls.length === 2 && bare.length === 99) pass('fetch() stops on a short page via the PER_PAGE=50 fallback when page_size is absent');
  else fail(`bare fallback = ${JSON.stringify({ calls: bareCalls.length, jobs: bare.length })}`);

  // Empty feed (e.g. a q: with no matches) returns [] after one call.
  const emptyCalls = [];
  const emptyCtx = { fetchJson: async (url) => { emptyCalls.push(url); return { jobs: [], total: 0, page: 0, page_size: 50, total_pages: 0 }; } };
  const empty = await provider.fetch({ max_pages: 3 }, emptyCtx);
  if (emptyCalls.length === 1 && empty.length === 0) pass('fetch() returns [] after one call on an empty feed');
  else fail(`empty feed = ${JSON.stringify({ calls: emptyCalls.length, jobs: empty.length })}`);

  // resolveQuery: keywords[] fallback when q: is absent.
  const kwCalls = [];
  const kwCtx = { fetchJson: async (url) => { kwCalls.push(url); return { jobs: [mk(0)], total_pages: 1 }; } };
  await provider.fetch({ keywords: ['machine', '', 'learning'] }, kwCtx);
  if (new URL(kwCalls[0]).searchParams.get('q') === 'machine learning') pass('fetch() falls back to joined keywords[] when q: is absent');
  else fail(`keywords fallback q = ${JSON.stringify(new URL(kwCalls[0]).searchParams.get('q'))}`);

  // DEFAULT_MAX_PAGES: with no max_pages on the entry, the default budget
  // covers 6 pages × 50 = 300 jobs — the same 300-job default scan the
  // pre-#2419 constants encoded as 3 × 100. Pages derive from the requested
  // `page` param with page-distinct ids, so duplicated or skipped requests
  // cannot pass.
  const defCalls = [];
  const defCtx = {
    fetchJson: async (url) => {
      const p = Number(new URL(url).searchParams.get('page'));
      defCalls.push(p);
      return { jobs: Array.from({ length: 50 }, (_, i) => mk(p * 50 + i)), total: 16830, page: p, page_size: 50, total_pages: 337 };
    },
  };
  const defWarnings = [];
  const defRealConsoleError = console.error;
  let defJobs;
  try {
    console.error = (...args) => defWarnings.push(args.join(' '));
    defJobs = await provider.fetch({ name: 'a16z speedrun talent network' }, defCtx);
  } finally {
    console.error = defRealConsoleError;
  }
  const defPagesOk = defCalls.length === 6 && defCalls.every((p, i) => p === i);
  const defDistinct = defJobs && new Set(defJobs.map((j) => j.url)).size === 300;
  if (defPagesOk && defJobs.length === 300 && defDistinct) pass('fetch() default budget covers pages 0..5 → 300 distinct jobs');
  else fail(`default budget = ${JSON.stringify({ calls: defCalls, jobs: defJobs?.length })}`);
  if (defWarnings.some((w) => w.includes('truncated at max_pages=6'))) pass('fetch() warns when the default budget truncates the feed');
  else fail(`default-budget truncation warning missing; captured = ${JSON.stringify(defWarnings)}`);

  // MAX_PAGES_CAP: an oversized max_pages is clamped to 1000 and the
  // truncation warning fires (spied via console.error, restored in finally).
  // Pages derive from the requested `page` param with page-distinct ids —
  // 1000 identical re-fetches of page 0 would fail the sequence assertion.
  const mkCapCtx = (calls) => ({
    fetchJson: async (url) => {
      const p = Number(new URL(url).searchParams.get('page'));
      calls.push(p);
      return { jobs: Array.from({ length: 50 }, (_, i) => mk(p * 50 + i)), total_pages: 1500 };
    },
  });
  const bigCalls = [];
  const warnings = [];
  const realConsoleError = console.error;
  let bigJobs;
  try {
    console.error = (...args) => warnings.push(args.join(' '));
    bigJobs = await provider.fetch({ max_pages: 9999 }, mkCapCtx(bigCalls));
  } finally {
    console.error = realConsoleError;
  }
  const bigPagesOk = bigCalls.length === 1000 && bigCalls.every((p, i) => p === i);
  if (bigPagesOk && new Set(bigJobs.map((j) => j.url)).size === 1000 * 50) pass('fetch() clamps max_pages to the 1000-page cap (pages 0..999, distinct jobs)');
  else fail(`cap clamp = ${JSON.stringify({ calls: bigCalls.length, jobs: bigJobs?.length })}`);
  if (warnings.some((w) => w.includes('truncated at max_pages=1000'))) pass('fetch() warns when the cap truncates the feed');
  else fail(`cap warning missing; captured = ${JSON.stringify(warnings)}`);

  // Cap boundary from both directions: max_pages=1000 is NOT clamped
  // (exactly 1000 calls), max_pages=1001 IS (also 1000) — pins the cap at
  // exactly 1000 against off-by-one regressions in resolveMaxPages.
  const atCapCalls = [];
  const atCapReal = console.error;
  try {
    console.error = () => {};
    await provider.fetch({ max_pages: 1000 }, mkCapCtx(atCapCalls));
  } finally {
    console.error = atCapReal;
  }
  const overCapCalls = [];
  const overCapReal = console.error;
  try {
    console.error = () => {};
    await provider.fetch({ max_pages: 1001 }, mkCapCtx(overCapCalls));
  } finally {
    console.error = overCapReal;
  }
  if (atCapCalls.length === 1000 && overCapCalls.length === 1000) pass('fetch() cap boundary: max_pages=1000 runs unclamped, 1001 clamps to 1000');
  else fail(`cap boundary = ${JSON.stringify({ at: atCapCalls.length, over: overCapCalls.length })}`);

  // Invalid max_pages values (0, non-integer string) fall back to the
  // 6-page default — pins resolveMaxPages' guard to the new default.
  for (const [label, bad] of [['0', 0], ['"350" (string)', '350']]) {
    const badCalls = [];
    const badReal = console.error;
    try {
      console.error = () => {};
      await provider.fetch({ max_pages: bad }, mkCapCtx(badCalls));
    } finally {
      console.error = badReal;
    }
    if (badCalls.length === 6) pass(`fetch() falls back to the 6-page default for invalid max_pages=${label}`);
    else fail(`invalid max_pages=${label} fetched ${badCalls.length} pages`);
  }

  // fetch(): malformed payload throws with a useful message.
  let threw = false;
  try {
    await provider.fetch({}, { fetchJson: async () => ({ nope: true }) });
  } catch (e) {
    threw = /unexpected API response/.test(String(e?.message));
  }
  if (threw) pass('fetch() throws on a payload without jobs[]');
  else fail('fetch() did not throw on malformed payload');

  // ── transient upstream failures must not kill the whole board (#2506) ──
  // 350 pages at 50/page: one 5xx anywhere in that range used to abort the
  // provider and return NOTHING. Retries are bounded, use ctx.sleep so the
  // test never wall-clock waits, and a PERSISTENT failure must still throw —
  // a silent partial board is worse than a loud empty one.
  const okPage = { jobs: [{ id: 'a1', title: 'Backend Engineer', company_name: 'Acme', url: 'https://speedrun-talent-network.com/jobs/a1' }], total_pages: 1 };

  {
    let attempts = 0;
    const slept = [];
    const flakyCtx = {
      sleep: async (ms) => { slept.push(ms); },
      fetchJson: async () => {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('HTTP 500 Internal Server Error');
          err.status = 500;
          throw err;
        }
        return okPage;
      },
    };
    const jobs = await provider.fetch({}, flakyCtx);
    if (attempts === 2 && jobs.length === 1) pass('fetch() retries a transient 5xx and still returns the page (#2506)');
    else fail(`transient 5xx not retried: attempts=${attempts}, jobs=${jobs.length}`);
    if (slept.length === 1 && slept[0] > 0) pass('fetch() backs off between attempts via ctx.sleep (#2506)');
    else fail(`unexpected backoff pattern: ${JSON.stringify(slept)}`);
  }

  {
    // Persistent failure: still throws, no silent partial.
    let attempts = 0;
    const deadCtx = {
      sleep: async () => {},
      fetchJson: async () => {
        attempts += 1;
        const err = new Error('HTTP 503 Service Unavailable');
        err.status = 503;
        throw err;
      },
    };
    let persistentThrew = false;
    try { await provider.fetch({}, deadCtx); } catch { persistentThrew = true; }
    if (persistentThrew && attempts === 3) pass('fetch() gives up loudly after 3 bounded attempts, never a silent partial (#2506)');
    else fail(`persistent failure handling wrong: threw=${persistentThrew}, attempts=${attempts}`);
  }

  {
    // Every jittered delay must stay within the policy's maxDelayMs. The cap is
    // applied to the backoff MINUS the jitter, so the total honours the limit
    // without the jitter being erased at the cap (where de-synchronising
    // concurrent retries matters most).
    //
    // Math.random is stubbed so the CAPPED attempts are deterministically
    // distinct: an earlier version of this test checked every delay, which
    // included the pre-cap 400/800 steps and therefore passed even if all
    // cap-level delays were identical — it did not test the property it named.
    const slept = [];
    const maxDelayMs = 1_000;
    const ctx = {
      sleep: async (ms) => { slept.push(ms); },
      fetchJson: async () => { const e = new Error('HTTP 500'); e.status = 500; throw e; },
    };
    const realRandom = Math.random;
    const seq = [0, 0.25, 0.5, 0.75, 1];
    let i = 0;
    Math.random = () => seq[i++ % seq.length];
    try {
      await fetchJsonWithRetry(ctx, 'https://example.test/x', {}, { retries: 5, baseDelayMs: 400, maxDelayMs });
    } catch { /* expected */ } finally {
      Math.random = realRandom;
    }
    // baseDelayMs 400 → 400, 800, then every later attempt sits at the cap.
    const capped = slept.slice(2);
    if (slept.every((ms) => ms >= 0 && ms <= maxDelayMs)) pass('retry backoff never exceeds maxDelayMs once jitter is added (#2506)');
    else fail(`a jittered delay left [0, maxDelayMs]: ${JSON.stringify(slept)}`);
    if (capped.length > 1 && new Set(capped).size > 1) pass('jitter survives AT THE CAP, so concurrent retries de-synchronise (#2506)');
    else fail(`capped delays were identical — jitter erased at the cap: ${JSON.stringify(capped)}`);
  }

  {
    // A maxDelayMs below the jitter must not drive the backoff negative and
    // hand ctx.sleep a negative delay.
    const slept = [];
    const ctx = {
      sleep: async (ms) => { slept.push(ms); },
      fetchJson: async () => { const e = new Error('HTTP 500'); e.status = 500; throw e; },
    };
    try {
      await fetchJsonWithRetry(ctx, 'https://example.test/x', {}, { retries: 3, baseDelayMs: 400, maxDelayMs: 100 });
    } catch { /* expected */ }
    if (slept.length > 0 && slept.every((ms) => ms >= 0 && ms <= 100)) {
      pass('a maxDelayMs below the jitter still yields non-negative delays inside the cap (#2506)');
    } else {
      fail(`sub-jitter maxDelayMs produced out-of-range delays: ${JSON.stringify(slept)}`);
    }
  }

  {
    // A non-retryable 4xx must fail fast — retrying a bad request burns time.
    let attempts = 0;
    const badReqCtx = {
      sleep: async () => {},
      fetchJson: async () => {
        attempts += 1;
        const err = new Error('HTTP 404 Not Found');
        err.status = 404;
        throw err;
      },
    };
    let fastFailed = false;
    try { await provider.fetch({}, badReqCtx); } catch { fastFailed = true; }
    if (fastFailed && attempts === 1) pass('fetch() does not retry a non-retryable 4xx (#2506)');
    else fail(`4xx retry behaviour wrong: threw=${fastFailed}, attempts=${attempts}`);
  }

  // ── Feed filters ──────────────────────────────────────────────────────────
  // `a16z_speedrun_talent.filters` is passed to the feed's query on every page,
  // for documented parameters only; a typo or an invalid value throws before any
  // request, so the scan does not quietly read the whole board.
  const srUrl = (i) => `https://speedrun-talent-network.com/jobs/f${i}`;
  const oneJob = (extra = {}) => ({ id: 'f-1', title: 'T', url: srUrl(1), ...extra });
  const recordCtx = (calls, body = { jobs: [oneJob()], total_pages: 1 }) => ({ fetchJson: async (url) => { calls.push(url); return body; } });
  const filterCalls = [];
  await provider.fetch({
    name: 'sr', q: 'engineer',
    a16z_speedrun_talent: { filters: {
      scope: 'everywhere', fn: 'engineering', wp: 'remote', sen: ['senior', 'staff', '_'], posted: '7d', sort: 'new',
      comp: 150000, remote: true, ai: 1, founding: false, loc: 'remote, berlin', stealth: 'hide', fn_unknown_blank: '', cohort: null,
    } },
  }, recordCtx(filterCalls)).catch(() => {});
  const q0 = filterCalls[0] ? new URL(filterCalls[0]).searchParams : null;
  const got = q0 ? Object.fromEntries(q0) : null;
  if (got && JSON.stringify(got) === JSON.stringify({
    page: '0', source: 'career-ops', q: 'engineer', scope: 'everywhere', fn: 'engineering', wp: 'remote', sen: 'senior,staff,_', posted: '7d',
    sort: 'new', comp: '150000', remote: '1', ai: '1', loc: 'remote,berlin', stealth: 'hide',
  })) pass('fetch() passes documented filters to the feed query: lists joined, flags as 1, blank and false skipped, page, source and q kept');
  else fail(`filters query = ${JSON.stringify(got)}`);

  const locForms = [['San Francisco', 'New York'], 'San Francisco, New York', ["Saint-Denis", "O'Fallon", 'St. Louis', 'Zürich']];
  const locGot = [];
  for (const loc of locForms) {
    const c = [];
    await provider.fetch({ name: 'sr', a16z_speedrun_talent: { filters: { loc } } }, recordCtx(c));
    locGot.push(c[0] ? new URL(c[0]).searchParams.get('loc') : null);
  }
  if (JSON.stringify(locGot) === JSON.stringify(['San Francisco,New York', 'San Francisco,New York', "Saint-Denis,O'Fallon,St. Louis,Zürich"]))
    pass('fetch() takes multiword city names in loc, as a list or a string, keeping internal spaces');
  else fail(`loc forms = ${JSON.stringify(locGot)}`);

  const plainCalls = [];
  await provider.fetch({ name: 'sr' }, recordCtx(plainCalls));
  if (plainCalls.length === 1 && [...new URL(plainCalls[0]).searchParams.keys()].join() === 'page,source') pass('fetch() sends only page and source when the entry has no filters');
  else fail(`default query = ${JSON.stringify(plainCalls)}`);

  const badFilters = [
    { bogus: 'x' }, { page: 3 }, { source: 'x' }, { q: 'x' },
    { posted: '1y' }, { scope: 'galaxy' }, { sort: 'oldest' }, { stealth: 'maybe' },
    { comp: -1 }, { comp: '150000' }, { comp: 1.5 }, { remote: 'yes' }, { ai: 2 },
    { sen: ['senior', false] }, { sen: ['senior', 7] }, { loc: 'San Francisco, a\nb' }, { loc: ['x;y'] }, { fn: ['San Francisco'] }, { fn: 'a&page=3' }, { fn: [' ', ''] }, { fn: ['ok', 'bad value'] }, { fn: {} }, { sen: false }, { wp: 7 }, { loc: true },
    { metro: 'sf,nyc,la,sv,dc,chi' }, { company: 5 }, { company: 'x'.repeat(121) },
  ];
  let refused = 0;
  const refusedCalls = [];
  for (const filters of badFilters) {
    try { await provider.fetch({ name: 'sr', a16z_speedrun_talent: { filters } }, recordCtx(refusedCalls)); } catch (e) { if (/a16z-speedrun-talent: sr — /.test(e.message)) refused++; }
  }
  for (const filters of ['fn=engineering', ['fn'], 7]) {
    try { await provider.fetch({ name: 'sr', a16z_speedrun_talent: { filters } }, recordCtx(refusedCalls)); } catch (e) { if (/filters must be a map/.test(e.message)) refused++; }
  }
  const badSettings = ['x', ['filters'], { fetchDetails: 'true' }, { fetchDetails: 1 }, { detailLimit: 0 }, { detailLimit: '50' }, { detailLimit: 2.5 }, { fetchDetail: true }, { detail_limit: 50 }];
  let refusedSettings = 0;
  for (const settings of badSettings) {
    try { await provider.fetch({ name: 'sr', a16z_speedrun_talent: settings }, recordCtx(refusedCalls)); } catch (e) { if (/a16z-speedrun-talent: sr — /.test(e.message)) refusedSettings++; }
  }
  if (refusedSettings === badSettings.length && refusedCalls.length === 0) pass('fetch() throws on settings that are not a map, a fetchDetails that is not a boolean or a detailLimit that is not a positive integer, before any request');
  else fail(`bad settings refused ${refusedSettings} of ${badSettings.length}, requests made: ${refusedCalls.length}`);
  if (refused === badFilters.length + 3 && refusedCalls.length === 0) pass('fetch() throws on an unknown filter, an invalid value or a filters that is not a map, before any request');
  else fail(`bad filters refused ${refused} of ${badFilters.length + 3}, requests made: ${refusedCalls.length}`);

  // ── Detail reads ──────────────────────────────────────────────────────────
  // Off by default. When on: the employer's own posting becomes the job url, and
  // description_text the description. Bounded by detailLimit, five at a time.
  const detailJobs = Array.from({ length: 12 }, (_, i) => ({ id: `d-${i}`, title: `D${i}`, url: srUrl(i), company: 'Co' }));
  const detailFor = (id) => {
    const i = Number(id.slice(2));
    if (i === 0) return { status: 'open', description_text: '  Build things.  ', apply: { kind: 'external', url: 'https://boards.greenhouse.io/acme/jobs/1' } };
    if (i === 1) return { status: 'open', description_text: 'Onsite apply.', apply: { kind: 'onsite', url: srUrl(1) } };
    if (i === 2) return { status: 'open', description_text: 'Hands off to speedrun.', apply: { kind: 'external', url: 'https://speedrun-talent-network.com/go/2' } };
    if (i === 3) return { status: 'open', description_text: 'Insecure.', apply: { kind: 'external', url: 'http://jobs.acme.example/3' } };
    if (i === 4) return { status: 'closed', description_text: null, apply: null };
    if (i === 5) return { status: 'open', description_text: '   ', apply: { kind: 'external', url: 'not a url' } };
    return { status: 'open', description_text: `Text ${i}`, apply: { kind: 'external', url: `https://jobs.acme.example/${i}` } };
  };
  const detailRun = async (entryExtra, { failId, probe } = {}) => {
    const calls = [];
    let inFlight = 0;
    let peak = 0;
    const warnings = [];
    const realError = console.error;
    console.error = (...args) => { warnings.push(args.join(' ')); };
    let rows;
    try {
      rows = await provider.fetch({ name: 'sr', ...entryExtra }, {
        ...(probe ? { maxPages: 1 } : {}),
        sleep: async () => {},
        fetchJson: async (url) => {
          calls.push(url);
          if (!new URL(url).pathname.startsWith('/api/v1/jobs/')) return { jobs: detailJobs, total_pages: 1 };
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;
          const id = decodeURIComponent(new URL(url).pathname.split('/').pop());
          if (id === failId) { const e = new Error('HTTP 404'); e.status = 404; throw e; }
          return { job: detailFor(id) };
        },
      });
    } finally {
      console.error = realError;
    }
    return { rows, detailCalls: calls.filter((u) => new URL(u).pathname.startsWith('/api/v1/jobs/')), peak, warnings };
  };

  const noDetails = await detailRun({});
  if (noDetails.detailCalls.length === 0 && noDetails.rows.every((r) => !('description' in r) && r.url.startsWith('https://speedrun-talent-network.com/jobs/')))
    pass('fetch() reads no job detail unless fetchDetails is true');
  else fail(`default detail calls = ${noDetails.detailCalls.length}`);

  // Detail batches are paced: one pause before each batch after the first.
  const pauses = [];
  await provider.fetch({ name: 'sr', a16z_speedrun_talent: { fetchDetails: true, detailLimit: 12 } }, {
    sleep: async (ms) => { pauses.push(ms); },
    fetchJson: async (url) => (new URL(url).pathname === '/api/v1/jobs' ? { jobs: detailJobs, total_pages: 1 } : { job: { status: 'open' } }),
  });
  if (pauses.length === 2 && pauses.every((ms) => ms > 0)) pass('fetch() pauses between detail batches, not before the first');
  else fail(`detail pauses = ${JSON.stringify(pauses)}`);

  const withDetails = await detailRun({ a16z_speedrun_talent: { fetchDetails: true, detailLimit: 8 } }, { failId: 'd-6' });
  const byTitle = Object.fromEntries(withDetails.rows.map((r) => [r.title, r]));
  if (byTitle.D0.url === 'https://boards.greenhouse.io/acme/jobs/1' && byTitle.D0.description === 'Build things.' && byTitle.D0.externalId === 'd-0')
    pass('fetch() with fetchDetails sets url to the employer apply url and description to description_text, keeping externalId');
  else fail(`detail row = ${JSON.stringify(byTitle.D0)}`);
  if ([1, 2, 3, 4, 5].every((i) => byTitle[`D${i}`].url === srUrl(i)))
    pass('fetch() keeps the feed url for an onsite apply, a speedrun-host apply, an http apply, a closed role and an invalid apply url');
  else fail(`kept urls = ${JSON.stringify([1, 2, 3, 4, 5].map((i) => byTitle[`D${i}`].url))}`);
  if (byTitle.D1.description === 'Onsite apply.' && !('description' in byTitle.D4) && !('description' in byTitle.D5))
    pass('fetch() sets no description for a closed role or a blank description_text');
  else fail(`descriptions = ${JSON.stringify([byTitle.D1.description, byTitle.D4.description, byTitle.D5.description])}`);
  if (withDetails.detailCalls.length === 8 && !('description' in byTitle.D8) && byTitle.D8.url === srUrl(8)
      && withDetails.detailCalls.every((u) => new URL(u).searchParams.get('source') === 'career-ops' && new URL(u).origin === 'https://speedrun-talent-network.com'))
    pass('fetch() reads at most detailLimit details, with source=career-ops, on the feed host');
  else fail(`detailLimit calls = ${withDetails.detailCalls.length}`);
  if (withDetails.peak === 5 && withDetails.rows.length === 12) pass('fetch() reads details five at a time');
  else fail(`detail concurrency peak = ${withDetails.peak}`);
  if (byTitle.D6.url === srUrl(6) && !('description' in byTitle.D6) && byTitle.D7.url === 'https://jobs.acme.example/7'
      && withDetails.warnings.length === 1 && withDetails.warnings[0].includes('1 of 8 job details not read'))
    pass('fetch() keeps a job as listed and warns once when its detail fails, and still reads the others');
  else fail(`failed detail = ${JSON.stringify({ d6: byTitle.D6, d7: byTitle.D7.url, warnings: withDetails.warnings })}`);

  const defaultLimit = await detailRun({ a16z_speedrun_talent: { fetchDetails: true } });
  const bigLimit = await detailRun({ a16z_speedrun_talent: { fetchDetails: true, detailLimit: 5000 } });
  if (defaultLimit.detailCalls.length === 12 && bigLimit.detailCalls.length === 12)
    pass('fetch() accepts a missing or oversized detailLimit and reads at most the jobs listed');
  else fail(`detailLimit variants = ${JSON.stringify([defaultLimit, bigLimit].map((r) => r.detailCalls.length))}`);

  const manyJobs = Array.from({ length: 150 }, (_, i) => ({ id: `m-${i}`, title: `M${i}`, url: srUrl(1000 + i) }));
  const limitCalls = [];
  await provider.fetch({ name: 'sr', a16z_speedrun_talent: { fetchDetails: true, detailLimit: 5000 } }, {
    sleep: async () => {},
    fetchJson: async (url) => { limitCalls.push(url); return new URL(url).pathname === '/api/v1/jobs' ? { jobs: manyJobs, total_pages: 1 } : { job: { status: 'open' } }; },
  });
  if (limitCalls.length === 1 + 100) pass('fetch() caps detailLimit at 100');
  else fail(`detailLimit cap = ${limitCalls.length - 1} detail calls`);

  const oddIdCalls = [];
  const oddIdRows = await provider.fetch({ name: 'sr', a16z_speedrun_talent: { fetchDetails: true } }, {
    fetchJson: async (url) => { oddIdCalls.push(url); return new URL(url).pathname === '/api/v1/jobs' ? { jobs: [{ id: 'bad-\uD800', title: 'Odd', url: srUrl(77) }], total_pages: 1 } : { job: { status: 'open' } }; },
  });
  if (oddIdCalls.length === 1 && oddIdRows.length === 1 && oddIdRows[0].url === srUrl(77)) pass('fetch() skips the detail read for an id with a lone surrogate and keeps the job');
  else fail(`lone-surrogate id = ${JSON.stringify({ calls: oddIdCalls.length, rows: oddIdRows.length })}`);

  const probed = await detailRun({ a16z_speedrun_talent: { fetchDetails: true } }, { probe: true });
  if (probed.detailCalls.length === 0) pass('fetch() reads no details under a ctx.maxPages probe');
  else fail(`probe detail calls = ${probed.detailCalls.length}`);

  // ── Salary ────────────────────────────────────────────────────────────────
  // An annual band (comp_period "year", or null, which the feed defines as annual)
  // sets salary; other periods, no numbers or invalid bounds set none.
  const comp = (comp_min, comp_max, comp_currency = 'USD', comp_period = null) => normalizeSpeedrunJob({ title: 'T', url: srUrl(9), comp_min, comp_max, comp_currency, comp_period });
  const band = comp(150000, 200000);
  if (JSON.stringify(band?.salary) === JSON.stringify({ min: 150000, max: 200000, currency: 'USD', period: 'year', posted: { min: 150000, max: 200000 } })
      && JSON.stringify(comp(90000, 120000, 'eur', 'year')?.salary) === JSON.stringify({ min: 90000, max: 120000, currency: 'EUR', period: 'year', posted: { min: 90000, max: 120000 } }))
    pass('normalizeSpeedrunJob maps an annual comp band (comp_period null or year) with its upper-cased currency');
  else fail(`annual salary = ${JSON.stringify([band?.salary, comp(90000, 120000, 'eur', 'year')?.salary])}`);
  if (JSON.stringify(comp(100000, null)?.salary) === JSON.stringify({ min: 100000, max: 100000, currency: 'USD', period: 'year', posted: { min: 100000 } })
      && JSON.stringify(comp(null, 100000, null)?.salary) === JSON.stringify({ min: 100000, max: 100000, period: 'year', posted: { max: 100000 } }))
    pass('normalizeSpeedrunJob fills a one-sided band, keeps the posted bound as given, and leaves currency out when the feed gives none');
  else fail(`one-sided salary = ${JSON.stringify([comp(100000, null)?.salary, comp(null, 100000, null)?.salary])}`);
  const noPay = [comp(50, 80, 'USD', 'hour'), comp(5000, 6000, 'USD', 'month'), comp(1, 2, 'USD', 'week'), comp(1, 2, 'USD', 'day'), comp(null, null), comp(0, 0), comp('150000', '200000'), comp(NaN, Infinity), comp(-5, -1)];
  if (noPay.every((j) => j && !('salary' in j))) pass('normalizeSpeedrunJob sets no salary for a non-annual band, no numbers, zero, text, non-finite or negative bounds');
  else fail(`no-salary cases = ${JSON.stringify(noPay.map((j) => j?.salary))}`);
  const viaFetch = await provider.fetch({ name: 'sr' }, recordCtx([], { jobs: [oneJob({ comp_min: 120000, comp_max: 160000, comp_currency: 'USD', comp_period: null })], total_pages: 1 }));
  if (viaFetch[0]?.salary?.min === 120000 && viaFetch[0].salary.max === 160000) pass('fetch() carries the feed comp band through as salary');
  else fail(`fetch() salary = ${JSON.stringify(viaFetch[0]?.salary)}`);
} catch (e) {
  fail(`a16z-speedrun-talent provider test crashed: ${e?.stack || e}`);
}
