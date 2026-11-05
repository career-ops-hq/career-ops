// tests/providers/inrecruiting.test.mjs — provider-contract tests for
// Zucchetti's InRecruiting career pages (providers/inrecruiting.mjs).
//
// The fixtures reproduce the shapes measured on live tenants on 2026-10-26:
//
//   - page 1 is the server-rendered `/{lang}/career` page: cards whose title
//     <h3> sits inside the posting link, a hidden `#url-for-announces` input
//     carrying the guest AJAX URL (HTML-escaped `&amp;`), and the `section`
//     token inside the page's own `researchAnnounces()` script;
//   - every posting URL appears twice per card (title link and a details
//     button), so a parser keyed on bare links would double-count;
//   - the location follows the `mi-location_on` icon and a screen-reader
//     label that must not leak into the value;
//   - pages 2+ come back as `{"success":true,"data":"<html>"}` from a POST.
//
// Fixture tenants are fictional (acme / exampleco).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — inrecruiting');

const mod = await import(pathToFileURL(join(ROOT, 'providers', 'inrecruiting.mjs')).href);
const provider = mod.default;

const HOST = 'acme.intervieweb.it';
const ANNOUNCES = `https://${HOST}/app.php?opmode=guest&amp;module=newcareer&amp;ajax=1&amp;IdAzienda=1&amp;CSRFToken=tok&amp;CSRFHash=hash`;

/** One card as the live markup renders it (trimmed, structure preserved). */
function card(slug, title, location, host = HOST) {
  const href = `https://${host}/jobs/${slug}/it/`;
  return `
<div class="col-12 col-md-6">
  <div class="row vacancy__render">
    <div class="vacancy__header">
      <div class="vacancy__title">
        <section >
          <a href="${href}">
            <h3>
              ${title}                                                    </h3>
          </a>
        </section>
      </div>
      <div class="vacancy__subtitle mb-bien-gutter" data-internal-id="___vm_location___">
        <span class="subtitle__informations" title="Sede">
          <i class="mi mi-location_on font-size-20"
             aria-hidden="true">
          </i>
          <span class="sr-only">Sede </span>${location}</span>
        <span class="subtitle__informations" title="Professione/Funzione">
          <i class="mi mi-sell font-size-20" aria-hidden="true"></i>
          <span class="sr-only">Professione/Funzione </span>IT</span>
      </div>
    </div>
    <a class="btn btn-primary" href="${href}">Dettagli</a>
  </div>
</div>`;
}

function pager(next) {
  return next
    ? `<div class="move-pagination-top">Pagina ${next - 1} di 9 <i class="fas fa-chevron-circle-right pagination_next"
         onclick="researchAnnounces(${next}, 'name')"></i></div>`
    : '<div class="move-pagination-top">Pagina 1 di 1</div>';
}

function careerPage(cards, next) {
  return `<!DOCTYPE html><html><body>
<input type="hidden" id="url-for-announces" value="${ANNOUNCES}">
<div class="tab-content"><div class="tab-pane active" id="tab-annunci">${pager(next)}${cards}</div></div>
<script>
function researchAnnounces(pageNumber, order, mobile = false) {
  $.ajax({ url: url, type: "POST", data: { 'act1': 'vacancyListCareer', 'section': 'SeCt10n', 'order': order, 'page': pageNumber } });
}
</script></body></html>`;
}

const pageResponse = (cards, next) => JSON.stringify({ success: true, data: pager(next) + cards });

/**
 * A ctx serving page 1 by GET and page N by POST (read from the form body).
 * @param {(page: number, call: {url: string, opts: any}) => string} servePost
 * @param {string} firstPage
 * @param {object} [extra]
 */
function mockCtx(firstPage, servePost, extra = {}) {
  /** @type {{url: string, opts: any}[]} */
  const calls = [];
  let slept = 0;
  const ctx = {
    sleep: async (ms) => { slept += ms; },
    fetchText: async (url, opts = {}) => {
      const call = { url, opts };
      calls.push(call);
      if ((opts.method ?? 'GET') === 'GET') return firstPage;
      const page = Number(new URLSearchParams(opts.body).get('page'));
      return servePost(page, call);
    },
    ...extra,
  };
  return { ctx, calls, slept: () => slept };
}

/** Capture console.error lines written while `fn` runs. */
async function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

// ── id ──
if (provider.id === 'inrecruiting') pass('provider id is inrecruiting');
else fail(`provider id: ${provider.id}`);

