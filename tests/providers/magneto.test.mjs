// tests/providers/magneto.test.mjs: Magneto365 provider (providers/magneto.mjs).
// Offline only. The fixture reproduces the markup measured on
// www.magneto365.com/co/trabajos/buscar/tecnologia on 2026-10-23 (class names
// shortened); titles and companies are fictional.
import test from 'node:test';
import assert from 'node:assert/strict';
import provider, { buildPageUrl, parseCards, resolveListUrl } from '../../providers/magneto.mjs';

const BASE = 'https://www.magneto365.com/co/trabajos/buscar/tecnologia';

function card(id, { title = `Desarrollador Backend ${id}`, company = 'Acme S.A.S', location = 'Medellín' } = {}) {
  const href = `https://www.magneto365.com/co/empleos/desarrollador-backend-${id}`;
  return `<div class="mg_job_card_desktop_magneto-ui-card-jobs_container_13c81"><article class="mg_job_card_desktop_magneto-ui-card-jobs_13c81 "><div>`
    + `<h2 class="mg_job_card_desktop_magneto-ui-card-jobs_text_13c81"><a href="${href}" title="${title}" target="_blank" rel="noreferrer">${title}</a></h2>`
    + `<h3 class="mg_job_card_desktop_magneto-ui-card-jobs_text_13c81 ">${company} | Por obra o labor</h3>`
    + `<p class="mg_job_card_desktop_magneto-ui-card-jobs_text_13c81 ">$ 4.000.000, </p>`
    + `<p class="mg_job_card_desktop_magneto-ui-card-jobs_text_13c81 ">${location}</p>`
    + `</div></article></div>`;
}

// The listing page links its own category, search and pagination pages under
// /co/trabajos/..., and the detail-preview panel is an <article> too.
const NAV = `<nav><a href="https://www.magneto365.com/co/trabajos/empleos-por-ciudades">Empleos por ubicación</a>`
  + `<a href="https://www.magneto365.com/co/trabajos">/ trabajos</a>`
  + `<a href="https://www.magneto365.com/co/trabajos/buscar">/ buscar</a>`
  + `<a href="${BASE}?paginator[page]=2">2</a></nav>`;
const PREVIEW = `<article class="mg_job_details_magneto-ui-job-details"><a href="https://www.magneto365.com/co/empleos/desarrollador-backend-1">Expandir</a><p>Compartir en:</p></article>`;

function page(...cards) {
  return `<html><body>${NAV}<div class="results">${cards.join('')}</div>${PREVIEW}</body></html>`;
}

function makeCtx(pages, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      sleep: async () => {},
      fetchText: async (url, opts) => {
        calls.push({ url, opts });
        const p = Number(new URL(url).searchParams.get('paginator[page]'));
        const body = pages[p];
        if (body instanceof Error) throw body;
        return body ?? '<html><body></body></html>';
      },
      ...extra,
    },
  };
}

test('id is magneto', () => {
  assert.equal(provider.id, 'magneto');
});

test('detect() claims magneto365.com over https only and never throws', () => {
  assert.deepEqual(provider.detect({ careers_url: BASE }), { url: BASE });
  for (const careers_url of [
    'https://evil.example/?u=magneto365.com',
    'https://www.magneto365.com.evil.example/co/',
    'https://notmagneto365.com/co/',
    'http://www.magneto365.com/co/trabajos/buscar/tecnologia',
    'https://www.magneto365.com@evil.example/co/',
    '::',
  ]) {
    assert.equal(provider.detect({ careers_url }), null, careers_url);
  }
  assert.equal(provider.detect({}), null);
  assert.equal(provider.detect(null), null);
  assert.equal(provider.detect({ careers_url: ['x'] }), null);
});

test('resolveListUrl drops port and credentials', () => {
  assert.equal(resolveListUrl('https://u:p@www.magneto365.com:8443/co/trabajos/buscar/tecnologia?q=1').href, 'https://www.magneto365.com/co/trabajos/buscar/tecnologia?q=1');
});

test('fetch() refuses a foreign host before any request', async () => {
  const { ctx, calls } = makeCtx({});
  await assert.rejects(provider.fetch({ name: 'X', provider: 'magneto', careers_url: 'https://evil.example/co/trabajos' }, ctx), /not a magneto365.com host/);
  assert.equal(calls.length, 0);
});

test('buildPageUrl uses the pager shape ?paginator[page]=N and replaces an existing one', () => {
  assert.equal(buildPageUrl(resolveListUrl(BASE), 2), `${BASE}?paginator[page]=2`);
  assert.equal(buildPageUrl(resolveListUrl(`${BASE}?orden=fecha&paginator[page]=7`), 3), `${BASE}?orden=fecha&paginator[page]=3`);
});

