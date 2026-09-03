// tests/providers/workday-facet-split.test.mjs — facet-split recovery for
// Workday tenants whose CXS backend clamps `total` (and pagination) at 2,000.
import { pass, fail, ROOT, captureConsoleErrors } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — workday facet-split');

// Trimmed from a live dickssportinggoods|wd1|dsg page-0 response (2026-08-25).
// `total` came back 2,000 while the facet counts sum to ~8,4xx — the clamp this
// whole feature exists to route around. Counts are the real ones; the value
// lists are truncated to what the assertions below need.
const DSG_FACETS = [
  {
    facetParameter: 'CF_-_Location_Type__EEB__Extended',
    descriptor: 'Brand',
    values: [
      { id: 'brand-dsg', descriptor: "DICK'S Sporting Goods", count: 7813 },
      { id: 'brand-hos', descriptor: 'House of Sport', count: 403 },
      { id: 'brand-gg', descriptor: 'Golf Galaxy', count: 188 },
      { id: 'brand-pl', descriptor: 'Public Lands', count: 11 },
    ],
  },
  {
    facetParameter: 'timeType',
    descriptor: 'Time Type',
    values: [
      { id: 'tt-part', descriptor: 'Part time', count: 7044 },
      { id: 'tt-full', descriptor: 'Full time', count: 1307 },
    ],
  },
  {
    facetParameter: 'workerSubType',
    descriptor: 'Job Type',
    values: [
      { id: 'wst-reg', descriptor: 'Regular', count: 8316 },
      { id: 'wst-tmp', descriptor: 'Temporary', count: 109 },
    ],
  },
  {
    facetParameter: 'jobFamily',
    descriptor: 'Job Family',
    values: [
      { id: 'jf-teammate', descriptor: 'Field - Teammate', count: 6564 },
      { id: 'jf-specialist', descriptor: 'Field - Specialist', count: 545 },
      { id: 'jf-captain', descriptor: 'Field - Captain', count: 424 },
      { id: 'jf-sales', descriptor: 'Field - Hourly (Sales)', count: 253 },
    ],
  },
  // Live tenants carry group headers with no id and no count — never splittable.
  {
    facetParameter: 'locationMainGroup',
    descriptor: null,
    values: [
      { id: null, descriptor: 'Location - State', count: null },
      { id: null, descriptor: 'Locations', count: null },
    ],
  },
];

