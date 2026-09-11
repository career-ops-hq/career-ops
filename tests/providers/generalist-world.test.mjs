// tests/providers/generalist-world.test.mjs — Generalist World board provider
// (server-rendered HTML at generalist.world/jobs/, one plain GET, no
// pagination). Fixtures use fictional employers only. Follows the
// discovered-test layout from #1440.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const LIST_URL = 'https://generalist.world/jobs/';

console.log('\nProvider — generalist-world (generalist.world/jobs/ HTML board)');
try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/generalist-world.mjs')).href);
  const gw = mod.default;
  const { parseGeneralistWorldJobs, normalizeGeneralistWorldCard, resolveGeneralistWorldUrl } = mod;
  const { resolveProvider } = await import(pathToFileURL(join(ROOT, 'providers/_registry.mjs')).href);
  const { decodeEntities } = await import(pathToFileURL(join(ROOT, 'providers/_html-entities.mjs')).href);

  if (gw.id === 'generalist-world') pass('generalist-world.id is "generalist-world"');
  else fail(`generalist-world.id is ${JSON.stringify(gw.id)}`);

  // ---- detect() -----------------------------------------------------------
  const explicit = gw.detect({ name: 'Generalist World', provider: 'generalist-world' });
  if (explicit && explicit.url === LIST_URL) pass('detect() claims entries with provider: generalist-world (no careers_url needed)');
  else fail(`detect() on an explicit entry returned ${JSON.stringify(explicit)}`);

  if (gw.detect({ name: 'X', provider: 'remoteok', careers_url: LIST_URL }) === null) {
    pass('detect() defers to another explicit provider even when careers_url is on generalist.world');
  } else {
    fail('detect() should return null when a different provider: is set');
  }

  for (const url of [LIST_URL, 'https://www.generalist.world/jobs/', 'https://generalist.world/jobs']) {
    const hit = gw.detect({ name: 'X', careers_url: url });
    if (hit && hit.url === LIST_URL) pass(`detect() auto-detects careers_url ${url} and always resolves to the list URL`);
    else fail(`detect() on careers_url ${url} returned ${JSON.stringify(hit)}`);
  }

  const apiHit = gw.detect({ name: 'X', api: 'https://generalist.world/jobs/' });
  if (apiHit && apiHit.url === LIST_URL) pass('detect() also accepts the host in the api: field');
  else fail(`detect() on api: returned ${JSON.stringify(apiHit)}`);

  const misses = [
    ['http://generalist.world/jobs/', 'plain-http careers_url'],
    ['https://evil.example/generalist.world/jobs/', 'host in the path of another origin'],
    ['https://generalist.world.evil.example/jobs/', 'look-alike subdomain of another origin'],
    ['https://generalist.world@evil.example/jobs/', 'host as userinfo of another origin'],
    ['not a url', 'unparseable careers_url'],
    [null, 'null careers_url'],
    [42, 'numeric careers_url'],
  ];
  for (const [url, label] of misses) {
    let out;
    try { out = gw.detect({ name: 'X', careers_url: url }); } catch (e) { out = `threw ${e.message}`; }
    if (out === null) pass(`detect() returns null for ${label}`);
    else fail(`detect() for ${label} returned ${JSON.stringify(out)}`);
  }
  for (const [entry, label] of [[{}, 'an entry with no URL fields'], [null, 'a null entry'], [undefined, 'an undefined entry']]) {
    let out;
    try { out = gw.detect(entry); } catch (e) { out = `threw ${e.message}`; }
    if (out === null) pass(`detect() returns null (does not throw) for ${label}`);
    else fail(`detect() for ${label} returned ${JSON.stringify(out)}`);
  }

  // ---- registry dispatch --------------------------------------------------
  const providers = new Map([['generalist-world', gw]]);
  const viaExplicit = resolveProvider({ name: 'Generalist World', provider: 'generalist-world' }, providers);
  if (viaExplicit.provider === gw) pass('resolveProvider() dispatches provider: generalist-world to the module');
  else fail(`resolveProvider() on the explicit entry returned ${JSON.stringify(viaExplicit)}`);
  const viaUrl = resolveProvider({ name: 'Generalist World', careers_url: LIST_URL }, providers);
  if (viaUrl.provider === gw) pass('resolveProvider() dispatches a generalist.world careers_url to the module');
  else fail(`resolveProvider() on the careers_url entry returned ${JSON.stringify(viaUrl)}`);

  // ---- resolveGeneralistWorldUrl() ---------------------------------------
  const urlCases = [
    ['/jobs/chief-of-staff-exampleco/', 'https://generalist.world/jobs/chief-of-staff-exampleco/'],
    ['/jobs/chief-of-staff-exampleco', 'https://generalist.world/jobs/chief-of-staff-exampleco/'],
    ['https://generalist.world/jobs/ops-lead-acme/', 'https://generalist.world/jobs/ops-lead-acme/'],
    ['https://www.generalist.world/jobs/ops-lead-acme/', 'https://generalist.world/jobs/ops-lead-acme/'],
    ['  /jobs/padded-slug/  ', 'https://generalist.world/jobs/padded-slug/'],
    ['https://evil.example/jobs/x/', null],
    ['http://generalist.world/jobs/x/', null],
    ['//evil.example/jobs/x/', null],
    ['/jobs/../wp-admin/', null],
    ['/jobs/x/y/', null],
    ['/jobs/x/?utm=1', null],
    ['https://generalist.world/jobs/x/?utm=1', null],
    ['https://generalist.world/jobs/x/#top', null],
    ['/jobs/x%2F../', null],
    ['/jobs/', null],
    ['/about/', null],
    ['javascript:alert(1)', null],
    ['', null],
    [undefined, null],
  ];
  for (const [href, want] of urlCases) {
    const got = resolveGeneralistWorldUrl(href);
    if (got === want) pass(`resolveGeneralistWorldUrl(${JSON.stringify(href)}) → ${JSON.stringify(want)}`);
    else fail(`resolveGeneralistWorldUrl(${JSON.stringify(href)}) returned ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }

  // ---- normalizeGeneralistWorldCard() ------------------------------------
  const card = (attrs, inner) => `<a class="gw-job-card" ${attrs}>${inner}</a>`;
  const full = card(
    'data-type="connector" data-region="uk" href="/jobs/ops-finance-lead-exampleco/"',
    `<div class="gw-job-card-top"><div class="gw-job-company">Example &amp; Co</div></div>
     <div class="gw-job-title">Ops &amp; Finance Lead &#8211; Founder&#x27;s Office</div>
     <p class="gw-job-description">Run the <strong>back office</strong> of a 12-person team.<br>Hybrid.</p>
     <div class="gw-job-meta"><span class="gw-job-meta-tag gw-salary">£70k&#8211;£85k</span>
     <span class="gw-job-meta-tag gw-location">London (in office)</span></div>`,
  );
  const job = normalizeGeneralistWorldCard(full);
  const wantFull = {
    title: "Ops & Finance Lead – Founder's Office",
    url: 'https://generalist.world/jobs/ops-finance-lead-exampleco/',
    company: 'Example & Co',
    location: 'London (in office)',
    description: 'Run the back office of a 12-person team. Hybrid.',
  };
  if (JSON.stringify(job) === JSON.stringify(wantFull)) {
    pass('normalizeGeneralistWorldCard() maps title / url / company / location / description and decodes entities');
  } else {
    fail(`normalizeGeneralistWorldCard() full card returned ${JSON.stringify(job)}`);
  }
  if (job && !('salary' in job) && !('postedAt' in job)) pass('normalizeGeneralistWorldCard() never attaches salary or postedAt (free-text salary tag, no list-level date)');
  else fail('normalizeGeneralistWorldCard() must not attach salary or postedAt');

  const minimal = normalizeGeneralistWorldCard(card('data-region="remote" href="/jobs/founders-associate-acme/"',
    '<div class="gw-job-title">Founder\'s Associate</div>'));
  if (minimal && minimal.company === '' && minimal.location === 'Remote' && !('description' in minimal)) {
    pass('normalizeGeneralistWorldCard() falls back to data-region for location, empty company, and omits description when absent');
  } else {
    fail(`normalizeGeneralistWorldCard() minimal card returned ${JSON.stringify(minimal)}`);
  }
  const regionOnly = normalizeGeneralistWorldCard(card('data-region="eu" href="/jobs/x-acme/"', '<div class="gw-job-title">Ops Lead</div>'));
  if (regionOnly && regionOnly.location === 'EU') pass('normalizeGeneralistWorldCard() upper-cases a non-remote data-region (eu → EU)');
  else fail(`normalizeGeneralistWorldCard() region-only card returned ${JSON.stringify(regionOnly)}`);
  const noRegion = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', '<div class="gw-job-title">Ops Lead</div>'));
  if (noRegion && noRegion.location === '') pass('normalizeGeneralistWorldCard() yields an empty location when neither tag nor data-region is present');
  else fail(`normalizeGeneralistWorldCard() no-region card returned ${JSON.stringify(noRegion)}`);

  const titleless = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', '<div class="gw-job-company">Acme</div>'));
  if (titleless === null) pass('normalizeGeneralistWorldCard() drops a card with no title');
  else fail(`normalizeGeneralistWorldCard() title-less card returned ${JSON.stringify(titleless)}`);
  const blankTitle = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', '<div class="gw-job-title"> &nbsp; </div>'));
  if (blankTitle === null) pass('normalizeGeneralistWorldCard() drops a card whose title is whitespace / nbsp only');
  else fail(`normalizeGeneralistWorldCard() blank-title card returned ${JSON.stringify(blankTitle)}`);

  for (const href of ['https://evil.example/jobs/x/', '/jobs/../wp-admin/', '/jobs/x/?y=1', '/about/', 'javascript:alert(1)']) {
    const bad = normalizeGeneralistWorldCard(card(`href="${href}"`, '<div class="gw-job-title">Ops Lead</div>'));
    if (bad === null) pass(`normalizeGeneralistWorldCard() drops a card whose href is ${href}`);
    else fail(`normalizeGeneralistWorldCard() accepted href ${href}: ${JSON.stringify(bad)}`);
  }
  const noHref = normalizeGeneralistWorldCard(card('data-region="us"', '<div class="gw-job-title">Ops Lead</div>'));
  if (noHref === null) pass('normalizeGeneralistWorldCard() drops a card with no href');
  else fail(`normalizeGeneralistWorldCard() href-less card returned ${JSON.stringify(noHref)}`);

  const notCard = normalizeGeneralistWorldCard('<a class="gw-job-card-top" href="/jobs/x-acme/"><div class="gw-job-title">Ops Lead</div></a>');
  if (notCard === null) pass('normalizeGeneralistWorldCard() requires the whole gw-job-card class token (gw-job-card-top is not a card)');
  else fail(`normalizeGeneralistWorldCard() accepted a non-card anchor: ${JSON.stringify(notCard)}`);
  const multiClass = normalizeGeneralistWorldCard('<a class="featured gw-job-card is-new" href="/jobs/x-acme/"><div class="gw-job-title">Ops Lead</div></a>');
  if (multiClass && multiClass.title === 'Ops Lead') pass('normalizeGeneralistWorldCard() matches gw-job-card anywhere in the class list');
  else fail(`normalizeGeneralistWorldCard() multi-class card returned ${JSON.stringify(multiClass)}`);

  for (const [input, label] of [[null, 'null'], [42, 'a number'], ['', 'an empty string'], ['<div>no card</div>', 'unrelated markup']]) {
    let out;
    try { out = normalizeGeneralistWorldCard(input); } catch (e) { out = `threw ${e.message}`; }
    if (out === null) pass(`normalizeGeneralistWorldCard() returns null for ${label}`);
    else fail(`normalizeGeneralistWorldCard() for ${label} returned ${JSON.stringify(out)}`);
  }

  // Entity handling goes through the shared decoder (rss-entity-decoding.test
  // guards the source); check the provider agrees with it on an odd input.
  const nulTitle = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', '<div class="gw-job-title">A&#0;B &amp;amp; C</div>'));
  const wantNul = decodeEntities(decodeEntities('A&#0;B &amp;amp; C')).replace(/\s+/g, ' ').trim();
  if (nulTitle && nulTitle.title === wantNul) pass('normalizeGeneralistWorldCard() title decoding agrees with the shared decodeEntities() helper (incl. &#0; and double-encoding)');
  else fail(`normalizeGeneralistWorldCard() title decoded to ${JSON.stringify(nulTitle && nulTitle.title)}, shared helper gives ${JSON.stringify(wantNul)}`);

  // ---- parseGeneralistWorldJobs() ----------------------------------------
  const page = (cards) => `<!doctype html><html><body>
    <section class="gw-featured-section"><div class="gw-featured-grid">${cards.featured || ''}</div></section>
    <div class="gw-jobs-section" data-jobs-container><div class="gw-jobs-grid">${cards.main || ''}</div></div>
    </body></html>`;
  const c1 = card('data-region="remote" href="/jobs/chief-of-staff-exampleco/"',
    '<div class="gw-job-company">ExampleCo</div><div class="gw-job-title">Chief of Staff</div><p class="gw-job-description">Teaser one.</p>');
  const c2 = card('data-region="us" href="/jobs/ops-lead-acme/"',
    '<div class="gw-job-company">Acme</div><div class="gw-job-title">Ops Lead</div><span class="gw-job-meta-tag gw-location">Austin, TX</span>');
  const c3 = card('data-region="eu" href="/jobs/broken-acme/"', '<div class="gw-job-company">Acme</div>'); // no title
  const jobs = parseGeneralistWorldJobs(page({ featured: c1, main: c1 + c2 + c3 }));
  if (jobs.length === 2 && jobs[0].url.endsWith('/chief-of-staff-exampleco/') && jobs[1].url.endsWith('/ops-lead-acme/')) {
    pass('parseGeneralistWorldJobs() reads featured + main cards, dedups the repeated URL, and skips the title-less card (3 cards + 1 repeat → 2 jobs)');
  } else {
    fail(`parseGeneralistWorldJobs() fixture returned ${JSON.stringify(jobs)}`);
  }
  if (jobs.length === 2 && jobs[0].location === 'Remote' && jobs[0].description === 'Teaser one.' && jobs[1].location === 'Austin, TX' && !('description' in jobs[1])) {
    pass('parseGeneralistWorldJobs() keeps per-card fields intact (region fallback on one, explicit location on the other)');
  } else {
    fail(`parseGeneralistWorldJobs() field check failed: ${JSON.stringify(jobs)}`);
  }

  for (const [input, label] of [['', 'an empty body'], ['   \n ', 'a whitespace-only body'], [null, 'a null body'], [page({}), 'a page with the listing container but zero cards']]) {
    let out;
    try { out = parseGeneralistWorldJobs(input); } catch (e) { out = `threw ${e.message}`; }
    if (Array.isArray(out) && out.length === 0) pass(`parseGeneralistWorldJobs() returns [] for ${label}`);
    else fail(`parseGeneralistWorldJobs() for ${label} returned ${JSON.stringify(out)}`);
  }

  let structureThrew = false;
  try {
    parseGeneralistWorldJobs('<html><body><h1>Just a moment...</h1><div class="jobs"><a href="/jobs/x/">Ops Lead</a></div></body></html>');
  } catch (e) {
    if (e instanceof Error && e.message.includes('page structure likely changed')) structureThrew = true;
    else throw e;
  }
  if (structureThrew) pass('parseGeneralistWorldJobs() throws a descriptive error on a non-empty page with no cards and no listing container');
  else fail('parseGeneralistWorldJobs() should throw when the page has neither cards nor the listing container');

  // ---- fetch() ------------------------------------------------------------
  const calls = [];
  const mkCtx = (body) => ({
    fetchText: async (url, opts) => { calls.push({ url, opts }); return body; },
    fetchJson: async () => { throw new Error('fetchJson must not be used'); },
    fetchResponse: async () => { throw new Error('fetchResponse must not be used'); },
    sleep: async () => {},
  });
  const fetched = await gw.fetch({ name: 'Generalist World', provider: 'generalist-world' }, mkCtx(page({ main: c1 + c2 })));
  if (fetched.length === 2 && calls.length === 1 && calls[0].url === LIST_URL) pass('fetch() makes exactly one request, to the list URL, and returns the parsed jobs');
  else fail(`fetch() made ${calls.length} call(s) ${JSON.stringify(calls.map((c) => c.url))} and returned ${fetched.length} job(s)`);
  if (calls[0] && calls[0].opts && calls[0].opts.redirect === 'error') pass('fetch() passes redirect: "error" (SSRF / off-host redirect guard)');
  else fail(`fetch() request opts were ${JSON.stringify(calls[0] && calls[0].opts)}`);

  calls.length = 0;
  await gw.fetch({ name: 'X', careers_url: 'https://evil.example/jobs/', provider: 'generalist-world' }, mkCtx(page({ main: c1 })));
  if (calls.length === 1 && calls[0].url === LIST_URL) pass('fetch() ignores careers_url entirely: a config-supplied URL never reaches the network');
  else fail(`fetch() with a foreign careers_url requested ${JSON.stringify(calls.map((c) => c.url))}`);

  const empty = await gw.fetch({ name: 'X', provider: 'generalist-world' }, mkCtx(''));
  if (Array.isArray(empty) && empty.length === 0) pass('fetch() returns [] on an empty response body');
  else fail(`fetch() on an empty body returned ${JSON.stringify(empty)}`);

  let fetchThrew = false;
  try {
    await gw.fetch({ name: 'X', provider: 'generalist-world' }, mkCtx('<html><body><p>Access denied</p></body></html>'));
  } catch (e) {
    if (e instanceof Error && e.message.includes('page structure likely changed')) fetchThrew = true;
    else throw e;
  }
  if (fetchThrew) pass('fetch() surfaces the structure-changed error instead of reporting an empty board');
  else fail('fetch() should throw when the response is neither empty nor the known page');
} catch (e) {
  fail(`generalist-world provider tests crashed: ${e.message}`);
}
