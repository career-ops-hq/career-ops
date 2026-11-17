// tests/providers/talentlink.test.mjs — providers/talentlink.mjs (Lumesse
// TalentLink FO widget career pages read through the FO REST API).
//
// Fixtures follow the live payload shape: a static career page carrying
// data-lumesse-fo-host / data-lumesse-site-tech-id, a /fo/rest/jobs/criteria
// answer naming each list, and /fo/rest/jobs pages of
// {globals: {jobsCount}, jobs: [{id, jobFields, customFields}]}.
//
// Run:  node --test tests/providers/talentlink.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import talentlink, { resolveBoard, parseBoardPage, parseCriteria, parseJobsResponse, resolveDetailPage } from '../../providers/talentlink.mjs';

const SITE_ID = 'ABCDE0123456789ABCDEFGHIJ';
const FO_HOST = 'emea9-foc.lumessetalentlink.com';
const BOARD = 'https://acme.recruitmentplatform.com/';

const page = (host = FO_HOST, id = SITE_ID) => `<!DOCTYPE html><html><body>
<div id="lumesseJobsListWidget" data-lumesse-fo-host="${host}" data-lumesse-site-tech-id="${id}" data-lumesse-job-list-view-type="list"></div>
<script src="https://${host}/apply-app/static/talentportal/release/1-LATEST/talentportal-widgets.js"></script>
</body></html>`;

const CRITERIA = {
  LOV19: { lovName: 'Acme Country', lovId: 1, items: [{ value: 11, label: 'Poland' }, { value: 12, label: 'Germany' }], bindWith: ['LOV20'] },
  LOV20: { lovName: 'Acme Location', lovId: 2, items: [{ value: 21, label: 'Ujazd', bindTo: [11] }, { value: 22, label: 'Berlin', bindTo: [12] }] },
  LOV23: { lovName: 'Functional Area', lovId: 3, items: [{ value: 31, label: 'Engineering' }] },
};

function row(id, over = {}, customFields) {
  return {
    id,
    customFields: customFields ?? [
      { title: 'About us', content: '<p>ExampleCo builds <b>things</b> &amp; more.</p>' },
      { title: ' ', content: '' },
    ],
    jobFields: {
      id,
      jobTitle: `Role ${id}`,
      SLOVLIST20: 'Berlin',
      SLOVLIST23: 'Engineering',
      DPOSTINGSTART: 1793746800000,
      language: 'DE',
      jobNumber: `DE${id}`,
      applicationUrl: `https://apply9.lumessetalentlink.com/apply-app/pages/application-form?jobId=${SITE_ID}-${id}&langCode=de_DE`,
      WorkMode: [],
      ...over,
    },
  };
}

const wcagPage = (host = `https://${FO_HOST}`, id = SITE_ID) => `<html><body>
<script type="text/javascript" src="${host}/apply-app/static/talentportal/release/3-LATEST/talentportal-widgets-wcag.js"
    data-talentlink-fo-site-tech-id="${id}" data-talentlink-fo-host="${host}" data-talentlink-fo-language-autodetect></script>
<div data-talentlink-fo-root-container></div></body></html>`;

const CONFIG = { generalInfo: { language: 'EN' }, navigationPages: { jobListURL: 'index.html', jobDescriptionURL: 'details.html' } };

const jobsPage = (rows, total = rows.length) => ({ globals: { jobsCount: total, typeDescriptor: {} }, jobs: rows });

/**
 * Stub ctx. `pages` is an array of jobs-page answers (or Errors to throw).
 * Every call is recorded with its options.
 */
