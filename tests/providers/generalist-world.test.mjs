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

  const ACME = '<div class="gw-job-company">Acme</div>';
  const minimal = normalizeGeneralistWorldCard(card('data-region="remote" href="/jobs/founders-associate-acme/"',
    `${ACME}<div class="gw-job-title">Founder\'s Associate</div>`));
  if (minimal && minimal.company === 'Acme' && minimal.location === 'Remote' && !('description' in minimal)) {
    pass('normalizeGeneralistWorldCard() falls back to data-region for location and omits description when absent');
  } else {
    fail(`normalizeGeneralistWorldCard() minimal card returned ${JSON.stringify(minimal)}`);
  }
  const regionOnly = normalizeGeneralistWorldCard(card('data-region="eu" href="/jobs/x-acme/"', `${ACME}<div class="gw-job-title">Ops Lead</div>`));
  if (regionOnly && regionOnly.location === 'EU') pass('normalizeGeneralistWorldCard() upper-cases a non-remote data-region (eu → EU)');
  else fail(`normalizeGeneralistWorldCard() region-only card returned ${JSON.stringify(regionOnly)}`);
  const noRegion = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', `${ACME}<div class="gw-job-title">Ops Lead</div>`));
  if (noRegion && noRegion.location === '') pass('normalizeGeneralistWorldCard() yields an empty location when neither tag nor data-region is present');
  else fail(`normalizeGeneralistWorldCard() no-region card returned ${JSON.stringify(noRegion)}`);

  const titleless = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', ACME));
  if (titleless === null) pass('normalizeGeneralistWorldCard() drops a card with no title');
  else fail(`normalizeGeneralistWorldCard() title-less card returned ${JSON.stringify(titleless)}`);
  const blankTitle = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', `${ACME}<div class="gw-job-title"> &nbsp; </div>`));
  if (blankTitle === null) pass('normalizeGeneralistWorldCard() drops a card whose title is whitespace / nbsp only');
  else fail(`normalizeGeneralistWorldCard() blank-title card returned ${JSON.stringify(blankTitle)}`);
  const companyless = normalizeGeneralistWorldCard(card('data-region="us" href="/jobs/x-acme/"', '<div class="gw-job-title">Ops Lead</div>'));
  if (companyless === null) pass('normalizeGeneralistWorldCard() drops a card with no employer (listings must be attributed to an identifiable employer)');
  else fail(`normalizeGeneralistWorldCard() company-less card returned ${JSON.stringify(companyless)}`);
  const blankCompany = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', '<div class="gw-job-company"> &nbsp; </div><div class="gw-job-title">Ops Lead</div>'));
  if (blankCompany === null) pass('normalizeGeneralistWorldCard() drops a card whose employer is whitespace / nbsp only');
  else fail(`normalizeGeneralistWorldCard() blank-company card returned ${JSON.stringify(blankCompany)}`);

  for (const href of ['https://evil.example/jobs/x/', '/jobs/../wp-admin/', '/jobs/x/?y=1', '/about/', 'javascript:alert(1)']) {
    const bad = normalizeGeneralistWorldCard(card(`href="${href}"`, `${ACME}<div class="gw-job-title">Ops Lead</div>`));
    if (bad === null) pass(`normalizeGeneralistWorldCard() drops a card whose href is ${href}`);
    else fail(`normalizeGeneralistWorldCard() accepted href ${href}: ${JSON.stringify(bad)}`);
  }
  const noHref = normalizeGeneralistWorldCard(card('data-region="us"', `${ACME}<div class="gw-job-title">Ops Lead</div>`));
  if (noHref === null) pass('normalizeGeneralistWorldCard() drops a card with no href');
  else fail(`normalizeGeneralistWorldCard() href-less card returned ${JSON.stringify(noHref)}`);

  // Attribute names must be whole: data-class= / data-href= / data-data-region=
  // are not class= / href= / data-region=.
  const prefixedAttrs = normalizeGeneralistWorldCard(`<a data-class="gw-job-card" data-href="/jobs/x-acme/">${ACME}<div class="gw-job-title">Ops Lead</div></a>`);
  if (prefixedAttrs === null) pass('normalizeGeneralistWorldCard() ignores an anchor whose only class/href are data-class= / data-href= (whole attribute names)');
  else fail(`normalizeGeneralistWorldCard() accepted a data-class/data-href anchor: ${JSON.stringify(prefixedAttrs)}`);
  const dataHrefOnly = normalizeGeneralistWorldCard(card('data-href="/jobs/x-acme/"', `${ACME}<div class="gw-job-title">Ops Lead</div>`));
  if (dataHrefOnly === null) pass('normalizeGeneralistWorldCard() does not read data-href= as href=');
  else fail(`normalizeGeneralistWorldCard() accepted data-href as href: ${JSON.stringify(dataHrefOnly)}`);
  const prefixedRegion = normalizeGeneralistWorldCard(card('data-data-region="remote" href="/jobs/x-acme/"', `${ACME}<div class="gw-job-title">Ops Lead</div>`));
  if (prefixedRegion && prefixedRegion.location === '') pass('normalizeGeneralistWorldCard() does not read data-data-region= as data-region=');
  else fail(`normalizeGeneralistWorldCard() prefixed-region card returned ${JSON.stringify(prefixedRegion)}`);
  const prefixedInner = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', `${ACME}<div data-class="gw-job-title">Not a title</div><div class="gw-job-title">Ops Lead</div>`));
  if (prefixedInner && prefixedInner.title === 'Ops Lead') pass('normalizeGeneralistWorldCard() skips a data-class="gw-job-title" element and reads the real title');
  else fail(`normalizeGeneralistWorldCard() prefixed-inner card returned ${JSON.stringify(prefixedInner)}`);

  const notCard = normalizeGeneralistWorldCard(`<a class="gw-job-card-top" href="/jobs/x-acme/">${ACME}<div class="gw-job-title">Ops Lead</div></a>`);
  if (notCard === null) pass('normalizeGeneralistWorldCard() requires the whole gw-job-card class token (gw-job-card-top is not a card)');
  else fail(`normalizeGeneralistWorldCard() accepted a non-card anchor: ${JSON.stringify(notCard)}`);
  const multiClass = normalizeGeneralistWorldCard(`<a class="featured gw-job-card is-new" href="/jobs/x-acme/">${ACME}<div class="gw-job-title">Ops Lead</div></a>`);
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
  const nulTitle = normalizeGeneralistWorldCard(card('href="/jobs/x-acme/"', `${ACME}<div class="gw-job-title">A&#0;B &amp;amp; C</div>`));
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
  const c4 = card('data-region="eu" href="/jobs/orphan-role/"', '<div class="gw-job-title">Ops Lead</div>'); // no employer
  const jobs = parseGeneralistWorldJobs(page({ featured: c1, main: c1 + c2 + c3 + c4 }));
  if (jobs.length === 2 && jobs[0].url.endsWith('/chief-of-staff-exampleco/') && jobs[1].url.endsWith('/ops-lead-acme/')) {
    pass('parseGeneralistWorldJobs() reads featured + main cards, dedups the repeated URL, and skips the title-less and employer-less cards (4 cards + 1 repeat → 2 jobs)');
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

  // The container marker has to be a real opening tag, not the words in text,
  // CSS or script: those pages are not the board and must still throw.
  const nearMisses = [
    ['<html><body>gw-jobs-section data-jobs-container</body></html>', 'marker words in body text'],
    ['<html><head><style>.gw-jobs-section{display:grid} [data-jobs-container]{gap:1rem}</style></head><body><p>Maintenance</p></body></html>', 'marker words in CSS only'],
    ['<html><body><script>var sel = ".gw-jobs-section"; var attr = "data-jobs-container";</script></body></html>', 'marker words in script only'],
    ['<html><body><div class="gw-jobs-section-legacy"></div><div data-jobs-container-old></div></body></html>', 'prefixed look-alike class / attribute'],
    ['<html><body><div data-class="gw-jobs-section"></div></body></html>', 'data-class= instead of class='],
  ];
  for (const [html, label] of nearMisses) {
    let threw = false;
    try { parseGeneralistWorldJobs(html); } catch (e) {
      if (e instanceof Error && e.message.includes('page structure likely changed')) threw = true;
      else throw e;
    }
    if (threw) pass(`parseGeneralistWorldJobs() still throws when the container marker appears only as ${label}`);
    else fail(`parseGeneralistWorldJobs() treated ${label} as an empty board`);
  }
  // Non-rendered blocks are dropped before either match: a card literal in a
  // script template, a comment or a textarea is not a job, and a container
  // tag that only appears there does not make the page an empty board.
  const cardLiteral = c1.replace('chief-of-staff-exampleco', 'ghost-exampleco');
  const nonRenderedCards = parseGeneralistWorldJobs(page({
    main: `<script type="text/template">${cardLiteral}</script><!-- ${cardLiteral} --><textarea>${cardLiteral}</textarea>`
      + `<style>.x::before{content:'${cardLiteral}'}</style>` + c1,
  }));
  if (nonRenderedCards.length === 1 && nonRenderedCards[0].url.endsWith('/chief-of-staff-exampleco/')) {
    pass('parseGeneralistWorldJobs() ignores card literals inside script / comment / textarea / style and keeps the rendered card');
  } else {
    fail(`parseGeneralistWorldJobs() non-rendered card fixture returned ${JSON.stringify(nonRenderedCards.map((j) => j.url))}`);
  }
  const ghost2 = c1.replace('chief-of-staff-exampleco', 'ghost-two-exampleco');
  const templated = parseGeneralistWorldJobs(page({
    main: `<template id="card-tpl">${cardLiteral}</template>`
      + `<TEMPLATE><template>${ghost2}</template>${cardLiteral}</TEMPLATE>`
      + `</template>` + c1 + `<template>${ghost2}`,
  }));
  if (templated.length === 1 && templated[0].url.endsWith('/chief-of-staff-exampleco/')) {
    pass('parseGeneralistWorldJobs() ignores card literals inside <template>, nested templates, a stray </template>, and an unclosed trailing template');
  } else {
    fail(`parseGeneralistWorldJobs() template fixture returned ${JSON.stringify(templated.map((j) => j.url))}`);
  }
  // Markers inside quoted attribute values are attribute text, not tags: a
  // quoted opener must not swallow the cards that follow it and a quoted
  // closer must not expose the inert content around it.
  const quotedMarkers = [
    [`<div data-copy="<template>"></div>${c1}`, 'a quoted <template> opener before the card'],
    [`<div data-copy="<script>"></div>${c1}<script>track()</script>`, 'a quoted <script> opener before the card and a real script after it'],
    [`<div data-copy="<!--"></div>${c1}<!-- footer -->`, 'a quoted comment opener before the card and a real comment after it'],
    [`<template><div data-copy="</template>"></div>${cardLiteral}</template>${c1}`, 'a quoted </template> closer inside a template'],
    [`<template data-x="a>b">${cardLiteral}</template>${c1}`, 'a > inside a template opener attribute'],
    [`<script data-x="a>b">${cardLiteral}</script>${c1}`, 'a > inside a script opener attribute'],
    [`<script>var s = "</template>";</script><template>${cardLiteral}</template>${c1}`, 'a </template> literal inside a script string'],
  ];
  for (const [main, label] of quotedMarkers) {
    const got = parseGeneralistWorldJobs(page({ main }));
    if (got.length === 1 && got[0].url.endsWith('/chief-of-staff-exampleco/')) {
      pass(`parseGeneralistWorldJobs() keeps exactly the rendered card with ${label}`);
    } else {
      fail(`parseGeneralistWorldJobs() with ${label} returned ${JSON.stringify(got.map((j) => j.url))}`);
    }
  }
  const container = '<div class="gw-jobs-section" data-jobs-container></div>';
  const quotedOpenerBoard = parseGeneralistWorldJobs(`<html><body><div data-copy="<template>"></div>${container}</body></html>`);
  if (Array.isArray(quotedOpenerBoard) && quotedOpenerBoard.length === 0) {
    pass('parseGeneralistWorldJobs() still sees the empty board when a quoted <template> opener precedes the container');
  } else {
    fail(`parseGeneralistWorldJobs() quoted-opener board returned ${JSON.stringify(quotedOpenerBoard)}`);
  }
  const hiddenContainers = [
    [`<html><body><template data-x="a>b">${container}</template><p>Maintenance</p></body></html>`, 'a <template> whose opener carries a quoted >'],
    [`<html><body><template>${container}</template><p>Maintenance</p></body></html>`, 'a <template>'],
    [`<html><body><template><div><template>${container}</template></div>${container}</template><p>Maintenance</p></body></html>`, 'nested <template>s'],
    [`<html><body><script>document.body.innerHTML = '${container}';</script><p>Maintenance</p></body></html>`, 'a script string'],
    [`<html><body><!-- ${container} --><p>Maintenance</p></body></html>`, 'an HTML comment'],
    [`<html><head><style>.x::after{content:'${container}'}</style></head><body><p>Maintenance</p></body></html>`, 'a CSS content string'],
    [`<html><body><textarea>${container}</textarea></body></html>`, 'a textarea'],
    [`<html><body><SCRIPT>var t = '${container}';</SCRIPT></body></html>`, 'an upper-case SCRIPT block'],
  ];
  for (const [html, label] of hiddenContainers) {
    let threw = false;
    try { parseGeneralistWorldJobs(html); } catch (e) {
      if (e instanceof Error && e.message.includes('page structure likely changed')) threw = true;
      else throw e;
    }
    if (threw) pass(`parseGeneralistWorldJobs() still throws when the container tag appears only inside ${label}`);
    else fail(`parseGeneralistWorldJobs() treated a container inside ${label} as an empty board`);
  }
  const attrOnly = parseGeneralistWorldJobs('<html><body><section data-jobs-container><p>No roles right now</p></section></body></html>');
  if (Array.isArray(attrOnly) && attrOnly.length === 0) pass('parseGeneralistWorldJobs() accepts a real <section data-jobs-container> tag with zero cards as an empty board');
  else fail(`parseGeneralistWorldJobs() attribute-only container returned ${JSON.stringify(attrOnly)}`);

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
