// tests/providers/gupy.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — gupy');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/gupy.mjs')).href);
  const provider = mod.default;
  const { normalizeGupyApiJob, buildGupyLocation, extractGupyRows } = mod;
  // Every fetch() below runs with a no-op clock, so the inter-request delay
  // and retry backoff never wait on a real timer.
  const noSleep = async () => {};

  if (provider.id === 'gupy') pass('gupy.id is "gupy"');
  else fail(`gupy.id is ${JSON.stringify(provider.id)}`);

  // ── normalizeGupyApiJob ──────────────────────────────────────────────────
  const full = normalizeGupyApiJob({
    name: '  Desenvolvedor Backend Sênior  ',
    jobUrl: 'https://acme.gupy.io/job/abc123',
    careerPageName: '  Acme  ',
    workplaceType: 'remote',
    city: 'Porto Alegre',
    state: 'Rio Grande do Sul',
    country: 'Brasil',
    description: 'JD body',
    publishedDate: '2026-08-01T12:00:00.000Z',
  });
  if (full && full.title === 'Desenvolvedor Backend Sênior'
      && full.url === 'https://acme.gupy.io/job/abc123'
      && full.company === 'Acme'
      && full.location === 'Remoto, Porto Alegre, Rio Grande do Sul, Brasil'
      && full.description === 'JD body'
      && full.postedAt === Date.parse('2026-08-01T12:00:00.000Z')) {
    pass('normalizeGupyApiJob maps the list-level careerPageName fallback plus the remaining job fields');
  } else {
    fail(`normalizeGupyApiJob full row = ${JSON.stringify(full)}`);
  }

  // The raw API exposes workplaceType as a SINGULAR string; a plural
  // `workplaceTypes` field does not exist in the payload. Reading the plural
  // silently loses every hybrid posting (44% of the platform in a 2026-08-13
  // measurement). This pins the singular reader.
  const hybrid = buildGupyLocation({ workplaceType: 'hybrid', city: 'Porto Alegre' });
  const onsite = buildGupyLocation({ workplaceType: 'on-site', city: 'São Paulo' });
  const remote = buildGupyLocation({ workplaceType: 'remote', country: 'Brasil' });
  if (hybrid === 'Híbrido, Porto Alegre' && onsite === 'Presencial, São Paulo' && remote === 'Remoto, Brasil') {
    pass('buildGupyLocation reads the SINGULAR workplaceType (hybrid/on-site/remote), not the nonexistent plural');
  } else {
    fail(`buildGupyLocation workplaceType = ${JSON.stringify({ hybrid, onsite, remote })}`);
  }

  const fallback = buildGupyLocation({ isRemoteWork: true, country: 'Brasil' });
  const unknownType = buildGupyLocation({ workplaceType: 'satellite', city: 'Recife' });
  const bare = buildGupyLocation({ city: 'Curitiba', state: 'Paraná' });
  if (fallback === 'Remoto, Brasil' && unknownType === 'satellite, Recife' && bare === 'Curitiba, Paraná') {
    pass('buildGupyLocation falls back to isRemoteWork, passes unknown types through, and tolerates no type at all');
  } else {
    fail(`buildGupyLocation fallbacks = ${JSON.stringify({ fallback, unknownType, bare })}`);
  }

  // postedAt omitted when absent/unparseable; description key absent when empty.
  const noDate = normalizeGupyApiJob({ name: 'T', jobUrl: 'https://a.gupy.io/job/1', careerPageName: 'Co' });
  const badDate = normalizeGupyApiJob({ name: 'T', jobUrl: 'https://a.gupy.io/job/2', careerPageName: 'Co', publishedDate: 'not-a-date' });
  if (noDate && !('postedAt' in noDate) && badDate && !('postedAt' in badDate)) {
    pass('normalizeGupyApiJob omits postedAt when publishedDate is absent or unparseable');
  } else {
    fail(`normalizeGupyApiJob date handling = ${JSON.stringify({ noDate, badDate })}`);
  }
  if (noDate && !('description' in noDate)) pass('normalizeGupyApiJob omits the description key when the payload carries none');
  else fail(`normalizeGupyApiJob description key = ${JSON.stringify(noDate)}`);

  // No employer, no posting (Source Indexing Policy rule 1). scan.mjs copies
  // company into the pipeline as-is, so '' would land there unattributed.
  const noCompany = [
    normalizeGupyApiJob({ name: 'T', jobUrl: 'https://a.gupy.io/job/3' }),
    normalizeGupyApiJob({ name: 'T', jobUrl: 'https://a.gupy.io/job/4', careerPageName: '   ' }),
    normalizeGupyApiJob({ name: 'T', jobUrl: 'https://a.gupy.io/job/5', careerPageName: 42 }),
  ];
  if (noCompany.every((r) => r === null)) pass('normalizeGupyApiJob drops a posting whose careerPageName is absent, blank or not a string');
  else fail(`normalizeGupyApiJob no-company = ${JSON.stringify(noCompany)}`);

  // Host-lock + drops. Every row names an employer, so only the field under
  // test can be the reason it is dropped.
  const drops = [
    normalizeGupyApiJob({ name: 'Off host', jobUrl: 'https://evil.example/job/x', careerPageName: 'Co' }),
    normalizeGupyApiJob({ name: 'Lookalike', jobUrl: 'https://notgupy.io/job/x', careerPageName: 'Co' }),
    normalizeGupyApiJob({ name: 'Insecure', jobUrl: 'http://a.gupy.io/job/x', careerPageName: 'Co' }),
    normalizeGupyApiJob({ name: 'No URL', careerPageName: 'Co' }),
    normalizeGupyApiJob({ name: '', jobUrl: 'https://a.gupy.io/job/x', careerPageName: 'Co' }),
    normalizeGupyApiJob(null),
    normalizeGupyApiJob('string'),
  ];
  if (drops.every((r) => r === null)) {
    pass('normalizeGupyApiJob host-locks to *.gupy.io and drops off-host/lookalike/non-https/no-url/empty-title/non-object');
  } else {
    fail(`normalizeGupyApiJob drops = ${JSON.stringify(drops)}`);
  }

  const apex = normalizeGupyApiJob({ name: 'T', jobUrl: 'https://gupy.io/job/apex', careerPageName: 'Co' });
  if (apex && apex.url === 'https://gupy.io/job/apex') pass('normalizeGupyApiJob accepts the apex gupy.io host, not only subdomains');
  else fail(`normalizeGupyApiJob apex = ${JSON.stringify(apex)}`);

  // A confidential posting names no employer (Source Indexing Policy rule 1).
  const confidential = normalizeGupyApiJob({
    name: 'Analista', jobUrl: 'https://acme.gupy.io/job/c1', careerPageName: 'Confidencial', isConfidentialCareerPage: true,
  });
  const notConfidential = normalizeGupyApiJob({
    name: 'Analista', jobUrl: 'https://acme.gupy.io/job/c2', careerPageName: 'Acme', isConfidentialCareerPage: false,
  });
  if (confidential === null && notConfidential?.company === 'Acme') {
    pass('normalizeGupyApiJob drops isConfidentialCareerPage postings and keeps attributed ones');
  } else {
    fail(`normalizeGupyApiJob confidential = ${JSON.stringify({ confidential, notConfidential })}`);
  }

  // The portal endpoint carries no isConfidentialCareerPage flag: a
  // confidential posting only says "Confidencial" where the employer goes. The
  // label must match whole, so an employer that merely has the word in its
  // name stays.
  const unflagged = ['Confidencial', 'Empresa Confidencial', '  CONFIDENCIAL  '].map((careerPageName, i) => normalizeGupyApiJob({
    name: 'Analista', jobUrl: `https://acme.gupy.io/job/u${i}`, careerPageName,
  }));
  const namedLikeIt = normalizeGupyApiJob({
    name: 'Analista', jobUrl: 'https://acme.gupy.io/job/u9', careerPageName: 'Confidencial Seguros',
  });
  if (unflagged.every((r) => r === null) && namedLikeIt?.company === 'Confidencial Seguros') {
    pass('normalizeGupyApiJob drops an unflagged "Confidencial" employer label and keeps a company that only contains the word');
  } else {
    fail(`normalizeGupyApiJob unflagged confidential = ${JSON.stringify({ unflagged, namedLikeIt })}`);
  }

  // ── extractGupyRows: empty vs broken ─────────────────────────────────────
  const emptyRows = extractGupyRows({ data: [], pagination: { total: 0 } }, 'X', 0);
  if (Array.isArray(emptyRows) && emptyRows.length === 0) pass('extractGupyRows returns [] for a present-and-empty data array');
  else fail(`extractGupyRows empty = ${JSON.stringify(emptyRows)}`);
  const brokenShapes = [
    [{}, 'keys: []'],
    [{ data: null }, 'keys: [data]'],
    [{ data: {} }, 'keys: [data]'],
    [{ jobs: [] }, 'keys: [jobs]'],
    ['', 'type: string'],
    [42, 'type: number'],
    [true, 'type: boolean'],
    [null, 'type: null'],
  ];
  const brokenResults = brokenShapes.map(([body, expected]) => {
    try {
      extractGupyRows(body, 'X', 0);
      return `no throw for ${JSON.stringify(body)}`;
    } catch (err) {
      return err.message.includes('expected { data: [...] }') && err.message.includes(expected) ? null : err.message;
    }
  }).filter(Boolean);
  if (brokenResults.length === 0) pass('extractGupyRows throws, naming the keys or type it got, on every off-contract envelope');
  else fail(`extractGupyRows broken shapes = ${JSON.stringify(brokenResults)}`);

  // ── detect() ─────────────────────────────────────────────────────────────
  // Only the platform-wide hosts are claimed. A tenant career page
  // (acme.gupy.io) is one employer; this provider searches the whole platform
  // and would ignore the tenant, so it must not take such an entry.
  const hitExplicit = provider.detect({ name: 'Gupy', provider: 'gupy' });
  const hitPortal = provider.detect({ careers_url: 'https://portal.gupy.io' });
  const hitPortalPath = provider.detect({ careers_url: 'https://portal.gupy.io/job-search/term=dev' });
  // An entry written against the API's retired host still resolves here;
  // fetch() never calls that host.
  const hitApi = provider.detect({ api: 'https://employability-portal.gupy.io/api/v1/jobs' });
  const misses = [
    provider.detect({ careers_url: 'https://acme.gupy.io' }),
    provider.detect({ careers_url: 'https://gupy.io' }),
    provider.detect({ careers_url: 'http://portal.gupy.io' }),
    provider.detect({ careers_url: 'https://portal.gupy.io.evil.example' }),
    provider.detect({ careers_url: 'https://notgupy.io' }),
    provider.detect({ careers_url: 'https://job-boards.greenhouse.io/acme' }),
    provider.detect({ careers_url: 'not a url' }),
    provider.detect({ careers_url: null }),
    provider.detect({ careers_url: 42 }),
    provider.detect({ provider: 'vdab' }),
    provider.detect({ name: 'no urls' }),
    provider.detect(null),
  ];
  if (hitExplicit?.url === 'https://portal.gupy.io/api/job-search/jobs'
      && hitPortal?.url && hitPortalPath?.url && hitApi?.url && misses.every((m) => m === null)) {
    pass('detect() claims provider: gupy and the platform-wide hosts, never a tenant, the apex, non-HTTPS, lookalikes or junk');
  } else {
    fail(`detect() = ${JSON.stringify({ hitExplicit, hitPortal, hitPortalPath, hitApi, misses })}`);
  }

  // ── fetch() ──────────────────────────────────────────────────────────────
  const mk = (i, company = `Co ${i}`) => ({
    name: `Role ${i}`,
    jobUrl: `https://acme.gupy.io/job/x${i}`,
    careerPageName: company,
    workplaceType: 'remote',
    country: 'Brasil',
    publishedDate: '2026-08-01T00:00:00.000Z',
  });

  // Every request the provider issues must refuse redirects (SSRF guard).
  const redirectOpts = [];
  await provider.fetch({ gupy: { keywords: ['A', 'B'] }, max_pages: 3 }, {
    sleep: noSleep,
    fetchJson: async (url, opts) => {
      redirectOpts.push(opts?.redirect);
      const offset = Number(new URL(url).searchParams.get('offset'));
      return { data: Array.from({ length: offset === 0 ? 100 : 5 }, (_, i) => mk(offset + i)), pagination: { total: 100 } };
    },
  });
  if (redirectOpts.length === 4 && redirectOpts.every((r) => r === 'error')) {
    pass("fetch() passes redirect: 'error' on every request, first page and later pages alike");
  } else {
    fail(`fetch() redirect opts = ${JSON.stringify(redirectOpts)}`);
  }

  // Requests to the same host are spaced with the shared sleep: not before the
  // first request, before every one after it (next page or next keyword).
  const sleeps = [];
  let spacedCalls = 0;
  await provider.fetch({ gupy: { keywords: ['A', 'B'] }, max_pages: 3 }, {
    sleep: async (ms) => { sleeps.push({ ms, afterCall: spacedCalls }); },
    fetchJson: async (url) => {
      spacedCalls++;
      const offset = Number(new URL(url).searchParams.get('offset'));
      return { data: Array.from({ length: offset === 0 ? 100 : 5 }, (_, i) => mk(offset + i)), pagination: { total: 100 } };
    },
  });
  if (spacedCalls === 4 && sleeps.length === 3 && sleeps.every((s, i) => s.ms === 200 && s.afterCall === i + 1)) {
    pass('fetch() sleeps 200 ms before every request except the first');
  } else {
    fail(`fetch() pacing = ${JSON.stringify({ spacedCalls, sleeps })}`);
  }

  // One sweep per keyword — Gupy's jobName matches titles narrowly, so terms
  // must NOT be joined into a single query the way a16z-speedrun-talent does.
  const kwCalls = [];
  const kwCtx = {
    sleep: noSleep, fetchJson: async (url) => {
      kwCalls.push(url);
      return { data: [mk(kwCalls.length)], pagination: { total: 1 } };
    },
  };
  const kwJobs = await provider.fetch({ name: 'Gupy', gupy: { keywords: ['Backend', 'Full Stack'] }, max_pages: 3 }, kwCtx);
  const kwNames = kwCalls.map((u) => new URL(u).searchParams.get('jobName'));
  if (kwCalls.length === 2 && kwNames[0] === 'Backend' && kwNames[1] === 'Full Stack' && kwJobs.length === 2) {
    pass('fetch() sweeps each keyword separately instead of joining them into one query');
  } else {
    fail(`fetch() keyword sweeps = ${JSON.stringify({ kwNames, jobs: kwJobs.length })}`);
  }

  // The same posting routinely matches several keywords — dedup by URL.
  const dupCtx = { sleep: noSleep, fetchJson: async () => ({ data: [mk(1), mk(1)], pagination: { total: 2 } }) };
  const dupJobs = await provider.fetch({ gupy: { keywords: ['A', 'B'] }, max_pages: 1 }, dupCtx);
  if (dupJobs.length === 1) pass('fetch() dedups by posting URL across keywords and within a page');
  else fail(`fetch() dedup = ${JSON.stringify(dupJobs.map((j) => j.url))}`);

  // offset/limit pagination, stopping once offset covers pagination.total.
  const pageCalls = [];
  const pageCtx = {
    sleep: noSleep, fetchJson: async (url) => {
      pageCalls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const data = Array.from({ length: offset === 0 ? 100 : 20 }, (_, i) => mk(offset + i));
      return { data, pagination: { total: 120 } };
    },
  };
  const paged = await provider.fetch({ gupy: { keywords: ['X'] }, max_pages: 5 }, pageCtx);
  const offsets = pageCalls.map((u) => new URL(u).searchParams.get('offset'));
  const limits = pageCalls.map((u) => new URL(u).searchParams.get('limit'));
  if (pageCalls.length === 2 && offsets[0] === '0' && offsets[1] === '100'
      && limits.every((l) => l === '100') && paged.length === 120) {
    pass('fetch() paginates by offset/limit=100 and stops on a short page');
  } else {
    fail(`fetch() pagination = ${JSON.stringify({ offsets, limits, jobs: paged.length })}`);
  }

  // REGRESSION (2026-08-13): pagination.total reports the PAGE SIZE, not the
  // result-set size — the live API answers total=100 at every offset of a
  // 370-posting keyword. Trusting it (the way a16z-speedrun-talent trusts
  // `total_pages`, which is an honest page count) broke every sweep after page
  // 0 and dropped 205 of 548 deduped postings in silence, 14 of them inside the
  // active window. A short page is the only end-of-feed signal this API gives.
  const lyingCalls = [];
  const lyingCtx = {
    sleep: noSleep, fetchJson: async (url) => {
      lyingCalls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const remaining = Math.max(0, 370 - offset);
      const data = Array.from({ length: Math.min(100, remaining) }, (_, i) => mk(offset + i));
      return { data, pagination: { total: 100, limit: 100, offset } };
    },
  };
  const lying = await provider.fetch({ gupy: { keywords: ['Desenvolvedor'] }, max_pages: 5 }, lyingCtx);
  if (lyingCalls.length === 4 && lying.length === 370) {
    pass('fetch() ignores a pagination.total that reports the page size and paginates until a short page');
  } else {
    fail(`fetch() lying-total = ${JSON.stringify({ calls: lyingCalls.length, jobs: lying.length })}`);
  }

  // verify-portals.mjs probes with ctx.maxPages:1 under a 4-request sentinel.
  // This provider paginates per (keyword × page), so the budget must be a TOTAL
  // for the call: read per keyword, a 10-keyword entry would spend 10 requests
  // on a 1-page probe, trip the sentinel, and get a live board reported as a
  // cut-off.
  const probeCalls = [];
  const probeWarnings = [];
  let probed;
  const beforeProbe = console.error;
  try {
    console.error = (...args) => probeWarnings.push(args.join(' '));
    probed = await provider.fetch({ gupy: { keywords: ['A', 'B', 'C', 'D', 'E'] }, max_pages: 5 }, {
      maxPages: 1,
      sleep: noSleep, fetchJson: async (url) => {
        probeCalls.push(url);
        return { data: Array.from({ length: 100 }, (_, i) => mk(i)), pagination: { total: 100 } };
      },
    });
  } finally {
    console.error = beforeProbe;
  }
  if (probeCalls.length === 1 && probed.length === 100) {
    pass('fetch() honors ctx.maxPages as a total page budget across keyword sweeps');
  } else {
    fail(`fetch() ctx.maxPages = ${JSON.stringify({ calls: probeCalls.length, jobs: probed?.length })}`);
  }
  if (probeWarnings.length === 0) pass('fetch() stays quiet when ctx.maxPages truncates — a probe is not a misconfiguration');
  else fail(`probe emitted warnings: ${JSON.stringify(probeWarnings)}`);

  // max_pages caps the sweep and warns.
  const capCalls = [];
  const capCtx = {
    sleep: noSleep, fetchJson: async (url) => {
      capCalls.push(url);
      return { data: Array.from({ length: 100 }, (_, i) => mk(capCalls.length * 1000 + i)), pagination: { total: 5000 } };
    },
  };
  const capWarnings = [];
  const realConsoleError = console.error;
  let capped;
  try {
    console.error = (...args) => capWarnings.push(args.join(' '));
    capped = await provider.fetch({ gupy: { keywords: ['X'] }, max_pages: 2 }, capCtx);
  } finally {
    console.error = realConsoleError;
  }
  if (capCalls.length === 2 && capped.length === 200) pass('fetch() stops a never-ending feed at max_pages');
  else fail(`fetch() cap = ${JSON.stringify({ calls: capCalls.length, jobs: capped?.length })}`);
  if (capWarnings.some((w) => w.includes('truncated at max_pages=2') && w.includes('raise max_pages'))) {
    pass('fetch() warns when max_pages truncates a keyword sweep');
  } else {
    fail(`truncation warning missing; captured = ${JSON.stringify(capWarnings)}`);
  }

  // The API answers offset 10,000 and beyond with a 400, so no max_pages takes
  // a sweep past 100 pages, and at that ceiling the warning must not tell the
  // user to raise max_pages.
  const deepOffsets = [];
  const deepWarnings = [];
  let deep;
  const beforeDeep = console.error;
  try {
    console.error = (...args) => deepWarnings.push(args.join(' '));
    deep = await provider.fetch({ gupy: { keywords: ['X'] }, max_pages: 500 }, {
      sleep: noSleep, fetchJson: async (url) => {
        const offset = Number(new URL(url).searchParams.get('offset'));
        deepOffsets.push(offset);
        return { data: Array.from({ length: 100 }, (_, i) => mk(offset + i)), pagination: { total: 100 } };
      },
    });
  } finally {
    console.error = beforeDeep;
  }
  if (deepOffsets.length === 100 && deepOffsets.at(-1) === 9900 && deep.length === 10_000) {
    pass('fetch() caps max_pages at 100, the deepest page the API serves');
  } else {
    fail(`fetch() page ceiling = ${JSON.stringify({ calls: deepOffsets.length, last: deepOffsets.at(-1), jobs: deep?.length })}`);
  }
  if (deepWarnings.length === 1 && deepWarnings[0].includes('truncated at max_pages=100')
      && !deepWarnings[0].includes('raise max_pages')) {
    pass('fetch() does not suggest raising max_pages once the API ceiling is what truncated the sweep');
  } else {
    fail(`ceiling warning = ${JSON.stringify(deepWarnings)}`);
  }

  // Optional filters ride along comma-joined under the names the API reads,
  // workplaceType and type, as portal.gupy.io sends them. It ignores the plural
  // workplaceTypes/jobTypes and answers with the unfiltered feed. It has no
  // country filter either, so a configured country is not sent and draws a
  // warning instead.
  const paramCalls = [];
  const paramWarnings = [];
  const paramCtx = { sleep: noSleep, fetchJson: async (url) => { paramCalls.push(url); return { data: [], pagination: { total: 0 } }; } };
  const beforeParams = console.error;
  try {
    console.error = (...args) => paramWarnings.push(args.join(' '));
    await provider.fetch({
      name: 'Gupy',
      gupy: {
        keywords: ['X'],
        workplace_types: ['remote', 'hybrid'],
        job_types: ['vacancy_type_effective'],
        state: 'Rio Grande do Sul',
        country: 'Brasil',
      },
      max_pages: 1,
    }, paramCtx);
  } finally {
    console.error = beforeParams;
  }
  const p = new URL(paramCalls[0]).searchParams;
  if (p.get('workplaceType') === 'remote,hybrid' && p.get('type') === 'vacancy_type_effective'
      && p.get('state') === 'Rio Grande do Sul'
      && !p.has('workplaceTypes') && !p.has('jobTypes') && !p.has('country')) {
    pass('fetch() sends workplace_types/job_types as workplaceType/type, comma-joined, plus state');
  } else {
    fail(`fetch() params = ${JSON.stringify(Object.fromEntries(p))}`);
  }
  if (paramWarnings.length === 1 && paramWarnings[0].includes('gupy.country') && paramWarnings[0].includes('"Gupy"')) {
    pass('fetch() warns that gupy.country is ignored instead of sending it');
  } else {
    fail(`country warning = ${JSON.stringify(paramWarnings)}`);
  }

  const bareCalls = [];
  const bareCtx = { sleep: noSleep, fetchJson: async (url) => { bareCalls.push(url); return { data: [], pagination: { total: 0 } }; } };
  await provider.fetch({ gupy: { keywords: ['X'], workplace_types: [] }, max_pages: 1 }, bareCtx);
  const bp = new URL(bareCalls[0]).searchParams;
  if (!bp.has('workplaceType') && !bp.has('type') && !bp.has('state') && !bp.has('country')) {
    pass('fetch() omits optional params entirely when unset or empty');
  } else {
    fail(`fetch() bare params = ${JSON.stringify(Object.fromEntries(bp))}`);
  }

  // Empty feed returns [] after one call per keyword.
  const emptyCalls = [];
  const emptyCtx = { sleep: noSleep, fetchJson: async (url) => { emptyCalls.push(url); return { data: [], pagination: { total: 0 } }; } };
  const empty = await provider.fetch({ gupy: { keywords: ['X'] }, max_pages: 3 }, emptyCtx);
  if (emptyCalls.length === 1 && empty.length === 0) pass('fetch() returns [] after one call on an empty feed');
  else fail(`empty feed = ${JSON.stringify({ calls: emptyCalls.length, jobs: empty.length })}`);

  // A malformed payload on the only sweep leaves nothing to keep, so it still
  // surfaces as an error rather than an empty board.
  let threw = null;
  try {
    await provider.fetch({ gupy: { keywords: ['X'] }, max_pages: 1 }, { sleep: noSleep, fetchJson: async () => ({ unexpected: true }) });
  } catch (err) {
    threw = err.message;
  }
  if (threw && threw.includes('unexpected API response')) pass('fetch() surfaces a malformed payload instead of returning a silent empty board');
  else fail(`malformed payload handling = ${JSON.stringify(threw)}`);

  // ── per-sweep failure isolation ──────────────────────────────────────────
  // Each keyword is an independent query, so a dead sweep must not discard the
  // sweeps that already completed correctly.
  const isoCalls = [];
  const isoWarnings = [];
  let isolated;
  const beforeIso = console.error;
  try {
    console.error = (...args) => isoWarnings.push(args.join(' '));
    isolated = await provider.fetch({ gupy: { keywords: ['A', 'B', 'C'] }, max_pages: 1 }, {
      sleep: noSleep, fetchJson: async (url) => {
        const kw = new URL(url).searchParams.get('jobName');
        isoCalls.push(kw);
        if (kw === 'B') throw Object.assign(new Error('HTTP 404'), { status: 404 });
        return { data: [mk(kw === 'A' ? 1 : 2)], pagination: { total: 1 } };
      },
    });
  } finally {
    console.error = beforeIso;
  }
  if (isolated.length === 2 && isoCalls.join(',') === 'A,B,C'
      && isoWarnings.some((w) => w.includes('sweep "B" stopped'))) {
    pass('fetch() keeps the sweeps that succeeded when one keyword fails, and warns about the one that did not');
  } else {
    fail(`sweep isolation = ${JSON.stringify({ jobs: isolated.length, calls: isoCalls, warnings: isoWarnings })}`);
  }

  // A failure mid-sweep keeps the pages already in hand (newest-first, so a
  // partial sweep is the freshest N pages) and moves on.
  const partialCalls = [];
  let partial;
  const beforePartial = console.error;
  try {
    console.error = () => {};
    partial = await provider.fetch({ gupy: { keywords: ['A'] }, max_pages: 5 }, {
      sleep: noSleep, fetchJson: async (url) => {
        const offset = Number(new URL(url).searchParams.get('offset'));
        partialCalls.push(offset);
        if (offset > 0) throw Object.assign(new Error('HTTP 500'), { status: 500 });
        return { data: Array.from({ length: 100 }, (_, i) => mk(i)), pagination: { total: 100 } };
      },
    });
  } finally {
    console.error = beforePartial;
  }
  // page 0 once, then page 1 three times (1 attempt + 2 retries on a 5xx).
  if (partial.length === 100 && partialCalls.length === 4) {
    pass('fetch() keeps the pages already read when a sweep dies mid-pagination');
  } else {
    fail(`mid-sweep partial = ${JSON.stringify({ jobs: partial.length, calls: partialCalls })}`);
  }

  // Every sweep dead = outage, moved endpoint or changed payload. Must rethrow
  // the ORIGINAL error object: verify-portals' classifyFetchError reads
  // err.status to tell server/auth/slug_gone apart, and portal-health escalates
  // on that classification.
  let allFailed = null;
  let attempts = 0;
  const beforeAll = console.error;
  try {
    console.error = () => {};
    await provider.fetch({ gupy: { keywords: ['A', 'B'] }, max_pages: 2 }, {
      sleep: noSleep, fetchJson: async () => { attempts++; throw Object.assign(new Error('HTTP 503'), { status: 503 }); },
    });
  } catch (err) {
    allFailed = err;
  } finally {
    console.error = beforeAll;
  }
  // 2 keywords × 1 page each (the sweep breaks on failure) × 3 attempts.
  if (allFailed && allFailed.status === 503 && attempts === 6) {
    pass('fetch() rethrows the original error — status intact — when no sweep produced a page');
  } else {
    fail(`all-failed = ${JSON.stringify({ status: allFailed?.status, message: allFailed?.message, attempts })}`);
  }

  // The probe budget counts pages ATTEMPTED, so a broken board cannot make a
  // 1-page probe walk every keyword.
  let brokenProbeCalls = 0;
  let brokenProbeErr = null;
  const beforeBroken = console.error;
  try {
    console.error = () => {};
    await provider.fetch({ gupy: { keywords: ['A', 'B', 'C', 'D', 'E'] }, max_pages: 5 }, {
      maxPages: 1,
      sleep: noSleep, fetchJson: async () => { brokenProbeCalls++; throw Object.assign(new Error('HTTP 404'), { status: 404 }); },
    });
  } catch (err) {
    brokenProbeErr = err;
  } finally {
    console.error = beforeBroken;
  }
  if (brokenProbeCalls === 1 && brokenProbeErr?.status === 404) {
    pass('fetch() spends the ctx.maxPages budget on failed pages too, so a broken board still costs one request');
  } else {
    fail(`broken probe = ${JSON.stringify({ calls: brokenProbeCalls, status: brokenProbeErr?.status })}`);
  }

  // During a probe a rejection propagates as the SAME object, not swallowed
  // and not rewrapped: verify-portals identifies its budget sentinel by
  // identity. Holds even when an earlier sweep already succeeded.
  class FakeSentinel extends Error {}
  const sentinel = new FakeSentinel('probe budget reached');
  let probeCaught = null;
  let probeSentinelCalls = 0;
  try {
    await provider.fetch({ gupy: { keywords: ['A', 'B'] }, max_pages: 1 }, {
      maxPages: 2,
      sleep: noSleep,
      fetchJson: async () => {
        probeSentinelCalls++;
        if (probeSentinelCalls >= 2) throw sentinel;
        return { data: [mk(1)], pagination: { total: 1 } };
      },
    });
  } catch (err) {
    probeCaught = err;
  }
  if (probeCaught === sentinel && probeCaught instanceof FakeSentinel) {
    pass('fetch() propagates a ctx.fetch* rejection unwrapped while ctx.maxPages is set');
  } else {
    fail(`probe rejection = ${JSON.stringify({ same: probeCaught === sentinel, message: probeCaught?.message, calls: probeSentinelCalls })}`);
  }

  // One shared `seen` set across sweeps, but each sweep stops on the SOURCE's
  // page length. A sweep whose first page repeats an earlier sweep entirely
  // must still walk its deeper pages.
  const overlapCalls = [];
  const overlap = await provider.fetch({ gupy: { keywords: ['A', 'B'] }, max_pages: 5 }, {
    sleep: noSleep,
    fetchJson: async (url) => {
      const u = new URL(url);
      const kw = u.searchParams.get('jobName');
      const offset = Number(u.searchParams.get('offset'));
      overlapCalls.push(`${kw}@${offset}`);
      if (kw === 'A') return { data: Array.from({ length: 50 }, (_, i) => mk(i)), pagination: { total: 100 } };
      if (offset === 0) return { data: Array.from({ length: 100 }, (_, i) => mk(i % 50)), pagination: { total: 100 } };
      return { data: Array.from({ length: 10 }, (_, i) => mk(1000 + i)), pagination: { total: 100 } };
    },
  });
  if (overlapCalls.join(',') === 'A@0,B@0,B@100' && overlap.length === 60) {
    pass('fetch() keeps walking a sweep whose first page fully overlaps an earlier one');
  } else {
    fail(`overlap sweep = ${JSON.stringify({ calls: overlapCalls, jobs: overlap.length })}`);
  }

  // Keyword resolution against config/profile.yml. Every case runs in an
  // isolated tmp cwd (never this checkout's own config/profile.yml, so both
  // the fallback and the throw are checked on every machine, onboarded or
  // not). Same pattern as tests/providers/vdab.test.mjs, plus
  // CAREER_OPS_PROFILE cleared for the duration: when set, it overrides the
  // relative path and the fixture would never be read.
  {
    const withTmpCwd = async (setup, run) => {
      const tmp = mkdtempSync(join(tmpdir(), 'career-ops-gupy-fallback-'));
      const cwdBefore = process.cwd();
      const profileEnvBefore = process.env.CAREER_OPS_PROFILE;
      try {
        setup(tmp);
        process.chdir(tmp);
        delete process.env.CAREER_OPS_PROFILE;
        return await run();
      } finally {
        if (profileEnvBefore === undefined) delete process.env.CAREER_OPS_PROFILE;
        else process.env.CAREER_OPS_PROFILE = profileEnvBefore;
        process.chdir(cwdBefore);
        rmSync(tmp, { recursive: true, force: true });
      }
    };
    const withProfile = (tmp) => {
      mkdirSync(join(tmp, 'config'));
      writeFileSync(join(tmp, 'config', 'profile.yml'), 'target_roles:\n  primary:\n    - Engenheiro de Dados\n    - Analista de BI\n');
    };
    const noProfile = () => {}; // no config/ dir: profile.yml absent
    // Runs one fetch() and returns the jobName of every request it issued,
    // plus the error message if it threw.
    const sweep = async (entry, setup) => {
      const calls = [];
      let threw = null;
      try {
        await withTmpCwd(setup, () => provider.fetch(entry, {
          sleep: noSleep,
          fetchJson: async (url) => { calls.push(new URL(url).searchParams.get('jobName')); return { data: [], pagination: { total: 0 } }; },
        }));
      } catch (err) {
        threw = err.message;
      }
      return { calls, threw };
    };

    // Keywords fall back to target_roles (the vdab.mjs pattern), never to a
    // hardcoded term baked into this system-layer file.
    const fallback = await sweep({ name: 'Gupy', max_pages: 1 }, withProfile);
    if (fallback.threw === null && JSON.stringify(fallback.calls) === JSON.stringify(['Engenheiro de Dados', 'Analista de BI'])) {
      pass('fetch() falls back to config/profile.yml target_roles when neither gupy.keywords[] nor gupy.q is set');
    } else {
      fail(`profile fallback = ${JSON.stringify(fallback)}`);
    }

    // No keywords and no profile: fail loudly, never sweep a guessed term.
    const empty = await sweep({ name: 'Gupy', max_pages: 1 }, noProfile);
    if (empty.calls.length === 0 && empty.threw && empty.threw.includes('no gupy.keywords[]/gupy.q')) {
      pass('fetch() throws when there are no gupy.keywords[]/gupy.q and no profile target_roles to fall back to');
    } else {
      fail(`profile fallback (no profile) = ${JSON.stringify(empty)}`);
    }

    // Explicit keywords[] always beat the profile fallback.
    const override = await sweep({ gupy: { keywords: ['Só Esta'] }, max_pages: 1 }, withProfile);
    if (override.threw === null && JSON.stringify(override.calls) === JSON.stringify(['Só Esta'])) {
      pass('fetch() prefers the entry keywords[] over the profile fallback');
    } else {
      fail(`keyword override = ${JSON.stringify(override)}`);
    }

    // Search keys are read from the gupy: block only (the vdab/arbeitsagentur
    // shape). A top-level keywords: is not a search key: it neither beats the
    // block nor replaces the profile fallback, and without a profile it does
    // not rescue the entry from the throw.
    const block = await sweep({ keywords: ['Top'], gupy: { keywords: ['Nested'] }, max_pages: 1 }, withProfile);
    const topWithProfile = await sweep({ name: 'Gupy', keywords: ['Top'], max_pages: 1 }, withProfile);
    const topNoProfile = await sweep({ name: 'Gupy', keywords: ['Top'], max_pages: 1 }, noProfile);
    if (JSON.stringify(block.calls) === JSON.stringify(['Nested'])
        && JSON.stringify(topWithProfile.calls) === JSON.stringify(fallback.calls)
        && topNoProfile.calls.length === 0 && topNoProfile.threw === empty.threw) {
      pass('fetch() reads search keys from the gupy: block and ignores top-level keywords:');
    } else {
      fail(`gupy: block = ${JSON.stringify({ block, topWithProfile, topNoProfile })}`);
    }
  }

  // ── recency window ───────────────────────────────────────────────────────
  const DAY = 86_400_000;
  const dated = (i, ageDays) => ({
    name: `Role ${i}`,
    jobUrl: `https://acme.gupy.io/job/w${i}`,
    careerPageName: 'Co',
    workplaceType: 'remote',
    publishedDate: new Date(Date.now() - ageDays * DAY).toISOString(),
  });

  // since_days is the entry's OWN window: it must both stop the sweep and drop
  // the stale tail of the last page, because nothing downstream knows about it.
  const winCalls = [];
  const windowed = await provider.fetch({ gupy: { keywords: ['X'], since_days: 14 }, max_pages: 5 }, {
    sleep: noSleep, fetchJson: async (url) => {
      winCalls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      // Page 0: half inside the window, half far outside it. Page 1 would be
      // older still — the sweep must never ask for it.
      const data = Array.from({ length: 100 }, (_, i) => dated(offset + i, offset + i < 50 ? 3 : 90));
      return { data, pagination: { total: 100 } };
    },
  });
  if (winCalls.length === 1 && windowed.length === 50) {
    pass('since_days stops the sweep at the window edge and drops the stale tail of the page');
  } else {
    fail(`since_days = ${JSON.stringify({ calls: winCalls.length, jobs: windowed.length })}`);
  }

  // ctx.sinceMs is the RUN's window and wins over since_days — an operator who
  // widened the run must not silently get the entry's narrower default.
  const ctxWinCalls = [];
  const ctxWindowed = await provider.fetch({ gupy: { keywords: ['X'], since_days: 14 }, max_pages: 5 }, {
    sinceMs: Date.now() - 60 * DAY,
    sleep: noSleep, fetchJson: async (url) => {
      ctxWinCalls.push(url);
      const offset = Number(new URL(url).searchParams.get('offset'));
      const data = Array.from({ length: offset === 0 ? 100 : 10 }, (_, i) => dated(offset + i, 30));
      return { data, pagination: { total: 100 } };
    },
  });
  if (ctxWinCalls.length === 2 && ctxWindowed.length === 110) {
    pass('ctx.sinceMs overrides since_days — postings inside the run window survive the entry default');
  } else {
    fail(`ctx.sinceMs precedence = ${JSON.stringify({ calls: ctxWinCalls.length, jobs: ctxWindowed.length })}`);
  }

  // A ctx window is early-stop ONLY. scan.mjs applies postedDateFilter itself,
  // and re-deriving that floor here risks sub-second drift dropping a boundary
  // posting the scanner wanted.
  const ctxNoFilter = await provider.fetch({ gupy: { keywords: ['X'] }, max_pages: 1 }, {
    sinceMs: Date.now() - 14 * DAY,
    sleep: noSleep, fetchJson: async () => ({ data: [dated(1, 3), dated(2, 400)], pagination: { total: 2 } }),
  });
  if (ctxNoFilter.length === 2) pass('ctx.sinceMs never filters postings out — it only stops pagination');
  else fail(`ctx.sinceMs filtering = ${JSON.stringify(ctxNoFilter.map((j) => j.url))}`);

  // Undated postings pass the window (scan.mjs's "don't penalize missing data").
  const undated = await provider.fetch({ gupy: { keywords: ['X'], since_days: 14 }, max_pages: 1 }, {
    sleep: noSleep, fetchJson: async () => ({
      data: [{ name: 'No date', jobUrl: 'https://acme.gupy.io/job/nd', careerPageName: 'Co' }, dated(9, 400)],
      pagination: { total: 2 },
    }),
  });
  if (undated.length === 1 && undated[0].url === 'https://acme.gupy.io/job/nd') {
    pass('since_days keeps undated postings and drops the dated ones outside the window');
  } else {
    fail(`undated handling = ${JSON.stringify(undated.map((j) => j.url))}`);
  }

  // since_days must mean exactly what --since means: a floor truncated to UTC
  // midnight (scan.mjs's resolveEffectiveAfter). An exact `now - days` stamp
  // would make the same config return different results by the hour.
  const noonUtc = Date.parse('2026-08-13T12:34:56Z');
  const cutoff14 = mod.sinceDaysToCutoffMs(14, noonUtc);
  if (cutoff14 === Date.parse('2026-07-30T00:00:00Z')
      && mod.sinceDaysToCutoffMs(null, noonUtc) === null
      && mod.sinceDaysToCutoffMs(1e15, noonUtc) === null) {
    pass('sinceDaysToCutoffMs truncates to UTC midnight like --since, and survives an out-of-range day count');
  } else {
    fail(`sinceDaysToCutoffMs = ${JSON.stringify({ cutoff14, iso: cutoff14 && new Date(cutoff14).toISOString() })}`);
  }

  // A page of nothing but undated postings must not stop pagination.
  if (mod.pageIsPastWindow([{ }, { }], Date.now()) === false
      && mod.pageIsPastWindow([dated(1, 400)].map((d) => ({ postedAt: Date.parse(d.publishedDate) })), Date.now()) === true
      && mod.pageIsPastWindow([{ postedAt: Date.now() }], null) === false) {
    pass('pageIsPastWindow ignores undated pages, trips on a fully stale one, and no-ops without a window');
  } else {
    fail('pageIsPastWindow behaviour drifted');
  }

  // q: accepted as a single-keyword form.
  const qCalls = [];
  const qCtx = { sleep: noSleep, fetchJson: async (url) => { qCalls.push(url); return { data: [], pagination: { total: 0 } }; } };
  await provider.fetch({ gupy: { q: 'AI Engineer' }, max_pages: 1 }, qCtx);
  if (new URL(qCalls[0]).searchParams.get('jobName') === 'AI Engineer') pass('fetch() accepts q: as a single-keyword form');
  else fail(`q form = ${JSON.stringify(new URL(qCalls[0]).searchParams.get('jobName'))}`);

  // Every request must hit the pinned API host over HTTPS (SSRF guard).
  if (qCalls.every((u) => u.startsWith('https://portal.gupy.io/api/job-search/jobs?'))) {
    pass('fetch() pins every request to https://portal.gupy.io/api/job-search/jobs');
  } else {
    fail(`api host = ${JSON.stringify(qCalls)}`);
  }
} catch (err) {
  fail(`gupy provider test threw: ${err.message}`);
}