try {
  const workdayModule = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);
  const workday = workdayModule.default;
  const { trueTotalFromFacets, chooseSplitFacet } = workdayModule;

  // ── trueTotalFromFacets ───────────────────────────────────────────

  // The clamp is only detectable by comparing the reported total against what
  // the facets add up to; without this the caller cannot tell a genuine
  // 2,000-posting board from a 8,000-posting board reporting 2,000.
  const dsgTrue = trueTotalFromFacets(DSG_FACETS);
  if (dsgTrue === 8425) {
    pass('trueTotalFromFacets() recovers the real board size from facet counts (8425 > clamped 2000)');
  } else {
    fail(`trueTotalFromFacets(DSG) returned ${dsgTrue}, expected 8425`);
  }

  if (trueTotalFromFacets([]) === null && trueTotalFromFacets(undefined) === null) {
    pass('trueTotalFromFacets() returns null when there are no facets to read');
  } else {
    fail('trueTotalFromFacets() should return null for empty/absent facets');
  }

  // A facet whose values carry no counts tells us nothing about board size —
  // summing them would report 0 and read as "empty board".
  const uncounted = trueTotalFromFacets([
    { facetParameter: 'locationMainGroup', values: [{ id: null, count: null }, { id: null, count: null }] },
  ]);
  if (uncounted === null) {
    pass('trueTotalFromFacets() ignores facets whose values carry no usable counts');
  } else {
    fail(`trueTotalFromFacets(uncounted) returned ${uncounted}, expected null`);
  }

  // ── chooseSplitFacet ──────────────────────────────────────────────

  // Every facet here covers the same board, so the only thing that matters is
  // which one produces the smallest worst-case slice: jobFamily's 6564 beats
  // timeType's 7044, Brand's 7813 and workerSubType's 8316.
  const chosen = chooseSplitFacet(DSG_FACETS);
  if (chosen && chosen.facetParameter === 'jobFamily') {
    pass('chooseSplitFacet() picks the facet with the smallest largest-slice (jobFamily)');
  } else {
    fail(`chooseSplitFacet(DSG) chose ${JSON.stringify(chosen?.facetParameter)}, expected "jobFamily"`);
  }

  if (chosen && chosen.values.length === 4 && chosen.values.every((v) => typeof v.id === 'string')) {
    pass('chooseSplitFacet() returns the facet values to iterate, each with an id');
  } else {
    fail(`chooseSplitFacet(DSG).values malformed: ${JSON.stringify(chosen?.values)}`);
  }

  // Re-splitting a slice must not re-apply the facet already applied, or the
  // recursion re-derives the same partition forever.
  const excluded = chooseSplitFacet(DSG_FACETS, { exclude: ['jobFamily'] });
  if (excluded && excluded.facetParameter === 'timeType') {
    pass('chooseSplitFacet() honors exclude and falls through to the next-best facet');
  } else {
    fail(`chooseSplitFacet(exclude jobFamily) chose ${JSON.stringify(excluded?.facetParameter)}, expected "timeType"`);
  }

  // A single-valued facet is not a partition — applying it fetches the same
  // board again under a filter, which is how a split loop turns into a spin.
  const singleValue = chooseSplitFacet([
    { facetParameter: 'onlyOne', values: [{ id: 'a', count: 5000 }] },
  ]);
  if (singleValue === null) {
    pass('chooseSplitFacet() rejects a single-valued facet — not a partition');
  } else {
    fail(`chooseSplitFacet(single) returned ${JSON.stringify(singleValue)}, expected null`);
  }

  if (chooseSplitFacet([{ facetParameter: 'locationMainGroup', values: [{ id: null, count: null }, { id: null, count: null }] }]) === null) {
    pass('chooseSplitFacet() rejects facets whose values have no id (id-less group headers)');
  } else {
    fail('chooseSplitFacet() should reject id-less facet values');
  }

} catch (e) {
  fail(`workday facet-split tests crashed: ${e.message}`);
}

// ── workday.fetch() integration ─────────────────────────────────────

