// tests/providers/remotli.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — remotli');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/remotli.mjs')).href);
  const remotli = mod.default;
  const { normalizeRemotliJob } = mod;

  if (remotli.id === 'remotli') pass('remotli.id is "remotli"');
  else fail(`remotli.id is ${JSON.stringify(remotli.id)}`);

  // --- detect() -------------------------------------------------------------
  const hit = remotli.detect({ name: 'X', careers_url: 'https://remotli.ch/' });
  if (hit && /^https:\/\/remotli\.ch\/api\/jobs\?page=1&limit=50&remote=all$/.test(hit.url)) {
    pass('detect() claims a remotli.ch careers_url and points at the paged, full-inventory API');
  } else {
    fail(`detect() returned ${JSON.stringify(hit)}`);
  }

  const misses = [
    remotli.detect({ name: 'X', careers_url: 'https://evil.example/remotli.ch' }),
    remotli.detect({ name: 'X', careers_url: 'http://remotli.ch/' }), // non-HTTPS
    remotli.detect({ name: 'X', careers_url: 'https://remotli.ch.evil.example/' }),
    remotli.detect({ name: 'X' }),
  ];
  if (misses.every(m => m === null)) pass('detect() rejects off-host, look-alike, non-HTTPS and missing careers_url');
  else fail(`detect() misses = ${JSON.stringify(misses)}`);

  // --- normalizeRemotliJob() -------------------------------------------------
  // `status` defaults to 'active' so each test exercises the thing it names.
  // normalizeRemotliJob rejects any row whose status is not exactly 'active',
  // so without this default the slug/title/salary cases below would all return
  // null for the WRONG reason and still pass — vacuous tests. Cases that are
  // about status override it, and the missing-status case builds its row inline.
  const row = (jobs, companies) => ({ jobs: { status: 'active', ...jobs }, companies: companies || {} });

  const full = normalizeRemotliJob(row({
    title: '  Head of Finance  ',
    slug: 'head-of-finance-at-acme',
    status: 'active',
    company: '  Acme AG  ',
    location: 'Zürich, Switzerland',
    allLocations: ['Zürich, Switzerland', 'Remote'],
    description: '<p>Own the <b>numbers</b>.</p><li>FP&amp;A</li>',
    applyUrl: 'https://job-boards.greenhouse.io/acme/jobs/4012345',
    publishedAt: '2026-08-01T10:00:00.000Z',
    salaryMin: 180000, salaryMax: 220000, salaryCurrency: 'chf',
  }));
  if (full
      && full.title === 'Head of Finance'
      && full.url === 'https://job-boards.greenhouse.io/acme/jobs/4012345'
      && full.company === 'Acme AG'
      && full.location === 'Zürich, Switzerland; Remote'
      && full.postedAt === Date.parse('2026-08-01T10:00:00.000Z')) {
    pass('normalizeRemotliJob maps title/url/company, folds allLocations, parses publishedAt');
  } else {
    fail(`normalizeRemotliJob full = ${JSON.stringify(full)}`);
  }

  if (full && /Own the numbers/.test(full.description) && !/[<>]/.test(full.description) && /FP&A/.test(full.description)) {
    pass('normalizeRemotliJob strips HTML and decodes entities in description (feeds the #1597 fingerprint)');
  } else {
    fail(`normalizeRemotliJob description = ${JSON.stringify(full?.description)}`);
  }

  // Nested markup and entities inside it both resolve in a single pass.
  //
  // An earlier revision of this provider carried a second tag-strip after the
  // decode, to cope with rows that arrived entity-encoded (`&lt;p&gt;…`) rather
  // than as real HTML. That was compensating for the board serving a mix of
  // both encodings from /api/jobs, and it cost two HIGH CodeQL alerts
  // (js/double-escaping, js/bad-tag-filter). The API now decodes on the way out
  // and always answers with real tags, so the standard strip-once-then-decode
  // order — shared with agentic-jobs.mjs and avature.mjs — is sufficient.
  const nested = normalizeRemotliJob(row({
    title: 'T', slug: 'de', status: 'active',
    description: '<div><p>Own the <b>numbers</b></p><li>FP&amp;A</li></div>',
  }));
  if (nested && !/[<>]/.test(nested.description) && /Own the numbers/.test(nested.description) && /FP&A/.test(nested.description)) {
    pass('normalizeRemotliJob resolves nested tags and inner entities in one pass');
  } else {
    fail(`normalizeRemotliJob nested description = ${JSON.stringify(nested?.description)}`);
  }

  if (full && full.salary && full.salary.min === 180000 && full.salary.max === 220000 && full.salary.currency === 'CHF') {
    pass('normalizeRemotliJob maps salaryMin/Max/Currency to the {min,max,currency} shape scan.mjs expects');
  } else {
    fail(`normalizeRemotliJob salary = ${JSON.stringify(full?.salary)}`);
  }

  // Inverted salary bounds are normalized, not emitted backwards.
  const inverted = normalizeRemotliJob(row({ title: 'T', slug: 's1', salaryMin: 200, salaryMax: 100, salaryCurrency: 'CHF' }));
  if (inverted?.salary?.min === 100 && inverted?.salary?.max === 200) pass('normalizeRemotliJob orders inverted salary bounds');
  else fail(`normalizeRemotliJob inverted salary = ${JSON.stringify(inverted?.salary)}`);

  // Only `active` rows survive — this is the built-in liveness guarantee.
  const closed = [
    normalizeRemotliJob(row({ title: 'Closed', slug: 'c1', status: 'closed' })),
    normalizeRemotliJob(row({ title: 'Draft', slug: 'c2', status: 'draft' })),
    normalizeRemotliJob(row({ title: 'Expired', slug: 'c3', status: 'EXPIRED' })),
  ];
  if (closed.every(c => c === null)) pass('normalizeRemotliJob drops non-active rows (built-in liveness)');
  else fail(`normalizeRemotliJob non-active = ${JSON.stringify(closed)}`);

  // Unknown status fails CLOSED. An earlier revision treated a missing status as
  // open ("don't penalize missing data"), which made the liveness guarantee
  // conditional on the API always sending the field. Built inline rather than
  // through row(), which now defaults status to 'active'.
  const unknownStatus = [
    normalizeRemotliJob({ jobs: { title: 'T', slug: 'ns' }, companies: {} }),           // absent
    normalizeRemotliJob({ jobs: { title: 'T', slug: 'ns', status: null }, companies: {} }),
    normalizeRemotliJob({ jobs: { title: 'T', slug: 'ns', status: 1 }, companies: {} }), // non-string
    normalizeRemotliJob({ jobs: { title: 'T', slug: 'ns', status: '' }, companies: {} }),
    normalizeRemotliJob({ jobs: { title: 'T', slug: 'ns', status: '  ' }, companies: {} }),
  ];
  if (unknownStatus.every(s => s === null)) {
    pass('normalizeRemotliJob rejects rows whose status is missing, null, non-string or blank (fails closed)');
  } else {
    fail(`normalizeRemotliJob unknown-status = ${JSON.stringify(unknownStatus)}`);
  }

  // ...but a well-formed active row still survives, so the check above is not
  // passing merely because normalizeRemotliJob rejects everything.
  const active = normalizeRemotliJob(row({ title: 'T', slug: 'ns' }));
  if (active && active.url === 'https://remotli.ch/jobs/ns') pass('normalizeRemotliJob keeps rows with status "active"');
  else fail(`normalizeRemotliJob active row = ${JSON.stringify(active)}`);

  // Case and surrounding whitespace are normalised before the comparison.
  const messyActive = normalizeRemotliJob({ jobs: { title: 'T', slug: 'ns', status: '  ACTIVE  ' }, companies: {} });
  if (messyActive && messyActive.url === 'https://remotli.ch/jobs/ns') pass('normalizeRemotliJob trims and lowercases status before comparing');
  else fail(`normalizeRemotliJob messy active = ${JSON.stringify(messyActive)}`);

  // Company fallbacks: job.company → companies.name → entry name → "Remotli".
  const fromJoin = normalizeRemotliJob(row({ title: 'T', slug: 'f1' }, { name: 'Join Co' }));
  const fromEntry = normalizeRemotliJob(row({ title: 'T', slug: 'f2' }), 'Entry Name');
  const fallback = normalizeRemotliJob(row({ title: 'T', slug: 'f3' }));
  if (fromJoin?.company === 'Join Co' && fromEntry?.company === 'Entry Name' && fallback?.company === 'Remotli') {
    pass('normalizeRemotliJob falls back company → companies.name → entry name → "Remotli"');
  } else {
    fail(`normalizeRemotliJob company fallbacks = ${JSON.stringify({ a: fromJoin?.company, b: fromEntry?.company, c: fallback?.company })}`);
  }

  // --- canonical URL (Source Indexing Policy rule 2) --------------------------
  // The employer's applyUrl is the emitted URL; the board page is the fallback.
  const urlCases = [
    ['applyUrl wins over the board page',
      row({ title: 'T', slug: 'ok', applyUrl: 'https://jobs.ashbyhq.com/acme/abc-123' }),
      'https://jobs.ashbyhq.com/acme/abc-123'],
    ['absent applyUrl falls back to the board page',
      row({ title: 'T', slug: 'ok' }),
      'https://remotli.ch/jobs/ok'],
    ['empty applyUrl falls back',
      row({ title: 'T', slug: 'ok', applyUrl: '   ' }),
      'https://remotli.ch/jobs/ok'],
    ['non-https applyUrl falls back rather than being trusted',
      row({ title: 'T', slug: 'ok', applyUrl: 'http://jobs.example.com/1' }),
      'https://remotli.ch/jobs/ok'],
    ['javascript: applyUrl falls back',
      row({ title: 'T', slug: 'ok', applyUrl: 'javascript:alert(1)' }),
      'https://remotli.ch/jobs/ok'],
    ['malformed applyUrl falls back',
      row({ title: 'T', slug: 'ok', applyUrl: 'not a url' }),
      'https://remotli.ch/jobs/ok'],
    ['non-string applyUrl falls back',
      row({ title: 'T', slug: 'ok', applyUrl: 42 }),
      'https://remotli.ch/jobs/ok'],
    // The slug is only interpolated on the fallback path, so an unsafe slug no
    // longer costs us a real posting — it just never gets used.
    ['unsafe slug is still emitted when applyUrl is usable',
      row({ title: 'T', slug: '../../etc/passwd', applyUrl: 'https://jobs.lever.co/acme/xyz' }),
      'https://jobs.lever.co/acme/xyz'],
  ];
  const urlFailures = urlCases.filter(([, r, want]) => {
    const got = normalizeRemotliJob(r);
    return !got || got.url !== want;
  });
  if (urlFailures.length === 0) {
    pass('normalizeRemotliJob emits applyUrl as the canonical URL, falling back to the board page (8 cases)');
  } else {
    fail(`canonical URL cases failed: ${urlFailures.map(([n]) => n).join('; ')}`);
  }

  // Slug is the only thing interpolated into the URL — keep it path-safe.
  const badSlugs = [
    normalizeRemotliJob(row({ title: 'T', slug: '../../etc/passwd' })),
    normalizeRemotliJob(row({ title: 'T', slug: 'a/b' })),
    normalizeRemotliJob(row({ title: 'T', slug: 'a?b=c' })),
    normalizeRemotliJob(row({ title: 'T', slug: '' })),
    normalizeRemotliJob(row({ title: '', slug: 'ok' })),
    normalizeRemotliJob({ companies: {} }),
    normalizeRemotliJob(null),
  ];
  if (badSlugs.every(b => b === null)) pass('normalizeRemotliJob drops path-unsafe slugs, empty title and malformed rows');
  else fail(`normalizeRemotliJob bad rows = ${JSON.stringify(badSlugs)}`);

  // Out-of-range numeric entities must not throw. String.fromCodePoint raises
  // RangeError above 0x10FFFF and Number.isFinite does not catch it, so an
  // unguarded decode let one malformed description abort the entire page fetch
  // and drop every job on the board.
  // The contract is not merely "does not throw": _html-entities.mjs passes an
  // out-of-range entity through VERBATIM (the regex matches, the range guard
  // rejects the codepoint, the original text is returned). Assert that the
  // surrounding prose survives intact and the entity is neither dropped nor
  // replaced with a replacement character.
  const OUT_OF_RANGE = 'pay &#99999999; and &#xFFFFFFF; ok';
  let entityResult;
  try {
    const dec = normalizeRemotliJob(row({ title: 'T', slug: 'ent', status: 'active', description: OUT_OF_RANGE }));
    entityResult = dec ? dec.description : '<row dropped>';
  } catch (e) {
    entityResult = `<threw: ${e && e.message}>`;
  }
  if (entityResult === OUT_OF_RANGE) {
    pass('normalizeRemotliJob passes out-of-range numeric/hex entities through verbatim (no RangeError, no data loss)');
  } else {
    fail(`normalizeRemotliJob mangled an out-of-range entity: ${JSON.stringify(entityResult)}`);
  }

  // In-range entities must still decode — otherwise the assertion above would
  // also pass on a decoder that had been accidentally turned into a no-op.
  // Input shape is real HTML with an encoded ampersand, which is what /api/jobs
  // serves: strip removes the tags, decode then resolves the entity. (This is
  // the strip-once-then-decode order shared with agentic-jobs.mjs / avature.mjs;
  // it relies on the API emitting real tags rather than `&lt;p&gt;`.)
  const decoded = normalizeRemotliJob(row({ title: 'T', slug: 'e2', status: 'active', description: '<p>R&amp;D team</p>' }));
  if (decoded && decoded.description === 'R&D team') {
    pass('normalizeRemotliJob strips tags then decodes entities (house order)');
  } else {
    fail(`normalizeRemotliJob entity decode = ${JSON.stringify(decoded && decoded.description)}`);
  }

  // …and the same must hold through fetch(), where one bad row previously
  // killed every other job on the page.
  let pageSurvived = false;
  try {
    const mixed = await remotli.fetch({ name: 'R' }, {
      fetchJson: async () => ({
        jobs: [
          { jobs: { title: 'Good', slug: 'good', status: 'active' } },
          { jobs: { title: 'Bad', slug: 'bad', status: 'active', description: '&#99999999;' } },
        ],
        pagination: { totalPages: 1 },
      }),
    });
    pageSurvived = mixed.length === 2;
  } catch {
    pageSurvived = false;
  }
  if (pageSurvived) pass('fetch() keeps the whole page when one description carries a malformed entity');
  else fail('fetch() lost the page over a single malformed entity');

  // Missing date → no postedAt key at all.
  const noDate = normalizeRemotliJob(row({ title: 'T', slug: 'nd' }));
  if (noDate && !('postedAt' in noDate)) pass('normalizeRemotliJob omits postedAt when no date is present');
  else fail(`normalizeRemotliJob postedAt presence = ${JSON.stringify(noDate)}`);

  // --- fetch() ---------------------------------------------------------------
  const mk = (i) => ({ jobs: { title: `Role ${i}`, slug: `role-${i}`, status: 'active' }, companies: { name: `Co ${i}` } });

  const requested = [];
  const pagedFetch = async (url, opts) => {
    requested.push({ url, redirect: opts?.redirect });
    const page = Number(new URL(url).searchParams.get('page'));
    if (page === 1) return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), pagination: { page: 1, limit: 50, total: 60, totalPages: 2 } };
    return { jobs: Array.from({ length: 10 }, (_, i) => mk(50 + i)), pagination: { page: 2, limit: 50, total: 60, totalPages: 2 } };
  };

  const paged = await remotli.fetch({ name: 'Remotli' }, { fetchJson: pagedFetch });
  if (paged.length === 60) pass('fetch() walks pages and aggregates all rows (50 + 10)');
  else fail(`fetch() returned ${paged.length} jobs (expected 60)`);

  if (requested.length === 2
      && requested[0].url === 'https://remotli.ch/api/jobs?page=1&limit=50&remote=all'
      && requested[1].url === 'https://remotli.ch/api/jobs?page=2&limit=50&remote=all') {
    pass('fetch() builds ?page=N&limit=50 URLs and stops after the short page');
  } else {
    fail(`fetch() requested = ${JSON.stringify(requested.map(r => r.url))}`);
  }

  if (requested.every(r => r.redirect === 'error')) pass('fetch() passes redirect:"error" on every page (SSRF guard)');
  else fail(`fetch() redirect opts = ${JSON.stringify(requested.map(r => r.redirect))}`);

  // ctx.maxPages (verify-portals health probe) caps the walk at one page.
  const capped = [];
  await remotli.fetch({ name: 'Remotli' }, {
    maxPages: 1,
    fetchJson: async (url) => {
      capped.push(url);
      return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), pagination: { page: 1, limit: 50, total: 500, totalPages: 10 } };
    },
  });
  if (capped.length === 1) pass('fetch() honors ctx.maxPages (health probe reads one page only)');
  else fail(`fetch() with maxPages:1 requested ${capped.length} pages`);

  // entry.max_pages is the per-target override used when ctx.maxPages is absent
  // (the DEFAULT_MAX_PAGES fallback sits behind it). Previously unexercised.
  const entryCapped = [];
  await remotli.fetch({ name: 'Remotli', max_pages: 2 }, {
    fetchJson: async (url) => {
      entryCapped.push(url);
      return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), pagination: { page: 1, limit: 50, total: 500, totalPages: 10 } };
    },
  });
  if (entryCapped.length === 2) pass('fetch() honors entry.max_pages when ctx.maxPages is absent');
  else fail(`fetch() with entry.max_pages:2 requested ${entryCapped.length} pages`);

  // ctx.maxPages must win over entry.max_pages — the health probe has to be able
  // to force a single page regardless of how the target is configured.
  const bothSet = [];
  await remotli.fetch({ name: 'Remotli', max_pages: 5 }, {
    maxPages: 1,
    fetchJson: async (url) => {
      bothSet.push(url);
      return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), pagination: { page: 1, limit: 50, total: 500, totalPages: 10 } };
    },
  });
  if (bothSet.length === 1) pass('fetch() lets ctx.maxPages override entry.max_pages');
  else fail(`fetch() with ctx.maxPages:1 + entry.max_pages:5 requested ${bothSet.length} pages`);

  // Unexpected shape → throws rather than silently returning nothing.
  let threw = false;
  try {
    await remotli.fetch({ name: 'X' }, { fetchJson: async () => ({ wrong: true }) });
  } catch (e) {
    threw = /unexpected API response/.test(e.message);
  }
  if (threw) pass('fetch() throws on an unexpected API response shape (no silent empty result)');
  else fail('fetch() should throw when the jobs array is absent');

  // --- dead-board contract ---------------------------------------------------
  // Half one: a first-request failure must throw, so a genuinely dead board is
  // reported as dead rather than as an empty board.
  let firstPageThrew = false;
  try {
    await remotli.fetch({ name: 'X' }, {
      fetchJson: async () => { throw new Error('ECONNREFUSED'); },
    });
  } catch (e) {
    firstPageThrew = /ECONNREFUSED/.test(e.message);
  }
  if (firstPageThrew) pass('fetch() throws when the FIRST request fails (dead board stays dead)');
  else fail('fetch() swallowed a first-request failure');

  // A malformed page-1 body is not proof of life either: the shape error must
  // propagate rather than being treated as "reachable, just empty".
  let firstPageShapeThrew = false;
  try {
    await remotli.fetch({ name: 'X' }, {
      fetchJson: async (url) => {
        if (Number(new URL(url).searchParams.get('page')) === 1) return { wrong: true };
        return { jobs: [], pagination: { totalPages: 1 } };
      },
    });
  } catch (e) {
    firstPageShapeThrew = /unexpected API response/.test(e.message);
  }
  if (firstPageShapeThrew) pass('fetch() treats a malformed first page as a dead board, not as proof of life');
  else fail('fetch() accepted a malformed first page as reachable');

  // Half two: once one page has parsed, a transient mid-scan failure keeps the
  // rows already collected instead of discarding the whole target.
  let partial = null;
  let partialThrew = null;
  try {
    partial = await remotli.fetch({ name: 'X' }, {
      fetchJson: async (url) => {
        const page = Number(new URL(url).searchParams.get('page'));
        if (page >= 3) throw new Error('ETIMEDOUT on page 3');
        return { jobs: Array.from({ length: 50 }, (_, i) => mk(page * 100 + i)), pagination: { page, limit: 50, total: 400, totalPages: 8 } };
      },
    });
  } catch (e) {
    partialThrew = e;
  }
  if (!partialThrew && partial && partial.length === 100) {
    pass('fetch() keeps pages 1-2 when page 3 fails mid-scan (partial-keep, not total loss)');
  } else {
    fail(`fetch() mid-scan failure: threw=${partialThrew && partialThrew.message} length=${partial && partial.length}`);
  }

  // Same idiom, malformed body rather than a thrown request.
  let partialShape = null;
  try {
    partialShape = await remotli.fetch({ name: 'X' }, {
      fetchJson: async (url) => {
        const page = Number(new URL(url).searchParams.get('page'));
        if (page >= 2) return { garbage: true };
        return { jobs: Array.from({ length: 50 }, (_, i) => mk(i)), pagination: { page: 1, limit: 50, total: 400, totalPages: 8 } };
      },
    });
  } catch {
    partialShape = null;
  }
  if (partialShape && partialShape.length === 50) {
    pass('fetch() keeps page 1 when a later page returns a malformed body');
  } else {
    fail(`fetch() malformed later page returned ${partialShape && partialShape.length}`);
  }

} catch (e) {
  fail(`remotli provider tests crashed: ${e.message}`);
}
