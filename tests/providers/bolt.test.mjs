// tests/providers/bolt.test.mjs — bolt provider contract (Next.js flight-stream positions).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — bolt');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/bolt.mjs')).href);
  const provider = mod.default;
  const { parsePositions } = mod;

  const ID_A = '11111111-aaaa-4bbb-8ccc-000000000001';
  const ID_B = '11111111-aaaa-4bbb-8ccc-000000000002';
  const ID_C = '11111111-aaaa-4bbb-8ccc-000000000003';
  const ID_D = '11111111-aaaa-4bbb-8ccc-000000000004';
  const ID_E = '11111111-aaaa-4bbb-8ccc-000000000005';
  const BASE = 'https://bolt.eu/en/careers/positions/';

  // A position as the page ships it (shape captured from the live page, values fictional).
  const position = (id, title, locations, posted = '$D2026-10-07T00:00:00.000Z') => ({
    id,
    header: { roleTitle: title, parentTeamTitle: 'Operations', locations },
    body: { description: 'Teaser text.', jobPostedDate: posted, applyLinkProps: { href: `/en/careers/positions/${id}/` } },
  });

  // The page: the jobs array sits in a flight chunk, which is a JSON string literal inside a
  // script call, and can be split across several chunks.
  const pageWith = (jobsJson) => {
    const stream = `1:{"children":[],"parsedJobs":${jobsJson},"other":{"x":[1,2]}}`;
    const mid = Math.floor(stream.length / 2);
    const chunk = (s) => `<script>self.__next_f.push([1,${JSON.stringify(s)}])</script>`;
    return `<!doctype html><html><body>${chunk('0:["$","div",null,{}]\n')}${chunk(stream.slice(0, mid))}${chunk(stream.slice(mid))}</body></html>`;
  };
  const page = (rows) => pageWith(JSON.stringify(rows));

  if (provider.id === 'bolt') pass('bolt.id is "bolt"');
  else fail(`bolt.id is ${JSON.stringify(provider.id)}`);

  // ── detect(): none, bolt.eu is a branded domain reached only with `provider: bolt` ──
  if (provider.detect === undefined) pass('bolt omits detect(): reachable only by an explicit provider: bolt');
  else fail('bolt must not define detect() (a branded domain is never matched by URL)');
  {
    const { loadProviders, resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers', '_registry.mjs')).href);
    const providers = await loadProviders(join(ROOT, 'providers'));
    const url = 'https://bolt.eu/en/careers/positions/';
    const viaUrl = resolveProvider({ name: 'Bolt', careers_url: url, scan_method: 'websearch' }, providers);
    const viaId = resolveProvider({ name: 'Bolt', careers_url: url, provider: 'bolt' }, providers);
    if (viaUrl?.provider?.id !== 'bolt' && viaId?.provider?.id === 'bolt') pass('bolt is selected by provider: bolt and never claimed by the bolt.eu URL alone');
    else fail(`bolt registry resolution: url -> ${JSON.stringify(viaUrl)}, provider -> ${viaId?.provider?.id}`);
  }

  // ── parsePositions(): normalization ──
  const rows = [
    position(ID_A, 'Operations Lead & Strategy', [{ city: 'Tallinn', country: 'Estonia', countryCode: 'ee' }, { city: 'Warsaw', country: 'Poland', countryCode: 'pl' }]),
    position(ID_B, '  Account Manager  ', [{ city: '', country: 'Spain', countryCode: 'es' }], '$Dnot-a-date'),
    position(ID_C, 'Remote Analyst', []),
  ];
  const jobs = parsePositions(page(rows), 'Acme');
  if (jobs.length === 3) pass('bolt.parsePositions() returns every position, with no country filter');
  else fail(`bolt returned ${jobs.length} jobs`);

  const [a, b, c] = jobs;
  if (a?.url === `${BASE}${ID_A}/` && a.company === 'Acme') pass('bolt job url is rebuilt on the fixed positions page; company is the entry name');
  else fail(`a = ${JSON.stringify(a)}`);
  if (a?.title === 'Operations Lead & Strategy') pass('bolt title is taken as the page gives it (already JSON text, no entity decoding)');
  else fail(`title = ${JSON.stringify(a?.title)}`);
  if (a?.location === 'Tallinn, Estonia; Warsaw, Poland' && JSON.stringify(a.locations) === JSON.stringify(['Tallinn, Estonia', 'Warsaw, Poland'])) pass('bolt joins city and country, and keeps the distinct places in locations');
  else fail(`location = ${JSON.stringify(a?.location)} locations = ${JSON.stringify(a?.locations)}`);
  if (a?.postedAt === Date.UTC(2026, 9, 7)) pass('bolt reads the "$D" date marker into postedAt');
  else fail(`postedAt = ${JSON.stringify(a?.postedAt)}`);
  if (b?.title === 'Account Manager' && b.location === 'Spain' && !('postedAt' in b)) pass('bolt trims the title, drops an empty city, and leaves a bad date off');
  else fail(`b = ${JSON.stringify(b)}`);
  if (!('country' in a) && b?.country === 'es' && !('country' in c)) pass('bolt sets country only when the source places agree on one country code');
  else fail(`country = ${JSON.stringify([a?.country, b?.country, c?.country])}`);
  {
    const mixed = parsePositions(page([
      position(ID_D, 'Mixed A', [{ city: 'Madrid', country: 'Spain', countryCode: 'es' }, { city: 'Lisbon', country: 'Portugal' }]),
      position(ID_E, 'Mixed B', [{ city: 'Madrid', country: 'Spain', countryCode: 'es' }, { city: 'Sevilla', country: 'Spain', countryCode: 'es' }]),
    ]), 'Acme');
    if (!('country' in mixed[0]) && mixed[1]?.country === 'es') pass('bolt leaves country unset when one place has no code, and keeps it when every place agrees');
    else fail(`mixed country = ${JSON.stringify(mixed.map((j) => j.country))}`);
  }
  if (c?.location === '' && !('locations' in c)) pass('bolt position with no places gets an empty location and no locations key');
  else fail(`c = ${JSON.stringify(c)}`);
  if ('description' in a) fail('bolt must not set description from the teaser');
  else pass('bolt sets no description (the page carries only a teaser)');

  const id = a?.listingIdentity;
  if (id?.ats_provider === 'bolt' && id.board_slug === 'bolt' && id.posting_id === ID_A && Object.keys(id).length === 3) pass('bolt returns the bolt/bolt/<position id> listingIdentity');
  else fail(`identity = ${JSON.stringify(id)}`);

  // ── malformed and duplicate rows are dropped, the rest stand ──
  const messy = parsePositions(page([
    position(ID_A, 'Kept', []),
    position(ID_A, 'Duplicate id', []),
    { id: ID_B, header: { roleTitle: '' } },
    { id: 'not-a-uuid', header: { roleTitle: 'Bad id' } },
    null,
    'x',
  ]));
  if (messy.length === 1 && messy[0].title === 'Kept' && messy[0].company === 'Bolt') pass('bolt drops rows with no title, an unusable id or a repeated id, and defaults the company');
  else fail(`messy = ${JSON.stringify(messy)}`);

  // ── empty vs broken ──
  if (JSON.stringify(parsePositions(page([]))) === '[]') pass('bolt: a present-and-empty parsedJobs array is an empty board ([])');
  else fail('bolt: an empty parsedJobs array should return []');
  const throwsWith = (fn, re) => { try { fn(); } catch (err) { return re.test(err.message); } return false; };
  if (throwsWith(() => parsePositions('<html><body>nothing here</body></html>'), /parsedJobs.*not found/)) pass('bolt: a page with no parsedJobs throws (markup changed)');
  else fail('bolt: a page with no parsedJobs should throw');
  if (throwsWith(() => parsePositions(''), /parsedJobs.*not found/)) pass('bolt: an empty body throws');
  else fail('bolt: an empty body should throw');
  if (throwsWith(() => parsePositions(pageWith('{"not":"an array"}')), /parsedJobs.*not found/)) pass('bolt: a parsedJobs of the wrong type throws');
  else fail('bolt: a parsedJobs of the wrong type should throw');
  if (throwsWith(() => parsePositions(page([{ id: 1 }, { header: {} }, null])), /none parsed/)) pass('bolt: positions present but none parsed throws');
  else fail('bolt: positions present but none parsed should throw');

  // ── fetch() ──
  const makeCtx = (respond) => {
    const calls = [];
    const fetchText = async (url, opts = {}) => {
      // Every request, probe and retry included, must refuse redirects.
      if (opts.redirect !== 'error') throw new Error(`bolt request without redirect: 'error' (${url})`);
      calls.push({ url, opts });
      return respond(url, calls.length);
    };
    return { calls, ctx: { sleep: async () => {}, fetchText, fetchJson: async () => { throw new Error('bolt must not call fetchJson'); } } };
  };

  {
    const { ctx, calls } = makeCtx(() => page(rows));
    // A config-supplied URL, locale or host never decides where the request goes.
    const out = await provider.fetch({ name: 'Acme', careers_url: 'https://bolt.eu/et/careers/positions/?country=es' }, ctx);
    if (calls.length === 1 && calls[0].url === BASE) pass('bolt.fetch() issues one request, to the fixed positions page');
    else fail(`bolt requests = ${JSON.stringify(calls.map((x) => x.url))}`);
    if (calls.every((x) => x.opts.redirect === 'error')) pass('bolt.fetch() passes redirect: "error"');
    else fail('bolt.fetch() must pass redirect: "error"');
    if (out.length === 3) pass('bolt.fetch() returns the parsed inventory');
    else fail(`bolt.fetch() returned ${out.length}`);
  }

  // Probe: ctx.maxPages is set, still one list request, and a rejection propagates unwrapped.
  {
    const { ctx, calls } = makeCtx(() => page(rows));
    await provider.fetch({ name: 'Acme' }, { ...ctx, maxPages: 1 });
    if (calls.length === 1) pass('bolt.fetch() makes exactly one request under ctx.maxPages: 1');
    else fail(`bolt made ${calls.length} requests under the probe`);

    const sentinel = new Error('budget reached');
    const { ctx: rejecting } = makeCtx(() => { throw sentinel; });
    let caught;
    try { await provider.fetch({ name: 'Acme' }, { ...rejecting, maxPages: 1 }); } catch (err) { caught = err; }
    if (caught === sentinel) pass('bolt.fetch() propagates a ctx.fetchText rejection unwrapped under a probe');
    else fail(`bolt wrapped or swallowed the rejection: ${caught?.message}`);
  }

  // A transient 503 is retried through the shared helper; a 403 is a loud failure, not retried.
  {
    let n = 0;
    const { ctx } = makeCtx(() => {
      n++;
      if (n === 1) { const e = new Error('HTTP 503'); e.status = 503; throw e; }
      return page(rows);
    });
    const out = await provider.fetch({ name: 'Acme' }, ctx);
    if (n === 2 && out.length === 3) pass('bolt.fetch() retries a transient 503 through fetchTextWithRetry');
    else fail(`bolt retry: ${n} calls, ${out.length} jobs`);

    let calls403 = 0;
    const { ctx: blocked } = makeCtx(() => { calls403++; const e = new Error('HTTP 403'); e.status = 403; throw e; });
    let err403;
    try { await provider.fetch({ name: 'Acme' }, blocked); } catch (err) { err403 = err; }
    if (calls403 === 1 && err403?.status === 403) pass('bolt.fetch() lets a 403 through as a named failure, with no retry');
    else fail(`bolt 403: ${calls403} calls, ${err403?.message}`);
  }

  // The same position reached at a second URL is one listing (listingIdentity dedup).
  {
    const { isOfferSeen, markOfferSeen } = await import(pathToFileURL(join(ROOT, 'scan.mjs')).href);
    const [row] = parsePositions(page([position(ID_A, 'Operations Lead', [])]));
    const moved = { ...row, url: `https://bolt.eu/et/careers/positions/${ID_A}/` };
    const seen = new Set();
    markOfferSeen(row, seen);
    if (isOfferSeen(moved, seen)) pass('bolt: the same position under another locale URL is already seen');
    else fail('bolt: same position id at a second URL should be one listing');
  }
} catch (err) {
  fail(`bolt test crashed: ${err.stack || err.message}`);
}