// ── detect() ──
{
  const cases = [
    [{ careers_url: 'https://acme.intervieweb.it/it/career' }, 'https://acme.intervieweb.it/it/career'],
    [{ careers_url: 'https://acme.intervieweb.it/' }, 'https://acme.intervieweb.it/it/career'],
    [{ careers_url: 'https://acme.intervieweb.it/en/career' }, 'https://acme.intervieweb.it/en/career'],
    [{ careers_url: 'https://Acme.Intervieweb.it/jobs/data-analyst-123/en/' }, 'https://acme.intervieweb.it/en/career'],
    [{ careers_url: 'https://acme.intervieweb.it:8443/it/career?x=1' }, 'https://acme.intervieweb.it/it/career'],
    [{ api: 'https://exampleco.intervieweb.it/it/career', careers_url: 'https://exampleco.com/lavora-con-noi' }, 'https://exampleco.intervieweb.it/it/career'],
  ];
  for (const [entry, want] of cases) {
    const got = provider.detect(entry);
    if (got && got.url === want) pass(`detect() claims ${entry.api ?? entry.careers_url}`);
    else fail(`detect(${JSON.stringify(entry)}) → ${JSON.stringify(got)}, want ${want}`);
  }

  const rejects = [
    { careers_url: 'http://acme.intervieweb.it/it/career' },
    { careers_url: 'https://acme.intervieweb.it.evil.example/it/career' },
    { careers_url: 'https://acmeintervieweb.it/it/career' },
    { careers_url: 'https://evil.example/acme.intervieweb.it' },
    { careers_url: 'https://inrecruiting.intervieweb.it/acme/it/career' },
    { careers_url: 'https://www.intervieweb.it/' },
    { careers_url: 'not a url' },
    { careers_url: null },
    { careers_url: 42 },
    {},
    null,
  ];
  let threw = false;
  const claimed = [];
  for (const entry of rejects) {
    try {
      if (provider.detect(entry) !== null) claimed.push(JSON.stringify(entry));
    } catch {
      threw = true;
    }
  }
  if (!threw && claimed.length === 0) pass('detect() returns null without throwing for non-tenant, non-HTTPS, malformed and missing URLs');
  else fail(`detect() threw=${threw}, wrongly claimed: ${claimed.join(' | ')}`);
}

// ── SSRF guard runs before any request ──
{
  let entered = 0;
  const ctx = { fetchText: async () => { entered++; return ''; } };
  let threw = false;
  try {
    await provider.fetch({ name: 'Evil', careers_url: 'https://evil.example/it/career' }, ctx);
  } catch {
    threw = true;
  }
  if (threw && entered === 0) pass('fetch() rejects an untrusted host before issuing any request');
  else fail(`untrusted host: threw=${threw}, requests=${entered}`);
}

// ── fetch(): normalization and pagination across three pages ──
{
  const page1 = careerPage(
    card('r-d-data-analyst-101', 'R&amp;D Data Analyst', 'Bologna Italia')
      + card('junior-developer-102', 'Junior Developer', 'Modena Italia'),
    2,
  );
  const { ctx, calls, slept } = mockCtx(page1, (page) => {
    if (page === 2) return pageResponse(card('stage-bi-103', 'Stage BI', 'Remoto') + card('junior-developer-102', 'Junior Developer', 'Modena Italia'), 3);
    if (page === 3) return pageResponse(card('analista-programmatore-104', 'Analista programmatore', 'Parma Italia'), null);
    throw new Error(`unexpected page ${page}`);
  });
  const jobs = await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, ctx);

  const titles = jobs.map((j) => j.title);
  if (JSON.stringify(titles) === JSON.stringify(['R&D Data Analyst', 'Junior Developer', 'Stage BI', 'Analista programmatore'])) {
    pass('fetch() walks every page and de-duplicates a posting repeated across pages');
  } else {
    fail(`titles: ${JSON.stringify(titles)}`);
  }
  if (titles.includes('R&D Data Analyst') && !titles.some((t) => t.includes('&amp;'))) {
    pass('an HTML entity in a title is decoded before the keyword filter sees it');
  } else {
    fail('entity not decoded in title');
  }
  const first = jobs[0];
  if (first && first.url === 'https://acme.intervieweb.it/jobs/r-d-data-analyst-101/it/'
    && first.company === 'Acme' && first.location === 'Bologna Italia') {
    pass('a card maps to {title, url, company: entry name, location} without the screen-reader label');
  } else {
    fail(`first job: ${JSON.stringify(first)}`);
  }
  if (jobs.length === 4 && !jobs.inrecruitingTruncated) pass('a complete walk is not tagged truncated');
  else fail(`complete walk: ${jobs.length} jobs, truncated=${jobs.inrecruitingTruncated}`);

  if (calls.length === 3 && calls.every((c) => c.opts.redirect === 'error')) {
    pass('every request (career page and each POST page) passes redirect: "error"');
  } else {
    fail(`redirect not pinned: ${JSON.stringify(calls.map((c) => c.opts.redirect))}`);
  }
  const post = calls[1];
  const body = new URLSearchParams(post?.opts.body ?? '');
  if (post && post.opts.method === 'POST'
    && post.url === 'https://acme.intervieweb.it/app.php?opmode=guest&module=newcareer&ajax=1&IdAzienda=1&CSRFToken=tok&CSRFHash=hash'
    && body.get('act1') === 'vacancyListCareer' && body.get('section') === 'SeCt10n'
    && body.get('page') === '2' && body.get('order') === 'name') {
    pass('page 2 is the page’s own POST: unescaped guest URL, section token, page and order');
  } else {
    fail(`page-2 request: ${JSON.stringify(post)}`);
  }
  if (slept() >= 400) pass('fetch() paces pages through the shared sleep');
  else fail(`slept ${slept()}ms across 3 pages`);
}