function makeCtx({ html = page(), config = CONFIG, criteria = CRITERIA, pages = [jobsPage([row(1)])], maxPages, idCache } = {}) {
  const calls = [];
  let jobsCalls = 0;
  const answer = (v) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  return {
    calls,
    ctx: {
      transport: 'http',
      maxPages,
      idCache,
      sleep: async () => {},
      async fetchText(url, opts) {
        calls.push({ url, opts });
        return answer(html);
      },
      async fetchJson(url, opts) {
        calls.push({ url, opts });
        if (url.endsWith('/fo/rest/config')) return answer(config);
        if (url.endsWith('/fo/rest/jobs/criteria')) return answer(criteria);
        const p = pages[Math.min(jobsCalls++, pages.length - 1)];
        return answer(p);
      },
      async fetchResponse() { throw new Error('unused'); },
    },
  };
}

const listCalls = (calls) => calls.filter((c) => c.url.includes('/fo/rest/jobs?'));

function httpError(status) {
  const e = /** @type {any} */ (new Error(`HTTP ${status}`));
  e.status = status;
  return e;
}

function quietWarn(fn) {
  return async () => {
    const orig = console.warn;
    const warnings = [];
    console.warn = (...a) => warnings.push(a.join(' '));
    try { await fn(warnings); } finally { console.warn = orig; }
  };
}

test('id is "talentlink"', () => {
  assert.equal(talentlink.id, 'talentlink');
});

test('detect() claims tenant pages on recruitmentplatform.com', () => {
  for (const url of [
    BOARD,
    'https://acme.recruitmentplatform.com/index.html',
    'https://acme.recruitmentplatform.com/details.html?jobId=7807&jobTitle=Engineer',
    'https://acme.recruitmentplatform.com/internal/index.html',
    'https://acme.recruitmentplatform.com/FO/ABC123/components/index.html',
    'https://Acme.RecruitmentPlatform.com/FO/index.html?languageSelect=EN',
  ]) {
    assert.deepEqual(talentlink.detect({ name: 'Acme', careers_url: url }), { url }, url);
  }
  assert.ok(talentlink.detect({ name: 'Acme', api: BOARD }));
});

test('detect() returns null for other hosts and junk', () => {
  for (const careers_url of [
    'http://acme.recruitmentplatform.com/',
    'https://recruitmentplatform.com/',
    'https://evilrecruitmentplatform.com/',
    'https://acme.recruitmentplatform.com.evil.example/',
    'https://a.b.recruitmentplatform.com/',
    'https://acme.recruitmentplatform.com/a%2F..%2Fb/index.html',
    'https://careers.acme.example/',
    'not a url',
    '',
    null,
    42,
    undefined,
  ]) {
    assert.equal(talentlink.detect({ name: 'Acme', careers_url }), null, String(careers_url));
  }
  assert.equal(talentlink.detect({ name: 'Acme' }), null);
  assert.equal(talentlink.detect({}), null);
});

test('resolveBoard() rebuilds the origin and keeps only directory segments', () => {
  assert.deepEqual(resolveBoard('https://acme.recruitmentplatform.com:8443/internal/details.html?jobId=1#x'), {
    pageUrl: 'https://acme.recruitmentplatform.com/internal/details.html',
    boardDir: 'https://acme.recruitmentplatform.com/internal/',
  });
  assert.deepEqual(resolveBoard('https://acme.recruitmentplatform.com/internal/'), {
    pageUrl: 'https://acme.recruitmentplatform.com/internal/index.html',
    boardDir: 'https://acme.recruitmentplatform.com/internal/',
  });
  assert.equal(resolveBoard('https://acme.recruitmentplatform.com/feed.xml'), null);
  assert.equal(resolveBoard('https://acme.recruitmentplatform.com/a.b/index.html'), null);
  assert.equal(resolveBoard('https://careers.acme.example/jobs/'), null);
  assert.deepEqual(resolveBoard('https://careers.acme.example/jobs/', { vendorOnly: false }), {
    pageUrl: 'https://careers.acme.example/jobs/index.html',
    boardDir: 'https://careers.acme.example/jobs/',
  });
});

