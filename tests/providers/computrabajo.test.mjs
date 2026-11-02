// tests/providers/computrabajo.test.mjs: Computrabajo provider (providers/computrabajo.mjs).
// Offline only. The card fixture reproduces the markup measured on
// co.computrabajo.com on 2026-10-23 (structure kept, attributes trimmed);
// company and title values are fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import provider, { parseCards, resolveListUrl } from '../../providers/computrabajo.mjs';

const BASE = 'https://co.computrabajo.com/trabajo-de-sistemas';

function card(id, { title = `Ingeniero de integraci&#xF3;n ${id} &amp; IA`, company = `Acme ${id} &amp; Co`, location = 'Bogot&#xE1;, D.C.', featured = false } = {}) {
  return `
  <article class="box_offer ${featured ? ' outstanding' : ''}" data-id='${id}' data-blind="false" id="${id}">
    ${featured ? '<div class="list_dot mb15"><span class="fc_dest">Empleo destacado</span></div>' : ''}
    <h2 class="fs18 fwB prB">
      <a class="js-o-link fc_base" href="/ofertas-de-trabajo/oferta-de-trabajo-de-ingeniero-${id}#lc=ListOffers-Score4-0">
        ${title}
      </a>
    </h2>
    <p class="dFlex vm_fx fs16 fc_base mt5">
      ${company === null ? 'Importante empresa del sector' : `<a class="fc_base t_ellipsis" href="https://co.computrabajo.com/empresas/acme" offer-grid-article-company-url>${company}</a>`}
    </p>
    <p class="fs16 fc_base mt5"><span class="mr10">${location}</span></p>
    <div class="opt_dots"><span data-href-access="https://candidato.co.computrabajo.com/acceso/">Aplicar</span></div>
  </article>`;
}

function page(...cards) {
  return `<html><head><title>Trabajo de sistemas | Portal de Empleo Computrabajo</title></head><body>${cards.join('\n')}</body></html>`;
}

/** A ctx whose fetchText answers from `pages` (keyed by ?p=N) and records every call. */
function makeCtx(pages, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      sleep: async () => {},
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        const p = Number(new URL(url).searchParams.get('p'));
        const body = pages[p];
        if (body instanceof Error) throw body;
        return body ?? page();
      },
      ...extra,
    },
  };
}

test('id is computrabajo', () => {
  assert.equal(provider.id, 'computrabajo');
});

test('detect() claims https country hosts only and never throws', () => {
  assert.deepEqual(provider.detect({ careers_url: BASE }), { url: BASE });
  assert.deepEqual(provider.detect({ careers_url: 'https://mx.computrabajo.com/trabajo-de-ingeniero' }), { url: 'https://mx.computrabajo.com/trabajo-de-ingeniero' });
  // CodeQL "incomplete URL substring sanitization": the host must BE computrabajo, not contain it.
  for (const careers_url of [
    'https://evil.example/?u=co.computrabajo.com',
    'https://co.computrabajo.com.evil.example/x',
    'https://evilcomputrabajo.com/x',
    'https://candidato.co.computrabajo.com/acceso/',
    'http://co.computrabajo.com/trabajo-de-sistemas',
    'not a url',
    '',
  ]) {
    assert.equal(provider.detect({ careers_url }), null, careers_url);
  }
  assert.equal(provider.detect({}), null);
  assert.equal(provider.detect(null), null);
  assert.equal(provider.detect({ careers_url: 42 }), null);
});

test('resolveListUrl drops port and credentials', () => {
  assert.equal(resolveListUrl('https://u:p@co.computrabajo.com:8443/trabajo-de-sistemas?q=1').href, 'https://co.computrabajo.com/trabajo-de-sistemas?q=1');
});

test('fetch() refuses a non-Computrabajo URL before any request', async () => {
  const { ctx, calls } = makeCtx({});
  await assert.rejects(provider.fetch({ name: 'X', provider: 'computrabajo', careers_url: 'https://evil.example/trabajo' }, ctx), /not a Computrabajo country host/);
  await assert.rejects(provider.fetch({ name: 'X', provider: 'computrabajo', careers_url: 'http://co.computrabajo.com/x' }, ctx), /https/);
  assert.equal(calls.length, 0);
});

test('fetch() keeps the real employer, decodes entities, drops the fragment and passes redirect: error', async () => {
  const { ctx, calls } = makeCtx({ 1: page(card('A1', { featured: true }), card('A2', { company: null })) });
  const jobs = await provider.fetch({ name: 'Computrabajo Colombia', careers_url: `${BASE}?foo=bar` }, ctx);

  assert.equal(new URL(calls[0].url).searchParams.get('foo'), 'bar');
  assert.equal(new URL(calls[0].url).searchParams.get('by'), 'publicationtime');
  assert.ok(calls.every((c) => c.opts.redirect === 'error'), 'every request passes redirect: error');
  assert.ok(calls.every((c) => !('User-Agent' in (c.opts.headers || {}))), 'no provider-set User-Agent');
  assert.deepEqual(jobs, [
    {
      title: 'Ingeniero de integración A1 & IA',
      url: 'https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-ingeniero-A1',
      company: 'Acme A1 & Co',
      location: 'Bogotá, D.C.',
    },
    {
      title: 'Ingeniero de integración A2 & IA',
      url: 'https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-ingeniero-A2',
      // "Importante empresa del sector": a hidden employer, never the board's name
      company: '?',
      location: 'Bogotá, D.C.',
    },
  ]);
});

