// tests/providers/viterbit.test.mjs — careers sites hosted on Viterbit, reached
// with an explicit `provider: viterbit` on the employer's own domain.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — viterbit');

const ORIGIN = 'https://careers.acme.example';

// The shape of a live home page, trimmed: one tab per posting with a title
// anchor and a few <p> facts, then the "no offers" block, which the real page
// carries even when it lists postings. Values are fictional.
const card = ({ href, title, place, age, extra = '' }) => `
<div data-value="${title}" class="tab-pane fade vb-jobs-tab active show col-lg-9" data-department="d1">
  <div class="kt-widget4 vb-jobs4"><div class="kt-widget4__item"><div class="kt-widget4__info">
    <a ${href === null ? '' : `href="${href}" `}class="kt-widget4__username vb-job-title">
      ${title}
    </a>
    <div style="display: flex">
      <p class="kt-widget4__text"><i class="la la-tag"></i> Operations</p>
      ${place === undefined ? '' : `<p class="kt-widget4__text ml-3"><i class="la la-map-marker"></i>
        ${place}
      </p>`}
      ${age === undefined ? '' : `<p class="kt-widget4__text ml-3"><i class="la la-clock-o"></i> ${age}</p>`}
      ${extra}
    </div>
  </div><a href="${href}" class="btn btn-bold vb-label-custom">Aplicar</a></div></div>
</div>`;
const page = (cards) => `<!DOCTYPE html><html><body>
<div id="list-jobs-container--jobs-mps-" data-pagination="10">${cards.join('')}</div>
<div id="jobs-pagination"><ul class="pagination kt-pagination__links"></ul></div>
<div class="text-left vb-jobs" id="empty-jobs"><div class="kt-widget4__item">No se han encontrado ofertas</div></div>
</body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/viterbit.mjs')).href);
  const provider = mod.default;
  const { parseViterbitBoard, parsePostedAt, resolveViterbitOrigin } = mod;

  if (provider.id === 'viterbit') pass('viterbit.id is "viterbit"');
  else fail(`viterbit.id is ${JSON.stringify(provider.id)}`);

  // Explicit-only: a custom domain is never claimed by pattern.
  if (provider.detect === undefined) pass('no detect(): the provider is reached only through an explicit provider: viterbit');
  else fail('viterbit defines detect(), which would claim entries by URL');

  if (resolveViterbitOrigin('https://careers.acme.example:8443/jobs?x=1') === ORIGIN) pass('resolveViterbitOrigin keeps only the hostname');
  else fail(`resolveViterbitOrigin = ${resolveViterbitOrigin('https://careers.acme.example:8443/jobs?x=1')}`);
  const badOrigins = ['http://careers.acme.example', 'not a url', '', null, 42, undefined];
  if (badOrigins.every((v) => resolveViterbitOrigin(v) === null)) pass('resolveViterbitOrigin returns null for http, malformed and non-string input');
  else fail('resolveViterbitOrigin accepted junk');

  // ── parsePostedAt ──
  const NOW = Date.UTC(2026, 10, 18, 15, 30);
  const day = (d) => Date.UTC(2026, 10, 18 - d);
  const ageCases = [
    ['hace 19 horas', day(1)], ['hace 2 horas', day(0)], ['hoy', day(0)], ['ayer', day(1)], ['hace 3 días', day(3)],
    ['hace 2 semanas', day(14)], ['hace 1 mes', day(30)], ['2 days ago', day(2)], ['hace un rato', undefined], ['', undefined],
  ];
  const ageBad = ageCases.filter(([t, want]) => parsePostedAt(t, NOW) !== want);
  if (ageBad.length === 0) pass('parsePostedAt turns an age in Spanish or English into the calendar day it implies, and omits what it cannot read');
  else fail(`parsePostedAt mismatches: ${ageBad.map(([t]) => t).join('; ')}`);

  // ── parseViterbitBoard ──
  const html = page([
    card({ href: '/ops-lead-AAAA11112222/', title: 'Ops &amp; Strategy Lead', place: 'Madrid\n (Híbrido)', age: 'hace 3 días',
      extra: '<p class="kt-widget4__text ml-3"><i class="flaticon-piggy-bank"></i> 25.000,00 € - 30.000,00 € (Anual)</p>' }),
    card({ href: '/data-analyst-BBBB11112222/', title: 'Data Analyst', place: 'Barcelona (Remoto)', age: 'hace 1 mes' }),
    card({ href: '/site-manager-CCCC11112222/', title: 'Site Manager', place: 'Sevilla (Presencial)', age: 'hoy' }),
    card({ href: '/support-DDDD11112222/', title: 'Support Engineer', place: 'España (Remoto)', age: 'ayer' }),
    card({ href: '/bare-EEEE11112222/', title: 'Bare Card' }),
    card({ href: '/ops-lead-AAAA11112222/', title: 'Ops &amp; Strategy Lead', place: 'Madrid (Híbrido)', age: 'hace 3 días' }),
    card({ href: 'https://other.example/foreign-FFFF/', title: 'Foreign Host', place: 'Madrid' }),
    card({ href: '/no-title-GGGG/', title: '' }),
  ]);
  const jobs = parseViterbitBoard(html, ORIGIN, 'Acme', NOW);
  // postedAt is checked against the fixed clock below, so only its presence is compared here.
  const norm = (js) => js.map(({ postedAt, ...r }) => ({ ...r, hasDate: postedAt !== undefined }));
  const want = [
    { title: 'Ops & Strategy Lead', url: `${ORIGIN}/ops-lead-AAAA11112222/`, company: 'Acme', location: 'Madrid', workplaceType: 'hybrid', locations: ['Madrid'], hasDate: true },
    { title: 'Data Analyst', url: `${ORIGIN}/data-analyst-BBBB11112222/`, company: 'Acme', location: 'Barcelona · Remote', workplaceType: 'remote', locations: ['Barcelona'], hasDate: true },
    { title: 'Site Manager', url: `${ORIGIN}/site-manager-CCCC11112222/`, company: 'Acme', location: 'Sevilla', workplaceType: 'onsite', locations: ['Sevilla'], hasDate: true },
    { title: 'Support Engineer', url: `${ORIGIN}/support-DDDD11112222/`, company: 'Acme', location: 'España · Remote', workplaceType: 'remote', locations: ['España'], hasDate: true },
    { title: 'Bare Card', url: `${ORIGIN}/bare-EEEE11112222/`, company: 'Acme', location: '', hasDate: false },
  ];
  if (JSON.stringify(norm(jobs)) === JSON.stringify(want)) {
    pass('parseViterbitBoard maps title (entities decoded), url, city, work model and date; one row per posting; a card with no facts keeps title and url');
  } else {
    fail(`parseViterbitBoard = ${JSON.stringify(norm(jobs))}`);
  }
  if (!jobs.some((j) => /Foreign Host/.test(j.title)) && jobs.every((j) => j.title && j.url.startsWith(`${ORIGIN}/`))) {
    pass('parseViterbitBoard drops cards with no title and links to another host');
  } else {
    fail(`parseViterbitBoard kept a card it should drop: ${JSON.stringify(jobs.map((j) => j.title))}`);
  }
  if (jobs[0].postedAt === day(3)) {
    pass('postedAt is the UTC midnight of the day the card\'s age implies');
  } else {
    fail(`postedAt = ${jobs[0].postedAt}`);
  }

  // Empty board vs changed markup vs not a Viterbit page.
  const empty = parseViterbitBoard(page([]), ORIGIN, 'Acme');
  if (Array.isArray(empty) && empty.length === 0) pass('a Viterbit page with the "no offers" block and no cards is an empty board → []');
  else fail(`empty board = ${JSON.stringify(empty)}`);

  let threw;
  try {
    parseViterbitBoard(page([card({ href: null, title: 'No Href' })]), ORIGIN, 'Acme');
  } catch (e) { threw = e; }
  if (threw && /job cards but none could be parsed/.test(threw.message)) pass('cards present but none readable throw (the markup changed), not an empty board');
  else fail(`changed markup did not throw descriptively: ${threw?.message ?? 'no throw'}`);

  // The "no offers" block is on populated pages too: a changed title class must not read as an empty board.
  threw = undefined;
  try {
    parseViterbitBoard(page([card({ href: '/ops-lead-AAAA11112222/', title: 'Ops Lead', place: 'Madrid' })]).replaceAll('vb-job-title', 'renamed-title').replaceAll('vb-label-custom', 'renamed-btn'), ORIGIN, 'Acme');
  } catch (e) { threw = e; }
  if (threw && /still carries job card markup/.test(threw.message)) pass('the "no offers" block does not hide cards whose title class changed: it throws');
  else fail(`renamed title class did not throw descriptively: ${threw?.message ?? 'no throw'}`);

  // A genuinely empty board, as the real page renders it: the list container, an inline CSS rule
  // naming the title class, and the "no offers" block that itself holds a vb-jobs-tab. Must stay [].
  const realEmpty = `<!DOCTYPE html><html><head><style>.vb-job-title:hover{color:#000}</style></head><body>
<div id="list-jobs-container--jobs-mps-" data-pagination="10"><div class="vb-jobs-tab col-lg-9"></div></div>
<div class="text-left vb-jobs mt-0 pt-0" id="empty-jobs"> <div class="tab-pane fadeIn vb-jobs-tab"> <div class="kt-widget4 vb-jobs4"> <div class="kt-widget4__item"> No se han encontrado ofertas </div></div></div></div>
</body></html>`;
  const realEmptyJobs = parseViterbitBoard(realEmpty, ORIGIN, 'Acme');
  if (Array.isArray(realEmptyJobs) && realEmptyJobs.length === 0) pass('an empty board as the real page renders it (container, inline CSS, no-offers block) is [], not a markup error');
  else fail(`real empty board = ${JSON.stringify(realEmptyJobs)}`);

  // A stylesheet or script that names the card-only classes is not a card: still an empty board.
  const cssEmpty = realEmpty.replace('</style>', '.kt-widget4__username{font-weight:500}.vb-label-custom{color:#000}</style><script>var s = ".kt-widget4__username";</script>');
  const cssEmptyJobs = parseViterbitBoard(cssEmpty, ORIGIN, 'Acme');
  if (Array.isArray(cssEmptyJobs) && cssEmptyJobs.length === 0) pass('card class names inside an inline <style> or <script> do not make an empty board throw');
  else fail(`empty board with card class names in CSS = ${JSON.stringify(cssEmptyJobs)}`);

  // A data attribute that merely ends in "class" is not a class attribute: still an empty board.
  const dataClassEmpty = realEmpty.replace('<div id="list-jobs-container', '<div data-class="kt-widget4__username" data-x-class="vb-label-custom" id="list-jobs-container');
  let dataClassJobs;
  try { dataClassJobs = parseViterbitBoard(dataClassEmpty, ORIGIN, 'Acme'); } catch (e) { dataClassJobs = e.message; }
  if (Array.isArray(dataClassJobs) && dataClassJobs.length === 0) pass('a data-class attribute naming a card class does not make an empty board throw');
  else fail(`empty board with data-class = ${JSON.stringify(dataClassJobs)}`);

  // Card classes count only as whole tokens: a prefixed class is another class.
  const prefixedEmpty = realEmpty.replace('<div id="list-jobs-container', '<div class="hover:vb-label-custom md:kt-widget4__username x" id="list-jobs-container');
  let prefixedJobs;
  try { prefixedJobs = parseViterbitBoard(prefixedEmpty, ORIGIN, 'Acme'); } catch (e) { prefixedJobs = e.message; }
  if (Array.isArray(prefixedJobs) && prefixedJobs.length === 0) pass('a class that only contains a card class name (hover:vb-label-custom) does not make an empty board throw');
  else fail(`empty board with prefixed classes = ${JSON.stringify(prefixedJobs)}`);

  // A whole card class token still counts, quoted or not, next to other classes.
  for (const attr of ['class="btn vb-label-custom"', "class='kt-widget4__username x'", 'class=vb-label-custom']) {
    threw = undefined;
    try { parseViterbitBoard(realEmpty.replace('<div id="list-jobs-container', `<a href="#" ${attr}>x</a><div id="list-jobs-container`), ORIGIN, 'Acme'); } catch (e) { threw = e; }
    if (threw && /still carries job card markup/.test(threw.message)) pass(`a card class as a whole token (${attr}) next to the "no offers" block throws`);
    else fail(`whole card class token (${attr}) did not throw: ${threw?.message ?? 'no throw'}`);
  }

  // A card whose link is blank is not a posting.
  threw = undefined;
  try {
    parseViterbitBoard(page([card({ href: '', title: 'Blank Link' })]), ORIGIN, 'Acme');
  } catch (e) { threw = e; }
  if (threw && /job cards but none could be parsed/.test(threw.message)) pass('a card with a blank href is dropped (a board of only those throws)');
  else fail(`blank href was not dropped: ${threw?.message ?? 'no throw'}`);

  threw = undefined;
  try {
    parseViterbitBoard('<html><body><h1>Careers</h1></body></html>', ORIGIN, 'Acme');
  } catch (e) { threw = e; }
  if (threw && /not a Viterbit careers site/.test(threw.message)) pass('a page with neither cards nor the "no offers" block throws instead of reading as empty');
  else fail(`non-Viterbit page did not throw descriptively: ${threw?.message ?? 'no throw'}`);

  // ── fetch() ──
  const seen = [];
  const ctx = { fetchText: async (url, opts) => { seen.push({ url, opts }); return html; } };
  const fetched = await provider.fetch({ name: 'Acme', careers_url: 'https://careers.acme.example/jobs?x=1' }, ctx);
  if (seen.length === 1 && seen[0].url === `${ORIGIN}/` && seen[0].opts?.redirect === 'error' && fetched.length === 5) {
    pass('fetch() makes one request to the rebuilt origin with redirect: "error"');
  } else {
    fail(`fetch() calls = ${JSON.stringify(seen)}, jobs = ${fetched.length}`);
  }

  let entered = 0;
  let refusedErr;
  try {
    await provider.fetch({ name: 'Acme', careers_url: 'http://careers.acme.example' }, { fetchText: async () => { entered += 1; return ''; } });
  } catch (e) { refusedErr = e; }
  if (refusedErr && entered === 0) pass('fetch() refuses a non-https or missing careers_url before any request');
  else fail(`fetch() on http: entered=${entered}, error=${refusedErr?.message}`);

  // A transient 5xx is retried through the shared helper.
  let attempts = 0;
  const flaky = await provider.fetch({ name: 'Acme', careers_url: ORIGIN }, {
    sleep: async () => {},
    fetchText: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('HTTP 503'), { status: 503 });
      return html;
    },
  });
  if (attempts === 2 && flaky.length === 5) pass('fetch() retries a transient 503 once through fetchTextWithRetry');
  else fail(`transient retry: attempts=${attempts}, jobs=${flaky.length}`);

  // A Cloudflare challenge is a descriptive failure, never retried or worked around.
  let challengeCalls = 0;
  let challengeErr;
  try {
    await provider.fetch({ name: 'Acme', careers_url: ORIGIN }, {
      sleep: async () => {},
      fetchText: async () => {
        challengeCalls += 1;
        throw Object.assign(new Error('HTTP 403 (Cloudflare challenge, cf-mitigated: challenge)'), { status: 403, cfMitigated: 'challenge' });
      },
    });
  } catch (e) { challengeErr = e; }
  if (challengeCalls === 1 && challengeErr && /Cloudflare challenge; not bypassed/.test(challengeErr.message)) {
    pass('a Cloudflare challenge fails loudly after one request, naming the challenge');
  } else {
    fail(`challenge: calls=${challengeCalls}, error=${challengeErr?.message}`);
  }

  // The probe (ctx.maxPages: 1) is the same single request, and a rejection
  // propagates unwrapped so verify-portals can tell a budget cut-off apart.
  class Sentinel extends Error {}
  const sentinel = new Sentinel('budget');
  let caught;
  try {
    await provider.fetch({ name: 'Acme', careers_url: ORIGIN }, { maxPages: 1, fetchText: async () => { throw sentinel; } });
  } catch (e) { caught = e; }
  if (caught === sentinel) pass('fetch() propagates a ctx.fetchText rejection unwrapped');
  else fail(`fetch() rejection was ${caught === undefined ? 'swallowed' : `rewrapped: ${caught?.message}`}`);
} catch (e) {
  fail(`viterbit provider tests crashed: ${e.message}`);
}
