// tests/providers/bizneo.test.mjs — provider-contract tests for Bizneo HR career
// sites (providers/bizneo.mjs). Fixtures are modelled on the boards measured on
// 2026-11-18 (anonymised): one `<a class="job-card">` per posting with the title
// in `div.title` and the place and work model as `<span>`s of `div.details`.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — bizneo');

const mod = await import(pathToFileURL(join(ROOT, 'providers/bizneo.mjs')).href);
const bizneo = mod.default;
const { parseListingPage } = mod;

const card = (slug, title, spans, host = 'empleo.acme.example.com') => `
<a class="job-card" target="_blank" rel="noopener noreferrer" href="https://${host}/jobs/${slug}">
  <div class="job-logo-wrapper"><img alt="" src="https://assets.bizneo.com/x.png" /></div>
  <div class="content"><div class="info">
    <div class="title">${title}</div>
    <div class="details">
      ${spans.map((s) => `<span>${s}\n <i class="huge-icon"></i></span>`).join('\n')}
    </div>
  </div></div>
</a>`;

const page = (cards) => `<html><body class="career-site headhunter_jobs index">
<main><section class="jobs"><div id="job-board" class="job-board"><div class="job-collection list">${cards.join('')}</div></div></section></main></body></html>`;

const EMPTY = page([]);
const PAGE1 = page([
  card('sales-development-representative-a29a9a44', '🚀 Sales Development Representative (SDR)', ['Buenos Aires', 'Teletrabajo/Remoto']),
  card('legal-compliance-operations-intern', 'Legal, Compliance &amp; Operations Intern', ['Madrid', 'Presencial']),
  card('analista-de-estrategia', 'Analista de Estrategia', ['Madrid', 'H&iacute;brido']),
  card('no-place', 'Role with no place', []),
]);

const entry = { name: 'Acme', careers_url: 'https://empleo.acme.example.com/jobs', provider: 'bizneo' };
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

check(bizneo.id === 'bizneo', 'id is "bizneo"');
check(bizneo.detect === undefined, 'no detect(): custom domains are reached with an explicit provider');

// ── parser ──
{
  const { jobs, cards } = parseListingPage(PAGE1, 'empleo.acme.example.com', 'Acme');
  check(cards === 4 && jobs.length === 4, 'parses every card');
  const [a, b, c, d] = jobs;
  check(a.title === '🚀 Sales Development Representative (SDR)' && a.url === 'https://empleo.acme.example.com/jobs/sales-development-representative-a29a9a44', 'title and absolute url');
  check(a.company === 'Acme', 'company is the entry name');
  check(a.location === 'Buenos Aires, Remote' && a.workplaceType === 'remote' && a.locations.join() === 'Buenos Aires', 'remote model: workplaceType set, "Remote" appended, places kept apart');
  check(b.title === 'Legal, Compliance & Operations Intern', 'title entity decoded once');
  check(b.location === 'Madrid' && b.workplaceType === 'onsite', 'Presencial -> onsite, not appended to the location');
  check(c.workplaceType === 'hybrid' && c.location === 'Madrid', 'entity-encoded "Híbrido" -> hybrid');
  check(d.location === '' && !('locations' in d) && !('workplaceType' in d), 'a card with no details has empty location and no optional keys');
  check(jobs.every((j) => !('postedAt' in j) && !('listingIdentity' in j)), 'no date or listingIdentity invented');
}

// ── malformed rows are dropped, not fatal ──
{
  const html = page([
    card('ok', 'Good', ['Madrid']),
    '<a class="job-card" href="https://empleo.acme.example.com/jobs/no-title"><div class="details"><span>Madrid</span></div></a>',
    '<a class="job-card"><div class="title">No link</div></a>',
    '<a class="job-card" href=""><div class="title">Blank link</div></a>',
    card('elsewhere', 'Other host', ['Madrid'], 'evil.example.com'),
    '<a class="job-card" href="http://empleo.acme.example.com/jobs/plain"><div class="title">Plain http</div></a>',
  ]);
  const { jobs, cards } = parseListingPage(html, 'empleo.acme.example.com', 'Acme');
  check(cards === 6 && jobs.length === 1 && jobs[0].title === 'Good', 'rows without title/link, blank link, off-host or non-https links are dropped');
}