// ── rows missing a field or pointing off-tenant are dropped ──
{
  const page = careerPage(
    card('good-201', 'Data Analyst', 'Bologna Italia')
      + card('blank-202', '   ', 'Bologna Italia')
      + card('foreign-203', 'Foreign Posting', 'Milano Italia', 'other.intervieweb.it'),
    null,
  );
  const { ctx } = mockCtx(page, () => { throw new Error('no page 2'); });
  const jobs = await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, ctx);
  if (jobs.length === 1 && jobs[0].title === 'Data Analyst') pass('a card with no title or another tenant’s link is skipped, the rest stand');
  else fail(`filtered rows: ${JSON.stringify(jobs)}`);
}

// ── empty vs broken ──
{
  const { ctx } = mockCtx(careerPage('<p>Nessun annuncio disponibile</p>', null), () => '');
  const jobs = await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, ctx);
  if (Array.isArray(jobs) && jobs.length === 0) pass('a career page with no postings is an empty board → []');
  else fail(`empty board: ${JSON.stringify(jobs)}`);
}
{
  const restyled = careerPage(card('data-analyst-301', 'Data Analyst', 'Bologna Italia'), null).replace(/<(\/?)h3>/g, '<$1h4>');
  const { ctx } = mockCtx(restyled, () => '');
  let err = null;
  try {
    await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, ctx);
  } catch (e) {
    err = e;
  }
  if (err && /markup changed/.test(err.message)) pass('posting links present but no card parsed → throws (markup change, not a quiet board)');
  else fail(`restyled page: ${err ? err.message : 'no throw'}`);
}
{
  const { ctx } = mockCtx('<html><body>Accedi</body></html>', () => '');
  let err = null;
  try {
    await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, ctx);
  } catch (e) {
    err = e;
  }
  if (err && /not an InRecruiting career page/.test(err.message)) pass('a page with neither postings nor the vacancy list → throws');
  else fail(`non-career page: ${err ? err.message : 'no throw'}`);
}
{
  let threw = 0;
  for (const bad of ['not json', '"text"', '{}', '{"success":false,"data":""}', '{"success":true,"data":null}']) {
    try { mod.parsePageResponse(bad); } catch { threw++; }
  }
  const ok = mod.parsePageResponse('{"success":true,"data":""}') === '';
  if (threw === 5 && ok) pass('parsePageResponse() throws on any envelope but {success: true, data: string}');
  else fail(`parsePageResponse threw ${threw}/5, empty data ok=${ok}`);
}

// ── a failed page 2 keeps page 1 and warns (not "raise max_pages") ──
{
  const page1 = careerPage(card('data-analyst-401', 'Data Analyst', 'Bologna Italia'), 2);
  const { ctx } = mockCtx(page1, () => JSON.stringify({ success: false }));
  const { result: jobs, lines } = await captureErrors(() =>
    provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, ctx));
  if (jobs.length === 1 && jobs.inrecruitingTruncated === true
    && lines.some((l) => /truncated at page 2/.test(l)) && !lines.some((l) => /raise max_pages/.test(l))) {
    pass('a broken page 2 keeps page 1, tags the board truncated and warns without blaming max_pages');
  } else {
    fail(`page-2 failure: jobs=${jobs.length} truncated=${jobs.inrecruitingTruncated} lines=${JSON.stringify(lines)}`);
  }
}

// ── a restyled page 2 keeps page 1 instead of failing the whole target ──
{
  const page1 = careerPage(card('data-analyst-501', 'Data Analyst', 'Bologna Italia'), 2);
  const restyled = pageResponse(card('stage-bi-502', 'Stage BI', 'Bologna Italia'), null).replace(/h3/g, 'h4');
  const { ctx } = mockCtx(page1, () => restyled);
  const { result: jobs, lines } = await captureErrors(() =>
    provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, ctx));
  if (jobs.length === 1 && jobs[0].title === 'Data Analyst' && jobs.inrecruitingTruncated === true
    && lines.some((l) => /truncated at page 2/.test(l)) && !lines.some((l) => /raise max_pages/.test(l))) {
    pass('a page 2 that links postings but parses none keeps page 1, tagged truncated');
  } else {
    fail(`restyled page 2: jobs=${JSON.stringify(jobs)} truncated=${jobs.inrecruitingTruncated} lines=${JSON.stringify(lines)}`);
  }

  const probe = mockCtx(page1, () => restyled, { maxPages: 2 });
  let err = null;
  try {
    await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, probe.ctx);
  } catch (e) {
    err = e;
  }
  if (err && /markup changed/.test(err.message)) pass('while probing, a restyled later page still throws');
  else fail(`probe on restyled page 2: ${err ? err.message : 'no throw'}`);
}