test('parseBoardPage() reads the FO host and site id, and names what is missing', () => {
  assert.deepEqual(parseBoardPage(page()), { foHost: FO_HOST, siteId: SITE_ID });
  assert.deepEqual(parseBoardPage(page('emea3.recruitmentplatform.com')).foHost, 'emea3.recruitmentplatform.com');
  assert.deepEqual(parseBoardPage(wcagPage()), { foHost: FO_HOST, siteId: SITE_ID });
  assert.throws(() => parseBoardPage(wcagPage('http://internal.acme.example')), /not a TalentLink host/);
  assert.throws(() => parseBoardPage('<html>nothing</html>'), /no FO widget/);
  assert.throws(
    () => parseBoardPage('<script src="https://emea3.recruitmentplatform.com/syndicated/lay/jsoutputinitrapido.cfm?ID=X"></script>'),
    /syndicated/,
  );
  assert.throws(() => parseBoardPage(page('internal.acme.example')), /not a TalentLink host/);
  assert.throws(() => parseBoardPage(page(FO_HOST, 'x"><script>')), /unexpected format/);
});

test('fetch() normalizes the list payload', async () => {
  const rows = [
    row(7807, { SLOVLIST20: 'Ujazd', jobTitle: 'R&amp;D Engineer', applicationUrl: 'https://x.lumessetalentlink.com/a?jobId=X-7807&langCode=pl' }),
    row(7797, { WorkMode: ['Hybrid', 'Remote'], DPOSTINGSTART: undefined, jobNumber: null }),
    row(7790, { SLOVLIST20: 'Nowhere', WorkMode: ['On-site'], applicationUrl: null }),
  ];
  const { ctx } = makeCtx({ pages: [jobsPage(rows)] });
  const jobs = await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx);
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs[0], {
    title: 'R&D Engineer',
    url: 'https://acme.recruitmentplatform.com/details.html?jobId=7807',
    company: 'Acme',
    location: 'Ujazd, Poland',
    externalId: '7807',
    postedAt: 1793746800000,
    requisitionId: 'DE7807',
    language: 'pl',
    description: 'About us: ExampleCo builds things & more.',
  });
  assert.equal(jobs[1].location, 'Berlin, Germany · Remote · Hybrid');
  assert.equal(jobs[1].postedAt, undefined);
  assert.equal(jobs[1].requisitionId, undefined);
  assert.equal(jobs[1].language, 'de-DE');
  assert.equal(jobs[2].location, 'Nowhere');
  assert.equal(jobs[2].language, undefined);
});

test('a country column in the row stays after the city', () => {
  const crit = {
    LOV5: { lovName: 'Acme Country', items: [{ value: 1, label: 'Mexico' }] },
    LOV6: { lovName: 'Acme Location', items: [{ value: 2, label: 'Monterrey', bindTo: [1] }] },
  };
  const out = parseJobsResponse(jobsPage([row(1, { SLOVLIST5: 'Mexico', SLOVLIST6: 'Monterrey', SLOVLIST20: undefined })]), {
    detailPage: `${BOARD}details.html`, company: 'Acme', locations: parseCriteria(crit),
  });
  assert.equal(out.jobs[0].location, 'Monterrey, Mexico');
});

test('a list the criteria do not name as a location is not read as one', () => {
  const out = parseJobsResponse(jobsPage([row(1)]), { detailPage: `${BOARD}details.html`, company: 'Acme', locations: parseCriteria({}) });
  assert.equal(out.jobs[0].location, '');
});

test('rows missing an id or title, or with a non-numeric id, are dropped', async () => {
  const rows = [
    row(1),
    row(2, { jobTitle: '   ' }),
    { ...row(3), id: undefined, jobFields: { ...row(3).jobFields, id: undefined } },
    { ...row(4), id: 'a/b', jobFields: { ...row(4).jobFields, id: 'a/b' } },
    null,
    'junk',
  ];
  const { ctx } = makeCtx({ pages: [jobsPage(rows, 6)] });
  const jobs = await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx);
  assert.deepEqual(jobs.map((j) => j.externalId), ['1']);
});