// ── fetch ──
const makeCtx = (pages, log = []) => ({
  fetchText: async (url, opts) => {
    log.push({ url, opts });
    if (!pages.has(url)) throw Object.assign(new Error(`no fixture for ${url}`), { status: 404 });
    return pages.get(url);
  },
  sleep: async () => {},
});
const U = 'https://empleo.acme.example.com/jobs';

{
  const log = [];
  const jobs = await bizneo.fetch(entry, makeCtx(new Map([[U, PAGE1], [`${U}?page=2`, EMPTY]]), log));
  check(jobs.length === 4, 'fetch returns the board');
  check(log.length === 2 && log[1].url === `${U}?page=2`, 'a page past the end (no cards) stops the walk');
  check(log.every((c) => c.opts.redirect === 'error'), "every request passes redirect: 'error'");
}

{
  const p2 = page([card('second-page', 'Second page job', ['Sevilla']), card('legal-compliance-operations-intern', 'Dup', ['Madrid'])]);
  const jobs = await bizneo.fetch(entry, makeCtx(new Map([[U, PAGE1], [`${U}?page=2`, p2], [`${U}?page=3`, EMPTY]])));
  check(jobs.length === 5 && jobs.some((j) => j.title === 'Second page job'), 'paginates and de-duplicates by url');
}

{
  // A board that ignores ?page and serves page 1 again must not loop.
  const log = [];
  const same = new Map([[U, PAGE1], [`${U}?page=2`, PAGE1]]);
  const jobs = await bizneo.fetch(entry, makeCtx(same, log));
  check(jobs.length === 4 && log.length === 2, 'a page that repeats the previous one ends the walk');

  // A page made only of postings already seen is not the end: the stop comes from the page, not from dedup.
  const dupOnly = page([card('legal-compliance-operations-intern', 'Dup', ['Madrid'])]);
  const log2 = [];
  const jobs2 = await bizneo.fetch(entry, makeCtx(new Map([[U, PAGE1], [`${U}?page=2`, dupOnly], [`${U}?page=3`, page([card('third', 'Third page job', ['Sevilla'])])], [`${U}?page=4`, EMPTY]]), log2));
  check(log2.length === 4 && jobs2.some((j) => j.title === 'Third page job'), 'a page whose postings were all seen does not stop the walk');
}

{
  // The walk is bounded by the provider's own ceiling, whatever the source serves.
  const log = [];
  const endless = { fetchText: async (url) => { log.push(url); const n = Number(new URL(url).searchParams.get('page') || 1); return page([card(`job-${n}`, `Job ${n}`, ['Madrid'])]); }, sleep: async () => {} };
  const warn = console.warn; const warned = []; console.warn = (m) => warned.push(String(m));
  let jobs, huge;
  try {
    jobs = await bizneo.fetch({ ...entry, max_pages: 3 }, endless);
    var logAfterFirst = log.length;
    log.length = 0;
    huge = await bizneo.fetch({ ...entry, max_pages: 100000 }, endless);
  } finally {
    console.warn = warn;
  }
  check(logAfterFirst === 3 && jobs.length === 3, 'entry max_pages stops the walk');
  check(jobs.truncated?.reason === 'page-cap' && warned.some((m) => /raise max_pages/.test(m)), 'the cap is reported as truncated and warned');
  check(log.length === 100 && huge.length === 100, 'max_pages is clamped to the hard ceiling (100)');
  log.length = 0;
  const probe = await bizneo.fetch(entry, { ...endless, maxPages: 1 });
  check(log.length === 1 && probe.length === 1 && !probe.truncated, 'ctx.maxPages: 1 issues exactly one list request and is not a truncation');
}

{
  // A failure on page 2 propagates unwrapped (also what the health probe needs).
  const boom = Object.assign(new Error('HTTP 503'), { status: 503 });
  let err;
  try {
    await bizneo.fetch(entry, { fetchText: async (url) => { if (url.includes('page=2')) throw boom; return PAGE1; }, sleep: async () => {} });
  } catch (e) { err = e; }
  check(err === boom, 'a failing later page fails loud, unwrapped');
}