test('parses /trabajos/buscar/tecnologia: postings only, never the nav, search or preview links', async () => {
  const { ctx, calls } = makeCtx({ 1: page(card(1110175, { company: 'Job&amp;Talent Colombia' }), card(1108924, { title: 'Ingenier&#237;a de datos', location: 'Bogotá, D.C.' })) });
  const jobs = await provider.fetch({ name: 'Magneto365', careers_url: BASE }, ctx);
  assert.deepEqual(jobs, [
    {
      title: 'Desarrollador Backend 1110175',
      url: 'https://www.magneto365.com/co/empleos/desarrollador-backend-1110175',
      company: 'Job&Talent Colombia',
      location: 'Medellín',
    },
    {
      title: 'Ingeniería de datos',
      url: 'https://www.magneto365.com/co/empleos/desarrollador-backend-1108924',
      company: 'Acme S.A.S',
      location: 'Bogotá, D.C.',
    },
  ]);
  assert.equal(calls[0].url, `${BASE}?paginator[page]=1`);
  assert.ok(calls.every((c) => c.opts.redirect === 'error'), 'every request passes redirect: error');
  assert.ok(calls.every((c) => !('User-Agent' in (c.opts.headers || {}))), 'no provider-set User-Agent');
});

test('"Confidencial" and the board\'s own name become ?, never the entry name', () => {
  const cards = parseCards(page(card(1, { company: 'Confidencial' }), card(2, { company: 'Magneto empleos' }), card(3)), 'https://www.magneto365.com');
  assert.deepEqual(cards.map((c) => c.company), ['?', '?', 'Acme S.A.S']);
});

test('pagination stops on a page with no new ids and honours max_pages', async () => {
  const p1 = page(card(1), card(2));
  const repeat = makeCtx({ 1: p1, 2: p1 });
  assert.equal((await provider.fetch({ name: 'X', careers_url: BASE }, repeat.ctx)).length, 2);
  assert.equal(repeat.calls.length, 2);

  const walk = makeCtx({ 1: page(card(1)), 2: page(card(2)), 3: page(card(3)) });
  assert.equal((await provider.fetch({ name: 'X', careers_url: BASE, max_pages: 2 }, walk.ctx)).length, 2);
  assert.equal(walk.calls.length, 2);
});

test('empty search -> [], markup change -> throw', async () => {
  assert.deepEqual(await provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: `<html><body>${NAV}</body></html>` }).ctx), []);
  const changed = `<html><body><div class="new-card"><a href="https://www.magneto365.com/co/empleos/analista-55">Analista</a></div></body></html>`;
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: changed }).ctx), /markup change/);
});

test('a page-1 fetch error is thrown; a later one keeps the earlier pages', async () => {
  const boom = Object.assign(new Error('HTTP 503'), { status: 503 });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: boom }).ctx), /HTTP 503/);
    const jobs = await provider.fetch({ name: 'X', careers_url: BASE }, makeCtx({ 1: page(card(1)), 2: boom }).ctx);
    assert.equal(jobs.length, 1);
  } finally {
    console.warn = warn;
  }
});

test('health probe: ctx.maxPages 1 makes exactly one request and propagates a rejection unwrapped', async () => {
  const probe = makeCtx({ 1: page(card(1)), 2: page(card(2)) }, { maxPages: 1 });
  await provider.fetch({ name: 'X', careers_url: BASE }, probe.ctx);
  assert.equal(probe.calls.length, 1);

  const sentinel = new Error('budget');
  const failing = makeCtx({ 1: sentinel }, { maxPages: 1 });
  await assert.rejects(provider.fetch({ name: 'X', careers_url: BASE }, failing.ctx), (err) => err === sentinel);
  assert.equal(failing.calls.length, 1);
});

test('default limits: five full pages of 20 reach max_jobs 100 and warn that the search has more results', async () => {
  const full = (from) => page(...Array.from({ length: 20 }, (_, i) => card(from + i)));
  const pages = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, full((n - 1) * 20 + 1)]));
  const warnings = [];
  const warn = console.warn;
  console.warn = (msg) => warnings.push(String(msg));
  try {
    const { ctx, calls } = makeCtx(pages);
    const jobs = await provider.fetch({ name: 'X', careers_url: BASE }, ctx);
    assert.equal(jobs.length, 100);
    assert.equal(calls.length, 5);
    assert.equal(warnings.filter((w) => /the search has more results/.test(w)).length, 1);
  } finally {
    console.warn = warn;
  }
});
