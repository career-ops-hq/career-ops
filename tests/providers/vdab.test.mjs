// tests/providers/vdab.test.mjs
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — vdab');

try {
  const vdabModule = await import(pathToFileURL(join(ROOT, 'providers/vdab.mjs')).href);
  const vdab = vdabModule.default;
  const { parseVdabConfig, normalizeJob, extractDescription } = vdabModule;

  if (vdab.id === 'vdab') pass('vdab.id is "vdab"');
  else fail(`vdab.id is ${JSON.stringify(vdab.id)}`);

  // parseVdabConfig — defaults when block is absent
  const def = parseVdabConfig({});
  if (def.days === 30 && def.size === 100 && def.fetchDetails === false && def.detailLimit === 25) {
    pass('parseVdabConfig applies defaults (days 30, size 100, details off)');
  } else {
    fail(`parseVdabConfig defaults = ${JSON.stringify(def)}`);
  }

  // parseVdabConfig — clamps numeric settings
  const cfg = parseVdabConfig({
    vdab: {  size: 0, days: -3 },
  });
  if (cfg.size === 1 && cfg.days === 1) {
    pass('parseVdabConfig clamps size/days into range');
  } else {
    fail(`parseVdabConfig sanitized = ${JSON.stringify(cfg)}`);
  }
  const clampedHigh = parseVdabConfig({ vdab: {  size: 999, days: 999999 } });
  if (clampedHigh.size === 100 && clampedHigh.days === 1000) {
    pass('parseVdabConfig clamps size/days at their upper bound');
  } else {
    fail(`parseVdabConfig upper clamp = ${JSON.stringify(clampedHigh)}`);
  }
  const detailsCfg = parseVdabConfig({ vdab: {  fetchDetails: true, detailLimit: 999 } });
  if (detailsCfg.fetchDetails === true && detailsCfg.detailLimit === 100) {
    pass('parseVdabConfig supports opt-in detail fetching and clamps detailLimit');
  } else {
    fail(`parseVdabConfig detail options = ${JSON.stringify(detailsCfg)}`);
  }
  const detailsLow = parseVdabConfig({ vdab: {  detailLimit: -5 } });
  if (detailsLow.detailLimit === 1) {
    pass('parseVdabConfig clamps detailLimit at its lower bound');
  } else {
    fail(`parseVdabConfig detailLimit lower clamp = ${JSON.stringify(detailsLow.detailLimit)}`);
  }

  // normalizeJob — happy path maps VDAB's field names into the Job shape
  const norm = normalizeJob({
    id: { id: 74022311 },
    vacaturefunctie: { naam: '  Python Developer  ' },
    vacatureBedrijfsnaam: ' Acme ',
    tewerkstellingsLocatieRegioOfAdres: 'ANTWERPEN',
    eerstePublicatieDatum: '2026-07-19T02:30:37Z',
  });
  if (
    norm && norm.title === 'Python Developer' && norm.company === 'Acme'
    && norm.location === 'ANTWERPEN'
    && norm.url === 'https://www.vdab.be/vindeenjob/vacatures/74022311'
    && norm.postedAt === Date.parse('2026-07-19T02:30:37Z')
    && norm.id === '74022311'
  ) {
    pass('normalizeJob maps VDAB fields to the Job shape and encodes the detail URL');
  } else {
    fail(`normalizeJob = ${JSON.stringify(norm)}`);
  }
  if (normalizeJob({ vacaturefunctie: { naam: 'No id' } }) === null
      && normalizeJob({ id: { id: 1 }, vacaturefunctie: { naam: '' } }) === null) {
    pass('normalizeJob returns null without an id or title');
  } else {
    fail('normalizeJob should return null when id or title is missing');
  }

  if (
    extractDescription({ functie: { omschrijving: { markdown: ' **Build** things ', plainText: 'Fallback' } } }) === '**Build** things'
    && extractDescription({ functie: { omschrijving: { plainText: ' Plain text ' } } }) === 'Plain text'
    && extractDescription({}) === ''
  ) {
    pass('extractDescription prefers markdown, falls back to plainText, and trims');
  } else {
    fail('extractDescription returned an unexpected value');
  }

  // fetch() — pagination follows short-page-break, dedup across keywords, header sent
  let sentKey = null;
  const mkCtx = (byTrefwoord) => ({
    fetchJson: async (url, opts) => {
      sentKey = opts?.headers?.['vej-key-monitor'] ?? sentKey;
      const body = JSON.parse(opts.body);
      const trefwoord = body.criteria.trefwoord;
      const pages = byTrefwoord[trefwoord] || [];
      const resultaten = pages[body.pagina] || [];
      return { resultaten };
    },
  });
  const job = (id, naam) => ({ id: { id }, vacaturefunctie: { naam }, vacatureBedrijfsnaam: 'Co', tewerkstellingsLocatieRegioOfAdres: 'GENT' });
  const fetched = await vdab.fetch(
    { name: 'VDAB', vdab: {  size: 1 } }, { ...(mkCtx({
      python: [[job(1, 'Python Dev')], []], // one full page then an empty page → stop
      data: [[job(1, 'Python Dev')], []],   // dup id across keywords
    })), searchKeywords: ['python', 'data'] },
  );
  if (fetched.length === 1 && !('id' in fetched[0])) pass('vdab.fetch() dedups by id and strips id from output');
  else fail(`vdab.fetch() returned ${JSON.stringify(fetched)}`);
  if (sentKey === 'b277002f-e1fa-4fc5-868a-fdab633c3851') pass('vdab.fetch() sends the vej-key-monitor header');
  else fail(`vdab.fetch() vej-key-monitor = ${JSON.stringify(sentKey)}`);

  // fetch() — detail enrichment is opt-in, bounded, batched, and fail-open.
  {
    const jsonCalls = [];
    const ctx = {
      fetchJson: async (url, opts) => {
        jsonCalls.push(url);
        if (url.includes('/vacatures/2?preview=false')) throw new Error('HTTP 500');
        if (url.includes('/vacatures/')) {
          const id = url.match(/\/vacatures\/(\d+)/)?.[1];
          return { functie: { omschrijving: { markdown: `Description ${id}` } } };
        }
        return { resultaten: [[1, 'A'], [2, 'B'], [3, 'C']].map(([id, naam]) => job(id, naam)) };
      },
      fetchText: async () => '',
    };
    const detailed = await vdab.fetch(
      { name: 'VDAB', vdab: {  size: 100, fetchDetails: true, detailLimit: 2 } }, { ...ctx, searchKeywords: ['python'] },
    );
    const detailCalls = jsonCalls.filter(u => u.includes('/vacatures/'));
    if (
      detailed.length === 3
      && detailed[0]?.description === 'Description 1'
      && !('description' in detailed[1])
      && !('description' in detailed[2])
      && detailCalls.length === 2
    ) {
      pass('vdab.fetch() opt-in detail enrichment adds descriptions, respects detailLimit, and fails open per detail');
    } else {
      fail(`vdab.fetch() detail enrichment result=${JSON.stringify(detailed)}, calls=${JSON.stringify(detailCalls)}`);
    }
  }

  // fetch() — detail lookups must stay batched (DETAIL_BATCH = 5). With more
  // candidates than one batch, peak in-flight requests must never exceed the
  // cap, and every job across the batch boundary must still get enriched.
  {
    let inFlight = 0;
    let peakInFlight = 0;
    const detailIds = [];
    const sevenJobs = [1, 2, 3, 4, 5, 6, 7].map(id => job(id, `Job ${id}`));
    const batched = await vdab.fetch(
      { name: 'VDAB', vdab: {  size: 100, fetchDetails: true, detailLimit: 25 } }, { ...({
        fetchJson: async (url) => {
          if (url.includes('/vacatures/')) {
            const id = url.match(/\/vacatures\/(\d+)/)?.[1];
            detailIds.push(id);
            inFlight++;
            peakInFlight = Math.max(peakInFlight, inFlight);
            await new Promise(r => setTimeout(r, 5)); // hold the slot so overlap is observable
            inFlight--;
            return { functie: { omschrijving: { markdown: `Description ${id}` } } };
          }
          return { resultaten: sevenJobs };
        },
      }), searchKeywords: ['python'] },
    );
    if (peakInFlight > 0 && peakInFlight <= 5) {
      pass(`vdab.fetch() caps concurrent detail lookups at DETAIL_BATCH (peak ${peakInFlight})`);
    } else {
      fail(`vdab.fetch() peak in-flight detail requests = ${peakInFlight} (expected 1..5)`);
    }
    if (detailIds.length === 7 && new Set(detailIds).size === 7
        && batched.every(j => j.description === `Description ${j.url.split('/').pop()}`)) {
      pass('vdab.fetch() enriches every job across a DETAIL_BATCH boundary, not just the first batch');
    } else {
      fail(`vdab.fetch() cross-batch enrichment: detailIds=${JSON.stringify(detailIds)}, batched=${JSON.stringify(batched)}`);
    }
  }

  // fetch() — pagination stops when a page is shorter than the requested size
  const paged = await vdab.fetch(
    { name: 'VDAB', vdab: {  size: 2 } }, { ...(mkCtx({ python: [[job(1, 'A'), job(2, 'B')], [job(3, 'C')]] })), searchKeywords: ['python'] }, // page0 full (2), page1 short (1) → stop after page1
  );
  if (paged.length === 3) pass('vdab.fetch() paginates until a short page is returned');
  else fail(`vdab.fetch() pagination returned ${JSON.stringify(paged)}`);

  // fetch() — a real scan (no ctx.maxPages) still terminates even if the API
  // keeps returning full pages forever (a bug, or a pathologically broad
  // keyword) — the MAX_PAGES_PER_KEYWORD safety cap must stop the loop
  // rather than trusting the short-page heuristic alone.
  {
    let pageRequests = 0;
    const neverEndingPage = await vdab.fetch(
      { name: 'VDAB', vdab: {  size: 1 } }, { ...({ fetchJson: async () => { pageRequests++; return { resultaten: [job(pageRequests, `Job ${pageRequests}`)] }; } }), searchKeywords: ['python'] }, // always a "full" page (length === size)
    );
    if (pageRequests === 50 && neverEndingPage.length === 50) {
      pass('vdab.fetch() caps real-scan pagination at MAX_PAGES_PER_KEYWORD even when every page is full');
    } else {
      fail(`vdab.fetch() unbounded-pagination guard: pageRequests=${pageRequests}, results=${neverEndingPage.length}`);
    }
  }

  // fetch() — a malformed/missing resultaten shape degrades to an empty page
  // instead of throwing (e.g. TypeError on a non-iterable).
  {
    let malformedThrew = false;
    let malformedResult;
    try {
      malformedResult = await vdab.fetch(
        { name: 'VDAB', vdab: { } }, { ...({ fetchJson: async () => ({}) }), searchKeywords: ['python'] }, // no resultaten key at all
      );
    } catch { malformedThrew = true; }
    if (!malformedThrew && Array.isArray(malformedResult) && malformedResult.length === 0) {
      pass('vdab.fetch() treats a missing resultaten key as an empty page, not a throw');
    } else {
      fail(`vdab.fetch() malformed response: threw=${malformedThrew}, result=${JSON.stringify(malformedResult)}`);
    }

    let nullThrew = false;
    try {
      await vdab.fetch({ name: 'VDAB', vdab: { } }, { ...({ fetchJson: async () => ({ resultaten: null }) }), searchKeywords: ['python'] });
    } catch { nullThrew = true; }
    let nonArrayThrew = false;
    try {
      await vdab.fetch({ name: 'VDAB', vdab: { } }, { ...({ fetchJson: async () => ({ resultaten: 'oops' }) }), searchKeywords: ['python'] });
    } catch { nonArrayThrew = true; }
    if (!nullThrew && !nonArrayThrew) {
      pass('vdab.fetch() does not throw on a null or non-array resultaten value');
    } else {
      fail(`vdab.fetch() malformed resultaten: nullThrew=${nullThrew}, nonArrayThrew=${nonArrayThrew}`);
    }
  }



  // fetch() — one keyword answers (empty) while another fails → NOT a total
  // outage; partial success must not throw.
  let partialThrew = false;
  let partial;
  try {
    partial = await vdab.fetch(
      { name: 'VDAB', vdab: { } }, { ...({ fetchJson: async (url, opts) => {
          const trefwoord = JSON.parse(opts.body).criteria.trefwoord;
          if (trefwoord === 'bad') throw new Error('HTTP 503');
          return { resultaten: [] }; // ok answers, just empty
        } }), searchKeywords: ['ok', 'bad'] },
    );
  } catch { partialThrew = true; }
  if (!partialThrew && Array.isArray(partial) && partial.length === 0) {
    pass('vdab.fetch() does not throw when one keyword succeeds empty and another fails');
  } else {
    fail(`vdab.fetch() partial-success threw=${partialThrew}, result=${JSON.stringify(partial)}`);
  }

  // fetch() — every keyword fails → total outage, throws
  let totalOutageThrew = false;
  try {
    await vdab.fetch(
      { name: 'VDAB', vdab: { } }, { ...({ fetchJson: async () => { throw new Error('HTTP 500'); } }), searchKeywords: ['a', 'b'] },
    );
  } catch { totalOutageThrew = true; }
  if (totalOutageThrew) pass('vdab.fetch() throws when every keyword request fails (total outage)');
  else fail('vdab.fetch() should throw when every keyword request fails');

  // fetch() — cooperates with the bounded portal health probe
  // (ctx.maxPages set): caps pagination per keyword, and does NOT swallow a
  // mid-run error into the recall-first per-keyword tolerance loop, so the
  // probe's own budget-exhaustion sentinel (or any real error hit while
  // probing) propagates with its original identity intact.
  {
    // pageLimit: a keyword needing 3 pages to fully paginate only issues 1
    // request when ctx.maxPages=1 (probe-cooperative pagination).
    let requests = 0;
    const paged = await vdab.fetch(
      { name: 'VDAB', vdab: {  size: 1 } }, { ...({
        maxPages: 1,
        fetchJson: async () => { requests++; return { resultaten: [{ id: { id: 1 }, vacaturefunctie: { naam: 'A' } }] }; }, // always a "full" page (length===size) — would paginate forever without the cap
      }), searchKeywords: ['python'] },
    );
    if (requests === 1 && paged.length === 1) {
      pass('vdab.fetch() caps pagination at ctx.maxPages during a probe');
    } else {
      fail(`vdab.fetch() probe pagination: requests=${requests}, result=${JSON.stringify(paged)}`);
    }

    // probing: a per-keyword error propagates immediately, unwrapped, instead
    // of being flattened into a generic "all keyword requests failed" Error —
    // this is what lets the bounded caller's budget-sentinel check (and any other error-identity check)
    // still work when a provider is probed instead of scanned normally.
    class FakeSentinel extends Error {}
    let caught = null;
    try {
      await vdab.fetch(
        { name: 'VDAB', vdab: { } }, { ...({ maxPages: 1, fetchJson: async () => { throw new FakeSentinel(); } }), searchKeywords: ['a', 'b'] },
      );
    } catch (err) { caught = err; }
    if (caught instanceof FakeSentinel) {
      pass('vdab.fetch() propagates a per-keyword error unwrapped while probing (ctx.maxPages set)');
    } else {
      fail(`vdab.fetch() probing error identity lost: ${caught?.constructor?.name}`);
    }

    // Same scenario without ctx.maxPages (a real scan) keeps full recall-first
    // tolerance — the same per-keyword error is still flattened into the
    // summary Error, unchanged from prior behavior.
    let scanCaught = null;
    try {
      await vdab.fetch(
        { name: 'VDAB', vdab: { } }, { ...({ fetchJson: async () => { throw new FakeSentinel(); } }), searchKeywords: ['a', 'b'] },
      );
    } catch (err) { scanCaught = err; }
    if (scanCaught && !(scanCaught instanceof FakeSentinel) && /all 2 keyword/.test(scanCaught.message)) {
      pass('vdab.fetch() keeps recall-first summary-error behavior for a real scan (no ctx.maxPages)');
    } else {
      fail(`vdab.fetch() real-scan error handling regressed: ${scanCaught?.message}`);
    }

    // Detail enrichment is skipped entirely while probing, even if
    // fetchDetails is configured on — it answers "what does this job say",
    // not "is this endpoint alive", so it must never spend probe budget.
    let detailCalls = 0;
    const probedWithDetails = await vdab.fetch(
      { name: 'VDAB', vdab: {  fetchDetails: true } }, { ...({
        maxPages: 1,
        fetchJson: async (url) => {
          if (url.includes('/vacatures/')) { detailCalls++; return {}; }
          return { resultaten: [{ id: { id: 1 }, vacaturefunctie: { naam: 'A' } }] };
        } }), searchKeywords: ['python'] },
    );
    if (detailCalls === 0 && probedWithDetails.length === 1 && !('description' in probedWithDetails[0])) {
      pass('vdab.fetch() skips detail enrichment entirely while probing');
    } else {
      fail(`vdab.fetch() probe detail skip: detailCalls=${detailCalls}, result=${JSON.stringify(probedWithDetails)}`);
    }
  }

  // fetch() — self-heal: a 403 on the hardcoded key triggers one re-derivation
  // from the live bundle, then the retry succeeds with the fresh key.
  {
    const FRESH_KEY = '11111111-2222-3333-4444-555555555555';
    let fetchTextCalls = 0;
    let keysSent = [];
    const ctx = {
      fetchJson: async (url, opts) => {
        keysSent.push(opts.headers['vej-key-monitor']);
        if (opts.headers['vej-key-monitor'] !== FRESH_KEY) {
          const err = new Error('HTTP 403'); err.status = 403; throw err;
        }
        return { resultaten: [] };
      },
      fetchText: async (url) => {
        fetchTextCalls++;
        if (url === 'https://www.vdab.be/vindeenjob/vacatures') {
          return '<script src="https://www.vdab.be/webapps/vindeenjob/main-XYZ.js"></script>';
        }
        return `foo.set("vej-key-monitor","${FRESH_KEY}")`;
      },
    };
    const healed = await vdab.fetch({ name: 'VDAB', vdab: { } }, { ...ctx, searchKeywords: ['python'] });
    if (Array.isArray(healed) && healed.length === 0 && fetchTextCalls === 2 && keysSent.length === 2 && keysSent[1] === FRESH_KEY) {
      pass('vdab.fetch() self-heals a rotated key: re-derives once from the live bundle and retries');
    } else {
      fail(`self-heal: healed=${JSON.stringify(healed)}, fetchTextCalls=${fetchTextCalls}, keysSent=${JSON.stringify(keysSent)}`);
    }
  }

  // fetch() — self-heal "give-up" paths: if re-derivation can't produce a
  // fresh key (no matching bundle URL, or the bundle has no matching key
  // literal), the ORIGINAL 403 must survive — not be replaced by a different
  // error (e.g. the derivation attempt's own fetchText failure leaking
  // through instead). With a single keyword and no ctx.maxPages set (not
  // probing), the give-up path falls through the normal recall-first
  // per-keyword catch, so the 403 ends up embedded in the "total outage"
  // summary Error rather than escaping raw — that's correct, and distinct
  // from the probing case already covered above.
  {
    let threwNoBundleMatch = false;
    let caughtNoBundleMatch;
    try {
      await vdab.fetch(
        { name: 'VDAB', vdab: { } }, { ...({
          fetchJson: async () => { const err = new Error('HTTP 403'); err.status = 403; throw err; },
          fetchText: async () => '<html><body>no script tag here</body></html>', // BUNDLE_RE never matches
        }), searchKeywords: ['python'] },
      );
    } catch (err) { threwNoBundleMatch = true; caughtNoBundleMatch = err; }
    if (threwNoBundleMatch && /HTTP 403/.test(caughtNoBundleMatch.message) && !/network error/.test(caughtNoBundleMatch.message)) {
      pass('vdab.fetch() surfaces the original 403 unchanged when the live bundle URL cannot be found');
    } else {
      fail(`give-up (no bundle match): threw=${threwNoBundleMatch}, error=${caughtNoBundleMatch?.message}`);
    }

    let threwNoKeyMatch = false;
    let caughtNoKeyMatch;
    try {
      await vdab.fetch(
        { name: 'VDAB', vdab: { } }, { ...({
          fetchJson: async () => { const err = new Error('HTTP 403'); err.status = 403; throw err; },
          fetchText: async (url) => (url === 'https://www.vdab.be/vindeenjob/vacatures'
            ? '<script src="https://www.vdab.be/webapps/vindeenjob/main-XYZ.js"></script>'
            : 'no key literal in this bundle'), // bundle found, but KEY_RE never matches
        }), searchKeywords: ['python'] },
      );
    } catch (err) { threwNoKeyMatch = true; caughtNoKeyMatch = err; }
    if (threwNoKeyMatch && /HTTP 403/.test(caughtNoKeyMatch.message) && !/network error/.test(caughtNoKeyMatch.message)) {
      pass('vdab.fetch() surfaces the original 403 unchanged when the bundle has no matching key literal');
    } else {
      fail(`give-up (no key match): threw=${threwNoKeyMatch}, error=${caughtNoKeyMatch?.message}`);
    }

    let threwFetchTextError = false;
    let caughtFetchTextError;
    try {
      await vdab.fetch(
        { name: 'VDAB', vdab: { } }, { ...({
          fetchJson: async () => { const err = new Error('HTTP 403'); err.status = 403; throw err; },
          fetchText: async () => { throw new Error('network error'); }, // deriveKeyFromBundle itself rejects
        }), searchKeywords: ['python'] },
      );
    } catch (err) { threwFetchTextError = true; caughtFetchTextError = err; }
    if (threwFetchTextError && /HTTP 403/.test(caughtFetchTextError.message) && !/network error/.test(caughtFetchTextError.message)) {
      pass('vdab.fetch() surfaces the original 403 unchanged when fetchText itself rejects during re-derivation');
    } else {
      fail(`give-up (fetchText throws): threw=${threwFetchTextError}, error=${caughtFetchTextError?.message}`);
    }
  }

  // fetch() — self-heal only ever attempts once per fetch() call, even across
  // multiple keywords, and does not loop forever if the key never validates.
  {
    let jsonCalls = 0;
    let fetchTextCalls = 0;
    const ctx = {
      fetchJson: async () => {
        jsonCalls++;
        const err = new Error('HTTP 403'); err.status = 403; throw err;
      },
      fetchText: async (url) => {
        fetchTextCalls++;
        if (url === 'https://www.vdab.be/vindeenjob/vacatures') {
          return '<script src="https://www.vdab.be/webapps/vindeenjob/main-XYZ.js"></script>';
        }
        return 'foo.set("vej-key-monitor","99999999-9999-9999-9999-999999999999")';
      },
    };
    let stillOutageThrew = false;
    try {
      await vdab.fetch({ name: 'VDAB', vdab: { } }, { ...ctx, searchKeywords: ['a', 'b'] });
    } catch { stillOutageThrew = true; }
    // Keyword 'a': 2 fetchJson calls (stale-key initial + fresh-key retry).
    // Keyword 'b': activeKey is already the fresh one from 'a's retry (shared
    // closure state), so its first call uses it directly — 1 call, no retry
    // of its own. Total: 3 fetchJson calls; re-derivation itself runs once
    // (2 fetchText calls: page + bundle), not once per keyword.
    if (stillOutageThrew && jsonCalls === 3 && fetchTextCalls === 2) {
      pass('vdab.fetch() attempts self-heal derivation only once per fetch() call, not per keyword');
    } else {
      fail(`self-heal-once: threw=${stillOutageThrew}, jsonCalls=${jsonCalls}, fetchTextCalls=${fetchTextCalls}`);
    }
  }

  // fetch() — a non-403 error never triggers self-heal (fetchText untouched)
  {
    let fetchTextCalls = 0;
    const ctx = {
      fetchJson: async () => { throw new Error('HTTP 500'); },
      fetchText: async () => { fetchTextCalls++; return ''; },
    };
    let threw500 = false;
    try { await vdab.fetch({ name: 'VDAB', vdab: { } }, { ...ctx, searchKeywords: ['a'] }); }
    catch { threw500 = true; }
    if (threw500 && fetchTextCalls === 0) pass('vdab.fetch() does not attempt self-heal on a non-403 error');
    else fail(`non-403 self-heal: threw=${threw500}, fetchTextCalls=${fetchTextCalls}`);
  }

} catch (e) {
  fail(`vdab provider tests crashed: ${e.message}`);
}