// ── guards ──
{
  for (const [label, careers_url] of [['http', 'http://empleo.acme.example.com/jobs'], ['malformed', 'not a url'], ['missing', undefined]]) {
    const calls = [];
    let err;
    try { await bizneo.fetch({ ...entry, careers_url }, { fetchText: async (u) => { calls.push(u); return PAGE1; }, sleep: async () => {} }); } catch (e) { err = e; }
    check(err && calls.length === 0, `${label} careers_url throws before any request`);
  }
  for (const [label, careers_url] of [
    ['credentials', 'https://user:pw@empleo.acme.example.com/jobs'],
    ['port', 'https://empleo.acme.example.com:8443/jobs'],
    ['bare IPv4', 'https://169.254.169.254/jobs'],
    ['decimal IPv4', 'https://2130706433/jobs'],
    ['IPv6 literal', 'https://[::1]/jobs'],
    ['localhost', 'https://localhost/jobs'],
    ['internal name', 'https://jobs.corp.internal/jobs'],
    ['single label', 'https://intranet/jobs'],
  ]) {
    const calls = [];
    let err;
    try { await bizneo.fetch({ ...entry, careers_url }, { fetchText: async (u) => { calls.push(u); return PAGE1; }, sleep: async () => {} }); } catch (e) { err = e; }
    check(err && /public named https host/.test(err.message) && calls.length === 0, `${label} careers_url is refused before any request`);
  }
  const log = [];
  await bizneo.fetch({ ...entry, careers_url: 'https://empleo.acme.example.com/other/path?x=1' }, makeCtx(new Map([[U, EMPTY]]), log));
  check(log[0].url === U, 'origin is rebuilt from the hostname only (path discarded)');
}

// ── empty vs broken ──
{
  const jobs = await bizneo.fetch(entry, makeCtx(new Map([[U, EMPTY]])));
  check(Array.isArray(jobs) && jobs.length === 0, 'a career site with no cards is an empty board');

  const broken = '<html><body class="career-site"><a class="job-card" href="https://empleo.acme.example.com/jobs/x"><span>markup changed</span></a></body></html>';
  let err;
  try { await bizneo.fetch(entry, makeCtx(new Map([[U, broken]]))); } catch (e) { err = e; }
  check(err && /markup changed/.test(err.message), 'cards present but none parsed throws');

  // The same break on a later page fails too, not only on the first.
  err = undefined;
  try { await bizneo.fetch(entry, makeCtx(new Map([[U, PAGE1], [`${U}?page=2`, broken]]))); } catch (e) { err = e; }
  check(err && /markup changed/.test(err.message) && /page=2/.test(err.message), 'cards present but none parsed on a later page throws');

  // Posting links with no card at all: markup changed, not an empty board.
  const noCards = '<html><body class="career-site"><ul><li><a href="/jobs/some-role">Some role</a></li></ul></body></html>';
  err = undefined;
  try { await bizneo.fetch(entry, makeCtx(new Map([[U, noCards]]))); } catch (e) { err = e; }
  check(err && /no job cards/.test(err.message), 'posting links with no cards throws');
  err = undefined;
  try { await bizneo.fetch(entry, makeCtx(new Map([[U, PAGE1], [`${U}?page=2`, noCards]]))); } catch (e) { err = e; }
  check(err && /no job cards/.test(err.message), 'posting links with no cards on a later page throws');

  err = undefined;
  try { await bizneo.fetch(entry, makeCtx(new Map([[U, '<html><body><h1>Maintenance</h1></body></html>']]))); } catch (e) { err = e; }
  check(err && /does not look like a Bizneo career site/.test(err.message), 'a page that is not a Bizneo career site throws');

  // A later page that is not a career site (200 error or maintenance page) is a broken read, not the end.
  err = undefined;
  try { await bizneo.fetch(entry, makeCtx(new Map([[U, PAGE1], [`${U}?page=2`, '<html><body><h1>Service unavailable</h1></body></html>']]))); } catch (e) { err = e; }
  check(err && /does not look like a Bizneo career site/.test(err.message) && /page=2/.test(err.message), 'a later page that is not a career site throws');
}