test('fetch() enforces the 3-page / 15-posting crawl caps and paces with the shared sleep', async () => {
  const many = (p) => page(...Array.from({ length: 20 }, (_, i) => card(`P${p}-${i}`)));
  const slept = [];
  const { ctx, calls } = makeCtx({ 1: page(card('X1'), card('X2')), 2: page(card('X3')), 3: page(card('X4')), 4: page(card('X5')) });
  ctx.sleep = async (ms) => { slept.push(ms); };
  const jobs = await provider.fetch({ name: 'X', careers_url: BASE, max_pages: 999, max_jobs: 999 }, ctx);
  assert.equal(calls.length, 3);
  assert.equal(jobs.length, 4);
  assert.equal(slept.length, 2, 'a pause between pages, none before the first');
  assert.ok(slept.every((ms) => ms >= 2000 && ms <= 5000));

  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    const capped = makeCtx({ 1: many(1), 2: many(2) });
    const out = await provider.fetch({ name: 'X', careers_url: BASE }, capped.ctx);
    assert.equal(out.length, 15);
    assert.equal(capped.calls.length, 1);
    assert.match(warnings.join('\n'), /crawl limit/);
  } finally {
    console.warn = warn;
  }
});

test('fetch() stops when a page brings no new ids (ignored page parameter)', async () => {
  const same = page(card('S1'), card('S2'));
  const { ctx, calls } = makeCtx({ 1: same, 2: same, 3: same });
  const jobs = await provider.fetch({ name: 'X', careers_url: BASE }, ctx);
  assert.equal(jobs.length, 2);
  assert.equal(calls.length, 2);
});

test('empty search -> [], markup change -> throw, challenge -> throw', async () => {
  assert.deepEqual(await provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: page() }).ctx), []);

  const changed = page('<div class="new_card"><a href="/ofertas-de-trabajo/oferta-de-trabajo-de-x-1">X</a></div>');
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: changed }).ctx), /markup change/);

  const challenge = '<html><head><title>Just a moment...</title></head><body><div id="cf-challenge-running"></div></body></html>';
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: challenge }).ctx), /anti-bot challenge/);
});

test('generic "cloudflare" / "captcha" words on a normal page do not abort it', async () => {
  const html = page(card('C1')).replace('<body>', '<body><script src="https://cdnjs.cloudflare.com/x.js"></script><div class="g-recaptcha"></div>');
  const jobs = await provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: html }).ctx);
  assert.equal(jobs.length, 1);
});

test('a challenge on a later page keeps the earlier pages and warns', async () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    const challenge = '<html><head><title>Attention Required! | Cloudflare</title></head></html>';
    const jobs = await provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: page(card('L1')), 2: challenge }).ctx);
    assert.equal(jobs.length, 1);
    assert.match(warnings.join('\n'), /anti-bot challenge on page 2/);
  } finally {
    console.warn = warn;
  }
});

test('a page-1 fetch error is thrown; a later one keeps the earlier pages', async () => {
  const boom = Object.assign(new Error('HTTP 404'), { status: 404 });
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: boom }).ctx), /HTTP 404/);

  const warn = console.warn;
  console.warn = () => {};
  try {
    const jobs = await provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: page(card('E1')), 2: boom }).ctx);
    assert.equal(jobs.length, 1);
  } finally {
    console.warn = warn;
  }
});

test('health probe: ctx.maxPages 1 makes exactly one request and propagates a rejection unwrapped', async () => {
  const probe = makeCtx({ 1: page(card('H1')), 2: page(card('H2')) }, { maxPages: 1 });
  await provider.fetch({ name: 'X', careers_url: BASE }, probe.ctx);
  assert.equal(probe.calls.length, 1);

  class ProbePageBudgetReached extends Error {}
  const sentinel = new ProbePageBudgetReached('budget');
  const failing = makeCtx({ 1: sentinel }, { maxPages: 1 });
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, failing.ctx), (err) => err === sentinel);
  assert.equal(failing.calls.length, 1, 'no retry while probing');
});

test('parseCards ignores non-posting links and non-card articles', () => {
  const html = `<article class="other"><a href="/ofertas-de-trabajo/oferta-de-trabajo-de-x-9">Nope</a></article>
    <a href="/trabajo-de-sistemas-en-bogota">Bogota</a>${card('K1')}`;
  const cards = parseCards(html, 'https://co.computrabajo.com');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 'K1');
});

test('computrabajo keeps a sort order the user put in the URL', async () => {
  const { ctx, calls } = makeCtx({ 1: page(card('S1')) });
  await provider.fetch({ name: 'Computrabajo Colombia', careers_url: `${BASE}?by=salary` }, ctx);
  assert.equal(new URL(calls[0].url).searchParams.get('by'), 'salary');
});

test('computrabajo adds no sort under /ofertas-de-trabajo/, which robots.txt keeps free of by=', async () => {
  const { ctx, calls } = makeCtx({ 1: page(card('R1')) });
  await provider.fetch({ name: 'Computrabajo Colombia', careers_url: 'https://co.computrabajo.com/ofertas-de-trabajo/?q=python' }, ctx);
  assert.equal(new URL(calls[0].url).searchParams.has('by'), false);
});

test('computrabajo drops a by= the user put under /ofertas-de-trabajo/', async () => {
  const { ctx, calls } = makeCtx({ 1: page(card('R2')) });
  await provider.fetch({ name: 'Computrabajo Colombia', careers_url: 'https://co.computrabajo.com/ofertas-de-trabajo/?q=python&by=salary' }, ctx);
  assert.equal(new URL(calls[0].url).searchParams.has('by'), false);
  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'python');
});