try {
  const workdayModule = await import(pathToFileURL(join(ROOT, 'providers/workday.mjs')).href);
  const workday = workdayModule.default;

  const ENTRY = { name: 'Acme', careers_url: 'https://acme.wd1.myworkdayjobs.com/acme' };

  const mkCtx = (fetchJson, extra = {}) => ({
    transport: 'http',
    fetchText: async () => { throw new Error('fetchText should not be called'); },
    fetchJson,
    sleep: async () => {},
    ...extra,
  });

  // Stable key for "which facet filter is this request under", so a mock can
  // answer per slice. Sorted so {a,b} and {b,a} address the same slice.
  const sliceKey = (appliedFacets) => Object.entries(appliedFacets || {})
    .map(([param, ids]) => `${param}=${[].concat(ids).join(',')}`)
    .sort()
    .join('&');

  // Distinct postings per (tag, offset), so a page that is actually fetched is
  // distinguishable from one that is not.
  const postings = (tag, offset, n = 20) => Array.from({ length: n }, (_, i) => ({
    title: `${tag} job ${offset + i}`,
    externalPath: `/job/city/${tag}-${offset + i}`,
    postedOn: 'Posted Today',
  }));

  // A clamped tenant: reports total=2000 (the offset ceiling) while its own
  // jobFamily counts add up to 2700. Both slices answer honestly.
  const clampedResponder = (sliceTotals) => async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const key = sliceKey(body.appliedFacets);
    if (key === '') {
      return {
        total: 2000,
        facets: [{ facetParameter: 'jobFamily', values: [{ id: 'a', count: 1500 }, { id: 'b', count: 1200 }] }],
        jobPostings: postings('unfaceted', body.offset),
      };
    }
    const tag = sliceTotals[key];
    if (!tag) throw new Error(`unexpected slice ${JSON.stringify(key)}`);
    return { total: 20, facets: [], jobPostings: body.offset === 0 ? postings(tag, 0) : [] };
  };

  const calls = [];
  const clampedJobs = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (url, opts) => {
    calls.push({ key: sliceKey(JSON.parse(opts.body).appliedFacets), offset: JSON.parse(opts.body).offset });
    return clampedResponder({ 'jobFamily=a': 'a', 'jobFamily=b': 'b' })(url, opts);
  }, { includeUndated: true }))).then((r) => r.result);

  const facetedKeys = [...new Set(calls.map((c) => c.key))].filter(Boolean).sort();
  if (facetedKeys.join('|') === 'jobFamily=a|jobFamily=b') {
    pass('workday.fetch() re-issues the query once per facet value when total is clamped at the offset ceiling');
  } else {
    fail(`facet-split issued slices ${JSON.stringify(facetedKeys)}, expected jobFamily=a and jobFamily=b`);
  }

  // The regression that matters most: everything below the ceiling is real and
  // reachable, so the split has to be ADDITIVE. An earlier version skipped the
  // unfaceted crawl on detecting the clamp and returned 917 of 8,423 postings
  // on a live tenant — fewer than doing nothing at all.
  const unfacetedPages = calls.filter((c) => c.key === '').length;
  if (unfacetedPages === 100) {
    pass('workday.fetch() still paginates the clamped query to the ceiling — the split adds to that floor, never replaces it');
  } else {
    fail(`clamped tenant fetched ${unfacetedPages} unfaceted pages, expected 100 (the ceiling)`);
  }

  if (clampedJobs.length === 2040) {
    pass('workday.fetch() returns the unfaceted crawl plus every slice (2000 + 20 + 20)');
  } else {
    fail(`facet-split returned ${clampedJobs.length} jobs, expected 2040`);
  }

  // Slices overlap wherever a posting carries several facet values; without a
  // dedup the union double-counts them.
  const overlapJobs = await captureConsoleErrors(() => workday.fetch(
    ENTRY,
    mkCtx(clampedResponder({ 'jobFamily=a': 'a', 'jobFamily=b': 'a' }), { includeUndated: true }),
  )).then((r) => r.result);
  if (overlapJobs.length === 2020) {
    pass('workday.fetch() dedups postings returned by more than one slice');
  } else {
    fail(`facet-split with overlapping slices returned ${overlapJobs.length} jobs, expected 2020`);
  }

  // A slice can be clamped in its own right; it has to split again on a facet
  // that has not been applied yet. Totals are kept to one page so the assertion
  // is about split shape, not pagination.
  const NESTED = {
    '': {
      total: 20,
      facets: [{ facetParameter: 'jobFamily', values: [{ id: 'a', count: 2600 }, { id: 'b', count: 100 }] }],
      tag: 'unfaceted',
    },
    'jobFamily=a': {
      total: 20,
      facets: [{ facetParameter: 'timeType', values: [{ id: 'p', count: 1400 }, { id: 'f', count: 1200 }] }],
      tag: 'a',
    },
    'jobFamily=a&timeType=f': { total: 20, facets: [], tag: 'af' },
    'jobFamily=a&timeType=p': { total: 20, facets: [], tag: 'ap' },
    'jobFamily=b': { total: 20, facets: [], tag: 'b' },
  };
  const nestedCalls = [];
  const nestedJobs = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const key = sliceKey(body.appliedFacets);
    nestedCalls.push(key);
    const res = NESTED[key];
    if (!res) throw new Error(`unexpected slice ${JSON.stringify(key)}`);
    return { total: res.total, facets: res.facets, jobPostings: postings(res.tag, body.offset) };
  }, { includeUndated: true }))).then((r) => r.result);

  if (nestedCalls.includes('jobFamily=a&timeType=p') && nestedCalls.includes('jobFamily=a&timeType=f')) {
    pass('workday.fetch() re-splits a still-clamped slice on a second, not-yet-applied facet');
  } else {
    fail(`nested split issued ${JSON.stringify([...new Set(nestedCalls)])}, expected jobFamily=a x timeType slices`);
  }

  if (nestedJobs.length === 100) {
    pass('workday.fetch() returns the union across both split levels (unfaceted + a + b + ap + af)');
  } else {
    fail(`nested split returned ${nestedJobs.length} jobs, expected 100`);
  }

  // Depth has to bottom out: a tenant that reports a clamp at every level, on a
  // facet it never runs out of, would otherwise recurse until the board does.
  let deepCalls = 0;
  const { result: deepJobs } = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    deepCalls++;
    if (deepCalls > 100) throw new Error('runaway facet split');
    const depth = Object.keys(body.appliedFacets || {}).length;
    return {
      total: 20,
      facets: [{ facetParameter: `f${depth}`, values: [{ id: 'x', count: 2600 }, { id: 'y', count: 2600 }] }],
      jobPostings: postings(`d${depth}`, body.offset),
    };
  }, { includeUndated: true })));

  if (deepCalls <= 100) {
    pass('workday.fetch() bounds the facet split instead of recursing while the tenant keeps claiming a clamp');
  } else {
    fail(`facet split made ${deepCalls} requests — unbounded`);
  }

  if (deepJobs.workdayTruncated === true) {
    pass('workday.fetch() tags a board it could not fully cover as truncated rather than reporting it complete');
  } else {
    fail('facet split that ran out of depth should tag jobs.workdayTruncated');
  }

  // A pathological facet fan-out must not be able to spend a whole sweep on one
  // tenant: the live DSG board splits into 24 values whose dominant slice stays
  // clamped at every level, so the page budget is the only thing bounding it.
  let budgetCalls = 0;
  await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    budgetCalls++;
    if (budgetCalls > 2000) throw new Error('page budget not enforced');
    const depth = Object.keys(body.appliedFacets || {}).length;
    return {
      total: 2000,
      facets: [{
        facetParameter: `f${depth}`,
        values: Array.from({ length: 24 }, (_, i) => ({ id: `v${i}`, count: 2600 })),
      }],
      jobPostings: postings(`b${depth}`, body.offset),
    };
  }, { includeUndated: true })));
  // max_pages (100) * SPLIT_PAGE_BUDGET_FACTOR (5), plus the page-0 of the
  // slice that discovers the budget is gone.
  if (budgetCalls <= 501) {
    pass('workday.fetch() caps total pages per tenant so one pathological board cannot eat a sweep');
  } else {
    fail(`clamped fan-out spent ${budgetCalls} requests, expected <= 501`);
  }


  // A slice that dies mid-pagination comes back with stopReason 'fetch-error'
  // and clamped:false — indistinguishable, to the `!result.clamped` early
  // return, from a slice that finished. Absorbing its partial jobs and calling
  // the board recovered is the exact failure this feature exists to prevent:
  // a recovery line printed WITHOUT the "(still incomplete)" tag.
  const dyingSliceCalls = [];
  const { result: dyingJobs, errors: dyingErrors } = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const key = sliceKey(body.appliedFacets);
    dyingSliceCalls.push({ key, offset: body.offset });
    if (key === '') {
      return {
        total: 2000,
        facets: [{ facetParameter: 'jobFamily', values: [{ id: 'a', count: 1500 }, { id: 'b', count: 1200 }] }],
        jobPostings: postings('unfaceted', body.offset),
      };
    }
    // Slice 'a' claims two pages, then its second page fails for good.
    if (key === 'jobFamily=a') {
      if (body.offset === 0) return { total: 40, facets: [], jobPostings: postings('a', 0) };
      throw new Error('503 from the WAF');
    }
    return { total: 20, facets: [], jobPostings: body.offset === 0 ? postings('b', 0) : [] };
  }, { includeUndated: true })));

  const dyingRecoveryLine = dyingErrors.find((e) => String(e).includes('offset-clamped at'));
  if (dyingRecoveryLine && String(dyingRecoveryLine).includes('(still incomplete)')) {
    pass('workday.fetch() tags the recovery line "(still incomplete)" when a slice died mid-fetch');
  } else {
    fail(`slice that failed mid-pagination produced recovery line ${JSON.stringify(dyingRecoveryLine)}, expected it to carry "(still incomplete)"`);
  }

  if (dyingJobs.workdayTruncated === true) {
    pass('workday.fetch() tags jobs.workdayTruncated when a slice died mid-fetch, so the sweep retries the tenant');
  } else {
    fail('a split whose slice hit fetch-error should tag jobs.workdayTruncated, not report the board complete');
  }

  // 'cap' is the same shape of partial result: the slice stopped at max_pages
  // with pages it never fetched, so the board is not fully covered either.
  const { result: cappedJobs } = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const key = sliceKey(body.appliedFacets);
    if (key === '') {
      return {
        total: 2000,
        facets: [{ facetParameter: 'jobFamily', values: [{ id: 'a', count: 1500 }, { id: 'b', count: 1200 }] }],
        jobPostings: postings('unfaceted', body.offset),
      };
    }
    // Slice 'a' has more pages than max_pages (100 * 20 = 2000) allows, and its
    // facets prove nothing — it stops at the cap, not at the offset clamp.
    if (key === 'jobFamily=a') return { total: 4000, facets: [], jobPostings: postings('a', body.offset) };
    return { total: 20, facets: [], jobPostings: body.offset === 0 ? postings('b', 0) : [] };
  }, { includeUndated: true })));

  if (cappedJobs.workdayTruncated === true) {
    pass('workday.fetch() tags jobs.workdayTruncated when a slice stopped at the page cap with pages left');
  } else {
    fail('a split whose slice hit the page cap should tag jobs.workdayTruncated');
  }

  // A slice whose PAGE 0 dies is the dangerous shape: runQuery()'s first fetch
  // is the one unguarded await on the split path, and split() issues up to
  // MAX_SPLIT_SLICES of them against a tenant large enough to have tripped the
  // ceiling — exactly where a WAF or rate limiter lives. Letting that throw
  // escape drops the whole tenant, including the unfaceted crawl's 2,000
  // postings already sitting in `out`, which breaks the additive guarantee at
  // the one moment it matters most.
  const page0Calls = [];
  const { result: page0Jobs, errors: page0Errors } = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const key = sliceKey(body.appliedFacets);
    page0Calls.push({ key, offset: body.offset });
    if (key === '') {
      return {
        total: 2000,
        facets: [{ facetParameter: 'jobFamily', values: [{ id: 'a', count: 1500 }, { id: 'b', count: 1200 }] }],
        jobPostings: postings('unfaceted', body.offset),
      };
    }
    // Slice 'a' refuses on its very first request, after every retry.
    if (key === 'jobFamily=a') throw new Error('403 from the WAF');
    return { total: 20, facets: [], jobPostings: body.offset === 0 ? postings('b', 0) : [] };
  }, { includeUndated: true })));

  if (Array.isArray(page0Jobs) && page0Jobs.length >= 2000) {
    pass('workday.fetch() keeps the unfaceted crawl when a slice fails on page 0 instead of dropping the tenant');
  } else {
    fail(`slice failing on page 0 returned ${Array.isArray(page0Jobs) ? page0Jobs.length : typeof page0Jobs} jobs, expected the unfaceted crawl's 2000+ to survive`);
  }

  // The surviving slices must still be tried: one bad slice is not a reason to
  // abandon the rest of the partition.
  if (page0Calls.some((c) => c.key === 'jobFamily=b')) {
    pass('workday.fetch() keeps splitting the remaining slices after one fails on page 0');
  } else {
    fail('a slice failing on page 0 stopped the split from trying the other slices');
  }

  if (page0Jobs.workdayTruncated === true) {
    pass('workday.fetch() tags jobs.workdayTruncated when a slice failed on page 0');
  } else {
    fail('a split whose slice failed on page 0 should tag jobs.workdayTruncated, not report the board complete');
  }

  const page0RecoveryLine = page0Errors.find((e) => String(e).includes('offset-clamped at'));
  if (page0RecoveryLine && String(page0RecoveryLine).includes('(still incomplete)')) {
    pass('workday.fetch() tags the recovery line "(still incomplete)" when a slice failed on page 0');
  } else {
    fail(`slice failing on page 0 produced recovery line ${JSON.stringify(page0RecoveryLine)}, expected it to carry "(still incomplete)"`);
  }

  // early-stop must stay exempt: a slice that paginated past the --since
  // window is genuinely done for this sweep, and tagging it would send the
  // whole tenant back through the retry pass on every incremental scan.
  const earlyStopCalls = [];
  const { result: earlyStopJobs } = await captureConsoleErrors(() => workday.fetch(ENTRY, mkCtx(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const key = sliceKey(body.appliedFacets);
    if (key !== '') earlyStopCalls.push(key);
    if (key === '') {
      return {
        total: 2000,
        facets: [{ facetParameter: 'jobFamily', values: [{ id: 'a', count: 1500 }, { id: 'b', count: 1200 }] }],
        jobPostings: postings('unfaceted', body.offset),
      };
    }
    // Each slice claims 10 pages; page 0 is fresh, page 1 is well past the
    // window → early-stop after 2 requests. The count is asserted below so
    // this stays a test about early-stop and cannot pass by never reaching it.
    if (body.offset === 0) return { total: 200, facets: [], jobPostings: postings(key, 0) };
    return {
      total: 200,
      facets: [],
      // Bounded on purpose: parsePostedOn treats "300+ Days Ago" as undated,
      // which would leave the page dateless and early-stop unreachable.
      jobPostings: postings(key, body.offset).map((p) => ({ ...p, postedOn: 'Posted 300 Days Ago' })),
    };
  }, { includeUndated: true, sinceMs: Date.now() - 7 * 24 * 60 * 60 * 1000 })));

  // 2 slices x (page 0 + the past-the-window page that stops them). Anything
  // more means early-stop never fired and the assertion below proves nothing.
  if (earlyStopCalls.length === 4) {
    pass('workday.fetch() stops a slice at the first page past the --since window instead of paginating its full total');
  } else {
    fail(`early-stop slices made ${earlyStopCalls.length} requests, expected 4 (2 slices x 2 pages) — early-stop did not fire`);
  }

  if (earlyStopJobs.workdayTruncated === undefined) {
    pass('workday.fetch() leaves a slice that early-stopped past the --since window untagged');
  } else {
    fail('a slice that stopped past the --since window is complete for the sweep and must not tag workdayTruncated');
  }

  // The unclamped path must not pay for any of this.
  const healthyCalls = [];
  await workday.fetch(ENTRY, mkCtx(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    healthyCalls.push(sliceKey(body.appliedFacets));
    return {
      total: 30,
      facets: [{ facetParameter: 'jobFamily', values: [{ id: 'a', count: 20 }, { id: 'b', count: 10 }] }],
      jobPostings: postings('h', body.offset, body.offset === 0 ? 20 : 10),
    };
  }, { includeUndated: true }));
  if (healthyCalls.every((k) => k === '')) {
    pass('workday.fetch() never issues a faceted request for a tenant whose total is not clamped');
  } else {
    fail(`healthy tenant issued faceted requests: ${JSON.stringify(healthyCalls)}`);
  }

} catch (e) {
  fail(`workday facet-split fetch tests crashed: ${e.message}`);
}