// ── a page holding only already-seen postings does not end the walk ──
{
  const page1 = careerPage(card('data-analyst-601', 'Data Analyst', 'Bologna Italia'), 2);
  const { ctx, calls } = mockCtx(page1, (page) => {
    if (page === 2) return pageResponse(card('data-analyst-601', 'Data Analyst', 'Bologna Italia'), 3);
    if (page === 3) return pageResponse(card('stage-bi-603', 'Stage BI', 'Modena Italia'), null);
    throw new Error(`unexpected page ${page}`);
  });
  const jobs = await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, ctx);
  if (calls.length === 3 && JSON.stringify(jobs.map((j) => j.title)) === JSON.stringify(['Data Analyst', 'Stage BI'])) {
    pass('a duplicate-only page 2 still leads on to page 3 and its new posting');
  } else {
    fail(`duplicate-only page: calls=${calls.length} titles=${JSON.stringify(jobs.map((j) => j.title))}`);
  }
}

// ── page ceilings ──
{
  // Every page links a next one and adds a new posting, so only a cap stops it.
  const endless = (page) => pageResponse(card(`job-${page}-${9000 + page}`, `Job ${page}`, 'Bologna Italia'), page + 1);
  const page1 = careerPage(card('job-1-9001', 'Job 1', 'Bologna Italia'), 2);

  const capped = mockCtx(page1, endless);
  const { result: jobs, lines } = await captureErrors(() =>
    provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career', max_pages: 2 }, capped.ctx));
  if (capped.calls.length === 2 && jobs.length === 2 && jobs.inrecruitingTruncated === true
    && lines.some((l) => /raise max_pages/.test(l))) {
    pass('entry.max_pages stops the walk while a next page is still linked, and says so');
  } else {
    fail(`max_pages 2: calls=${capped.calls.length} jobs=${jobs.length} lines=${JSON.stringify(lines)}`);
  }

  const dflt = mockCtx(page1, endless);
  await captureErrors(() => provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, dflt.ctx));
  if (dflt.calls.length === 40) pass('DEFAULT_MAX_PAGES (40) bounds a board that keeps linking a next page');
  else fail(`default cap: ${dflt.calls.length} requests`);

  const huge = mockCtx(page1, endless);
  await captureErrors(() => provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career', max_pages: 9999 }, huge.ctx));
  if (huge.calls.length === 200) pass('an over-large max_pages is clamped to the 200-page ceiling');
  else fail(`MAX_PAGES_CAP: ${huge.calls.length} requests`);

  const backwards = mockCtx(page1, (page) => pageResponse(card(`job-${page}-${8000 + page}`, `Job ${page}`, 'Bologna Italia'), 2));
  await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, backwards.ctx);
  if (backwards.calls.length === 2) pass('a pager that points back at the same page ends the walk');
  else fail(`self-referencing pager: ${backwards.calls.length} requests`);
}

// ── health probe ──
{
  const page1 = careerPage(card('job-1-7001', 'Job 1', 'Bologna Italia'), 2);
  const probe = mockCtx(page1, () => pageResponse(card('job-2-7002', 'Job 2', 'Bologna Italia'), 3), { maxPages: 1 });
  const { result: jobs, lines } = await captureErrors(() =>
    provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, probe.ctx));
  if (probe.calls.length === 1 && jobs.length === 1 && !jobs.inrecruitingTruncated && lines.length === 0) {
    pass('ctx.maxPages: 1 issues exactly one list request, with no truncation warning');
  } else {
    fail(`probe: calls=${probe.calls.length} jobs=${jobs.length} lines=${JSON.stringify(lines)}`);
  }

  class ProbeBudget extends Error {}
  const sentinel = new ProbeBudget('budget reached');
  const rejecting = mockCtx(page1, () => { throw sentinel; }, { maxPages: 2 });
  let caught = null;
  try {
    await provider.fetch({ name: 'Acme', careers_url: 'https://acme.intervieweb.it/it/career' }, rejecting.ctx);
  } catch (e) {
    caught = e;
  }
  if (caught === sentinel) pass('while probing, a page-2 fetch rejection propagates unwrapped');
  else fail(`probe rejection was swallowed or rewrapped: ${caught}`);
}