test('every request passes redirect: "error", and the list call carries the guest login', async () => {
  const { ctx, calls } = makeCtx();
  await talentlink.fetch({ name: 'Acme', careers_url: 'https://acme.recruitmentplatform.com/internal/details.html?jobId=9' }, ctx);
  assert.equal(calls.length, 4);
  for (const c of calls) assert.equal(c.opts.redirect, 'error', c.url);
  assert.equal(calls[0].url, 'https://acme.recruitmentplatform.com/internal/details.html');
  assert.equal(calls[1].url, `https://${FO_HOST}/fo/rest/config`);
  assert.equal(calls[1].opts.headers.username, `${SITE_ID}:guest:FO`);
  assert.equal(calls[2].url, `https://${FO_HOST}/fo/rest/jobs/criteria`);
  const list = calls[3];
  assert.equal(list.url, `https://${FO_HOST}/fo/rest/jobs?firstResult=0&maxResults=100&sortBy=DPOSTINGSTART&sortOrder=desc`);
  assert.equal(list.opts.method, 'POST');
  assert.equal(list.opts.body, '{"searchCriteria":{}}');
  assert.equal(list.opts.headers.username, `${SITE_ID}:guest:FO`);
  assert.equal(list.opts.headers.password, 'guest');
  assert.equal(list.opts.headers.accept, 'application/json');
});

test('posting URLs keep the board directory', async () => {
  const { ctx } = makeCtx();
  const [job] = await talentlink.fetch({ name: 'Acme', careers_url: 'https://acme.recruitmentplatform.com/FO/ABC123/components/index.html' }, ctx);
  assert.equal(job.url, 'https://acme.recruitmentplatform.com/FO/ABC123/components/details.html?jobId=1');
});

test('the host guard fires before any request', async () => {
  for (const careers_url of ['https://careers.acme.example/', 'http://acme.recruitmentplatform.com/', 'nope']) {
    const { ctx, calls } = makeCtx();
    await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url }, ctx), /no https TalentLink career page URL/);
    assert.equal(calls.length, 0, careers_url);
  }
});

test('an explicit provider: talentlink reads a branded host, but the FO host must still be TalentLink', async () => {
  const entry = { name: 'Acme', provider: 'talentlink', careers_url: 'https://careers.acme.example/jobs/' };
  const ok = makeCtx();
  const jobs = await talentlink.fetch(entry, ok.ctx);
  assert.equal(jobs[0].url, 'https://careers.acme.example/jobs/details.html?jobId=1');
  assert.equal(ok.calls[0].url, 'https://careers.acme.example/jobs/index.html');

  // The accessible widget on an employer page, with its own posting page named in the config.
  const wcag = makeCtx({
    html: wcagPage(),
    config: { navigationPages: { jobDescriptionURL: 'https://careers.acme.example/acme_jobdescription.html' } },
  });
  const wJobs = await talentlink.fetch({ name: 'Acme', provider: 'talentlink', careers_url: 'https://careers.acme.example/acme_jobsearch.html' }, wcag.ctx);
  assert.equal(wcag.calls[0].url, 'https://careers.acme.example/acme_jobsearch.html');
  assert.equal(wJobs[0].url, 'https://careers.acme.example/acme_jobdescription.html?jobId=1');

  const bad = makeCtx({ html: page('metadata.internal.example') });
  await assert.rejects(talentlink.fetch(entry, bad.ctx), /not a TalentLink host/);
  assert.equal(bad.calls.length, 1);
});

test('an empty board is empty; a wrong envelope throws', async () => {
  // The live empty-board answer carries no jobs key at all.
  for (const body of [{ globals: { jobsCount: 0, selectedSearchCriteria: [] } }, { globals: { jobsCount: 0 }, jobs: [] }]) {
    const empty = makeCtx({ pages: [body] });
    assert.deepEqual(await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, empty.ctx), [], JSON.stringify(body));
  }

  for (const body of [{}, { jobs: null }, { jobs: {} }, { results: [] }, { globals: { jobsCount: 5 } }, { globals: {} }, { globals: { jobsCount: 0 }, jobs: null }, '', 7, null]) {
    const { ctx } = makeCtx({ pages: [body] });
    await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx), /expected jobs\[\]/, JSON.stringify(body));
  }
});

test('a page without the widget throws instead of reading as empty', async () => {
  const { ctx, calls } = makeCtx({ html: '<html><body>maintenance</body></html>' });
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx), /no FO widget/);
  assert.equal(calls.length, 1);
});

test('a 403 from the career page or the FO API reads as a missing board (404)', async () => {
  const pageCtx = makeCtx();
  pageCtx.ctx.fetchText = async () => { throw httpError(403); };
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, pageCtx.ctx), (e) => e.status === 404 && /no career page/.test(e.message));

  const cfgCtx = makeCtx({ config: httpError(403) });
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, cfgCtx.ctx), (e) => e.status === 404 && /site id not recognised/.test(e.message));

  const apiCtx = makeCtx({ pages: [httpError(403)] });
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, apiCtx.ctx), (e) => e.status === 404 && /site id not recognised/.test(e.message));

  const notFound = makeCtx();
  notFound.ctx.fetchText = async () => { throw httpError(404); };
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, notFound.ctx), (e) => e.status === 404);
});

test('pagination walks full pages and stops on a short one', async () => {
  const full = (start) => Array.from({ length: 100 }, (_, i) => row(start + i));
  const { ctx, calls } = makeCtx({ pages: [jobsPage(full(1), 0), jobsPage(full(101), 0), jobsPage([row(201)], 0)] });
  // jobsCount 0 next to full pages is ignored; the short page ends the walk.
  const jobs = await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx);
  assert.equal(jobs.length, 201);
  assert.deepEqual(listCalls(calls).map((c) => new URL(c.url).searchParams.get('firstResult')), ['0', '100', '200']);
  assert.equal(jobs.truncated, undefined);
});

test('pagination stops when jobsCount is reached on a full page', async () => {
  const full = Array.from({ length: 100 }, (_, i) => row(i + 1));
  const { ctx, calls } = makeCtx({ pages: [jobsPage(full, 100)] });
  assert.equal((await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx)).length, 100);
  assert.equal(listCalls(calls).length, 1);
});

test('DEFAULT_MAX_PAGES bounds the walk and warns to raise max_pages', quietWarn(async (warnings) => {
  let n = 0;
  const { ctx, calls } = makeCtx();
  ctx.fetchJson = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/config')) return CONFIG;
    if (url.endsWith('/criteria')) return CRITERIA;
    const rows = Array.from({ length: 100 }, () => row(++n));
    return jobsPage(rows, 100000);
  };
  const jobs = await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx);
  assert.equal(listCalls(calls).length, 20);
  assert.equal(jobs.length, 2000);
  assert.ok(warnings.some((w) => /raise max_pages/.test(w)));
  assert.deepEqual(jobs.truncated, { reason: 'page-cap', fetched: 2000, total: 100000 });

  const capped = makeCtx({ pages: [jobsPage(Array.from({ length: 100 }, (_, i) => row(i + 1)), 500)] });
  await talentlink.fetch({ name: 'Acme', careers_url: BOARD, max_pages: 1 }, capped.ctx);
  assert.equal(listCalls(capped.calls).length, 1);
}));

test('ctx.maxPages: 1 issues exactly one list request and no criteria request', quietWarn(async (warnings) => {
  const full = Array.from({ length: 100 }, (_, i) => row(i + 1));
  const { ctx, calls } = makeCtx({ pages: [jobsPage(full, 500)], maxPages: 1 });
  const jobs = await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx);
  assert.equal(jobs.length, 100);
  assert.equal(listCalls(calls).length, 1);
  assert.equal(calls.filter((c) => c.url.endsWith('/criteria')).length, 0);
  assert.ok(!warnings.some((w) => /raise max_pages/.test(w)));
  assert.equal(jobs.truncated, undefined);
}));

test('a failed page 2 keeps page 1 and warns without the max_pages hint', quietWarn(async (warnings) => {
  const full = Array.from({ length: 100 }, (_, i) => row(i + 1));
  const { ctx } = makeCtx({ pages: [jobsPage(full, 300), httpError(400)] });
  const jobs = await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx);
  assert.equal(jobs.length, 100);
  assert.ok(warnings.some((w) => /page 2 failed/.test(w)));
  assert.ok(!warnings.some((w) => /raise max_pages/.test(w)));
  assert.deepEqual(jobs.truncated, { reason: 'fetch-error', fetched: 100, total: 300 });
}));

test('while probing, a fetch rejection propagates unchanged', async () => {
  class ProbeStop extends Error {}
  const err = new ProbeStop('budget');
  const listErr = makeCtx({ pages: [err], maxPages: 1 });
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, listErr.ctx), (e) => e === err);

  const full = Array.from({ length: 100 }, (_, i) => row(i + 1));
  const page2 = makeCtx({ pages: [jobsPage(full, 300), err], maxPages: 2 });
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, page2.ctx), (e) => e === err);

  const pageErr = makeCtx({ maxPages: 1 });
  pageErr.ctx.fetchText = async () => { throw err; };
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, pageErr.ctx), (e) => e === err);
});

test('a failed criteria call leaves locations empty and keeps the postings', quietWarn(async (warnings) => {
  const { ctx } = makeCtx({ criteria: httpError(500) });
  const jobs = await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, ctx);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].location, '');
  assert.ok(warnings.some((w) => /criteria unavailable/.test(w)));
}));

test('the site pair is cached; a 403 on a cached pair drops it', async () => {
  const store = new Map();
  const idCache = { get: (k) => store.get(k), set: (k, v) => store.set(k, v), delete: (k) => store.delete(k) };
  const first = makeCtx({ idCache });
  await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, first.ctx);
  assert.equal(store.get(`${BOARD}index.html`).id, `${FO_HOST} ${SITE_ID} ${BOARD}details.html`);

  const second = makeCtx({ idCache });
  await talentlink.fetch({ name: 'Acme', careers_url: BOARD }, second.ctx);
  assert.equal(second.calls.filter((c) => c.url.endsWith('index.html') || c.url.endsWith('/config')).length, 0);

  const refused = makeCtx({ idCache, pages: [httpError(403)] });
  await assert.rejects(talentlink.fetch({ name: 'Acme', careers_url: BOARD }, refused.ctx), (e) => e.status === 404);
  assert.equal(store.has(`${BOARD}index.html`), false);
});

test('resolveDetailPage() keeps the configured posting page only on the career page host', () => {
  const board = resolveBoard('https://careers.acme.example/acme_jobsearch.html', { vendorOnly: false });
  assert.equal(resolveDetailPage('details.html', board), 'https://careers.acme.example/details.html');
  assert.equal(resolveDetailPage('https://careers.acme.example/acme_jobdescription.html', board), 'https://careers.acme.example/acme_jobdescription.html');
  for (const bad of ['https://evil.example/details.html', 'http://careers.acme.example/details.html', 'javascript:alert(1)', 'feed.xml', '', null, 42]) {
    assert.equal(resolveDetailPage(bad, board), 'https://careers.acme.example/details.html', String(bad));
  }
  const vendor = resolveBoard('https://acme.recruitmentplatform.com/FO/ABC/components/index.html');
  assert.equal(resolveDetailPage('details.html', vendor), 'https://acme.recruitmentplatform.com/FO/ABC/components/details.html');
  assert.equal(resolveDetailPage('https://acme.recruitmentplatform.com/details.html', resolveBoard(BOARD)), 'https://acme.recruitmentplatform.com/details.html');
});
