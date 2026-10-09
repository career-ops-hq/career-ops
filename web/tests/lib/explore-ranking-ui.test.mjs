import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';
import * as state from '../../src/lib/explore-state.mjs';
import * as explore from '../../src/lib/explore.ts';
import * as exploreAi from '../../src/lib/explore-ai.ts';
import * as marketPresets from '../../src/lib/market-presets.mjs';
import * as freelancePresets from '../../src/lib/freelance-presets.mjs';
import { MAX_OFFER_LIMIT } from '../../src/lib/whats-new.mjs';

await loadBindings();
const require = createRequire(import.meta.url);
let context;
const icon = () => React.createElement('span');
async function load(filename, deps = {}) {
  const { code } = await transform(fs.readFileSync(new URL(`../../src/components/explore/${filename}`, import.meta.url), 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript', tsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => ({
    'lucide-react': new Proxy({}, { get: () => icon }), '@/lib/cn': { cn: (...v) => v.filter(Boolean).join(' ') },
    '@/lib/fonts': { instrumentSerif: { className: 'serif' } }, '@/lib/explore-state.mjs': state,
    './explore-provider': { useExplore: () => context },
    '@/components/jobs/job-store': { useJobs: () => ({ jobs: [], startJob() {} }) },
    '@/components/cost/cost-badge': { CostBadge: () => null }, '@/components/apply/apply-backdrop': { ApplyBackdrop: () => null },
    ...deps,
  }[id] ?? require(id)), module, module.exports);
  return module.exports;
}
const { DiscoveryCard } = await load('discovery-card.tsx');
const { SearchReceipt } = await load('discovering-state.tsx');
const { ResultsList } = await load('results-list.tsx', { './discovery-card': { DiscoveryCard }, './discovering-state': { SearchReceipt } });
const offer = { url: 'https://example.test/job', company: 'Acme', title: 'Sales Assistant', location: 'Lisboa', postedAt: '2026-10-08', source: 'wttj-api', ats: 'wttj-api' };
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const base = () => ({ mode: 'scan', sort: 'match', setSort() {}, sources: {}, searchPhase: 'precise', expansion: null,
  added: new Set(), adding: new Set(), addToPipeline() {}, running: false, companiesScanned: 0 });

test('direct results default to proximity and AI keeps recent/company controls', () => {
  context = base();
  const html = render(ResultsList, { offers: [{ ...offer, inPipeline: false }] });
  assert.match(html, /aria-pressed="true"[^>]*>Proximidade</);
  context.mode = 'ai';
  const ai = render(ResultsList, { offers: [{ ...offer, verification: 'unconfirmed', why: 'Found for your request.', inPipeline: false }] });
  assert.doesNotMatch(ai, />Proximidade</);
  assert.match(ai, /aria-pressed="true"[^>]*>Recentes</);
  assert.match(ai, /Found for your request/);
});

test('active proximity control has readable foreground and a non-color selection cue', () => {
  context = base();
  const html = render(ResultsList, { offers: [{ ...offer, inPipeline: false }] });
  const active = html.match(/<button[^>]*aria-pressed="true"[^>]*>Proximidade<\/button>/)?.[0];
  assert.ok(active);
  assert.match(active, /text-foreground/);
  assert.match(active, /\bunderline\b/);
});

test('proximity band is a named semantic note that exposes the numeric score', () => {
  context = base();
  const html = render(DiscoveryCard, { offer: { ...offer, match: { total: 95, reasons: [] } }, inPipeline: false });
  const band = html.match(/<span[^>]*aria-label="Muito próxima\. Proximidade aos critérios: 95\/100"[^>]*>Muito próxima<\/span>/)?.[0];
  assert.ok(band);
  assert.match(band, /role="note"/);
  assert.match(band, /text-foreground/);
  assert.doesNotMatch(band, /A a F|perfil|>95/);
});

test('proximity bands expose totals accessibly, reasons and only supplied facts', () => {
  context = base();
  for (const [total, label] of [[90, 'Muito próxima'], [70, 'Próxima'], [40, 'Possível']]) {
    const html = render(DiscoveryCard, { offer: { ...offer, match: { total, reasons: ['Função equivalente: Sales Assistant.', 'Localização: mesma cidade (Lisboa).'] } }, inPipeline: false });
    assert.match(html, new RegExp(`>${label}<`));
    assert.match(html, new RegExp(`title="Proximidade aos critérios: ${total}/100"`));
    assert.doesNotMatch(html, new RegExp(`>${total}(?:/100)?<`));
    assert.match(html, /Função equivalente: Sales Assistant/);
    assert.doesNotMatch(html, /Contrato:|Horário:|Prazo:|Vagas:|Salário:/);
  }
  const html = render(DiscoveryCard, { offer: { ...offer, contractType: 'Permanent', hours: '40 h/semana', applicationDeadline: '2026-11-01', vacancyCount: 2,
    salary: { min: 2000, max: 2500, currency: 'EUR', period: 'month' } }, inPipeline: false });
  for (const fact of ['Permanent', '40 h/semana', '2026-11-01', 'Vagas: 2', 'EUR']) assert.ok(html.includes(fact));
});

test('matched-query card text reaches normal-text contrast in light and dark', async t => {
  context = base();
  const html = render(DiscoveryCard, { offer:{ ...offer, matchedKeyword:'Sales Assistant' }, inPipeline:false });
  const node = html.match(/<span class="([^"]+)">Sales Assistant<\/span>/);
  assert.ok(node, 'the actual matchedKeyword branch is rendered');
  const css = fs.readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /--brand-text: hsl\(26 80% 36%\)/);
  assert.match(css, /--brand-text: hsl\(26 73% 51%\)/);
  // Existing theme tokens on the card's bg-surface/40; /80 includes compositing.
  const colors = { 'text-brand/80':{ light:'e39051', dark:'b46122' }, 'text-brand-text':{ light:'a55212', dark:'dd7627' } };
  const luminance = hex => hex.match(/\w\w/g).map(value => parseInt(value,16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  assert.ok(colors[node[1]], 'the matched query uses an existing reviewed theme token');
  for (const [theme, background] of [['light', 'fafaf8'], ['dark', '0f0f0f']]) await t.test(theme, () => {
    const foreground = colors[node[1]][theme];
    const ratio = (Math.max(luminance(background), luminance(foreground)) + .05) / (Math.min(luminance(background), luminance(foreground)) + .05);
    t.diagnostic(`${theme}: #${foreground} on #${background}, ${ratio.toFixed(6)}:1`);
    assert.ok(ratio >= 4.5, `${theme}: ${ratio.toFixed(6)}:1 must reach 4.5:1`);
  });
});

test('settled receipt shows exact expansion and all completed source states/counts', () => {
  context = { ...base(), searchPhase: 'broad', expansion: { changes: ['Funções equivalentes: Retail Assistant.', 'Janela de pesquisa: 7 → 30 dias.'] },
    sources: { wttj: { state: 'ok', matches: 0 }, greenhouse: { state: 'partial', matches: 2, done: 100, total: 150 }, remotive: { state: 'error', message: 'Prazo excedido' } } };
  const html = render(SearchReceipt);
  for (const text of ['Pesquisa alargada', 'Funções equivalentes: Retail Assistant.', '7 → 30 dias.', 'Welcome to the Jungle', '0 anúncios', '2 anúncios', '100 de 150 empresas', 'Parcial', 'Falhou', 'Prazo excedido']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /cobertura.*%/i);
});

test('healthy zero keeps its receipt in the completed explorer layout', async () => {
  context = { ...base(), filters: explore.DEFAULT_FILTERS, offers: [], phase: 'empty-current', initFilters() {}, setMode() {}, setAiIntent() {}, discover() {}, loadFresh() {},
    sources: { wttj: { state: 'ok', matches: 0 } }, searchPhase: 'broad', expansion: { changes: ['Janela de pesquisa: 7 → 30 dias.'] } };
  const placeholder = () => null;
  const { ExplorerView } = await load('explorer-view.tsx', {
    react: { ...React, useEffect() {} }, 'next/link': { default: placeholder }, '@/lib/explore': explore,
    '@/lib/pt-pt': { PT_PT_LOCALE: 'pt-PT' }, '@/lib/core/normalize-text-key.mjs': { normalizeTextKey: value => value },
    './discovering-state': { DiscoveringState: placeholder, SearchReceipt }, './filter-builder': { FilterBuilder: placeholder },
    './ai-hunt-view': { AiHuntView: placeholder }, './explore-mode-toggle': { ExploreModeToggle: placeholder },
    './ai-search-box': { AiSearchBox: placeholder }, './results-list': { ResultsList }, './schedule-job-action': { ScheduleJobAction: placeholder },
  });
  const html = render(ExplorerView, { seed: { filters: explore.DEFAULT_FILTERS, seededFrom: [] }, inboxSnapshot: [], appsSnapshot: [], rootExists: true });
  assert.match(html, /Não foram encontradas ofertas/);
  assert.match(html, /Pesquisa alargada/);
  assert.match(html, /0 anúncios/);
});

test('settled first-run token status has normal-text contrast without changing its dark color', async () => {
  context = { ...base(), filters:explore.DEFAULT_FILTERS, offers:[], phase:'results', initFilters() {}, setMode() {}, setAiIntent() {}, discover() {}, loadFresh() {} };
  const placeholder = () => null;
  const { ExplorerView } = await load('explorer-view.tsx', {
    react: { ...React, useEffect() {}, useState:initial => [typeof initial === 'boolean' ? true : initial, () => {}] },
    'next/link': { default:placeholder }, '@/lib/explore':explore,
    '@/lib/pt-pt': { PT_PT_LOCALE:'pt-PT' }, '@/lib/core/normalize-text-key.mjs': { normalizeTextKey:value => value },
    './discovering-state': { DiscoveringState:placeholder, SearchReceipt }, './filter-builder': { FilterBuilder:placeholder },
    './ai-hunt-view': { AiHuntView:placeholder }, './explore-mode-toggle': { ExploreModeToggle:placeholder },
    './ai-search-box': { AiSearchBox:placeholder }, './results-list': { ResultsList }, './schedule-job-action': { ScheduleJobAction:placeholder },
  });
  const html = render(ExplorerView, { seed:{ filters:explore.DEFAULT_FILTERS, seededFrom:[] }, inboxSnapshot:[], appsSnapshot:[], rootExists:true });
  const status = html.match(/<span[^>]*>A pesquisa não usou tokens\.<\/span>/)?.[0];
  assert.ok(status, 'the settled first-run banner must be rendered');
  assert.match(status, /dark:text-emerald-400/);
  // sRGB values of the existing Tailwind tokens, on the measured light banner.
  const palette = { 600:'009966', 700:'007a55', 800:'006045' };
  const foreground = palette[status.match(/\bclass="text-emerald-(\d+)/)?.[1]];
  assert.ok(foreground, 'the light status must use a reviewed green token');
  const luminance = hex => {
    const [r, g, b] = hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const ratio = (luminance('def0e7') + .05) / (luminance(foreground) + .05);
  assert.ok(ratio >= 4.5, `normal text contrast ${ratio.toFixed(3)}:1 must reach 4.5:1`);
});

test('expanded partial search names the populated role input and keeps every flagged node readable', async t => {
  const filters = { ...explore.DEFAULT_FILTERS, positive:['Partial verification', 'Operador de Loja'], allow:['Lisboa'], ats:[], markets:['portugal'] };
  context = { ...base(), filters, offers:[], phase:'degraded', partial:true, companiesScanned:1, initFilters() {}, setMode() {}, setAiIntent() {}, discover() {}, loadFresh() {},
    sources:{ 'Auchan Portugal':{ state:'error', message:'Falha parcial sintética: fonte indisponível.' } } };
  const placeholder = () => null;
  const { FilterBuilder } = await load('filter-builder.tsx', {
    '@/lib/explore':explore, '@/lib/market-presets.mjs':marketPresets, '@/lib/freelance-presets.mjs':freelancePresets,
  });
  const { ExplorerView } = await load('explorer-view.tsx', {
    react:{ ...React, useEffect() {} }, 'next/link':{ default:placeholder }, '@/lib/explore':explore,
    '@/lib/pt-pt':{ PT_PT_LOCALE:'pt-PT' }, '@/lib/core/normalize-text-key.mjs':{ normalizeTextKey:value => value },
    './discovering-state':{ DiscoveringState:placeholder, SearchReceipt }, './filter-builder':{ FilterBuilder },
    './ai-hunt-view':{ AiHuntView:placeholder }, './explore-mode-toggle':{ ExploreModeToggle:placeholder },
    './ai-search-box':{ AiSearchBox:placeholder }, './results-list':{ ResultsList }, './schedule-job-action':{ ScheduleJobAction:placeholder },
  });
  const html = render(ExplorerView, { seed:{ filters, seededFrom:[] }, inboxSnapshot:[], appsSnapshot:[], rootExists:true });
  await t.test('populated role input keeps the visible field name without a placeholder', () => {
    const input = html.match(/<input[^>]*placeholder=""[^>]*>/)?.[0];
    assert.ok(input);
    assert.match(input, /aria-label="Funções a procurar"/);
  });
  const colors = { 'text-brand':'dd7627', 'text-brand-text':'a55212', 'text-foreground':'1f1c19', 'text-amber-700':'bb4d00', 'text-amber-800':'973c00',
    'hsl(26 78% 42%)':'bf6018', 'var(--brand-text)':'a55212' };
  const luminance = hex => {
    const [r, g, b] = hex.match(/\w\w/g).map(value => parseInt(value,16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const retry = Array.from(html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g), match => match[0]).find(node => node.includes('Repetir pesquisa'));
  const candidates = [
    ['Emprego', html.match(/<button[^>]*>Emprego<\/button>/)?.[0], 'f7ebe1'],
    ...Array.from(html.matchAll(/<span class="co-fb__chip inc">([^<]+)/g), match => [match[1], match[0], 'f8ece3']),
    ['7d', html.match(/<button[^>]*>7d<\/button>/)?.[0], 'f7ebe1'],
    ['partial source reason', html.match(/<p[^>]*>Auchan Portugal: Falha parcial sintética: fonte indisponível\.<\/p>/)?.[0], 'f8eddb'],
    ['Repetir pesquisa', retry, 'f5dfc5'],
  ];
  assert.equal(candidates.length, 7, 'the complete seven-node production contrast finding is represented');
  for (const [name, node, background] of candidates) await t.test(`${name} reaches 4.5:1`, () => {
    assert.ok(node, name);
    const cssColor = node.includes('co-fb__chip inc') ? html.match(/\.co-fb__chip\.inc\{color:([^;]+)/)?.[1]
      : node.match(/class="([^"]+)"/)?.[1].split(' ').find(token => token in colors);
    const foreground = colors[cssColor];
    assert.ok(foreground, `reviewed foreground for ${name}`);
    const ratio = (luminance(background) + .05) / (luminance(foreground) + .05);
    t.diagnostic(`${name}: ${ratio.toFixed(6)}:1`);
    assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(6)}:1 must reach 4.5:1`);
    if (name === 'partial source reason') assert.match(node, /dark:text-amber-300/);
    if (name === 'Repetir pesquisa') assert.match(node, /dark:text-brand\b/);
  });
  assert.match(html, /html\.dark \.co-fb__chip\.inc\{color:hsl\(26 86% 70%\)/, 'dark chip color is preserved');
});

test('provider persists final ranked cards and broad receipt separately for each opportunity type', async t => {
  const slots = [], effects = [], stored = new Map(), requested = [], urls = [], pipelinePayloads = [];
  let cursor = 0;
  const restore = (name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  };
  restore('sessionStorage', { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) });
  restore('localStorage', { getItem: () => JSON.stringify({ cliId: 'codex' }) });
  restore('window', { history: { replaceState: (_a, _b, url) => urls.push(url) }, setTimeout: fn => fn(), dispatchEvent() {} });
  const expansion = { phase: 'broad', changes: ['Janela de pesquisa: 7 → 30 dias.'], originalSinceDays: 7, effectiveSinceDays: 30, termsAdded: [], locationsAdded: [] };
  restore('fetch', async (url, options) => {
    if (url === '/api/explore/ai/known') return new Response(JSON.stringify({ urls: [] }));
    if (url === '/api/explore/ai') return new Response(`<<offer:${JSON.stringify({ ...offer, why: 'Public role.' })}>>`);
    if (url === '/api/explore/add') {
      pipelinePayloads.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ added:1 }));
    }
    requested.push([url, JSON.parse(options.body).opportunityType]);
    const events = [
      { kind: 'phaseStart', phase: 'precise', sinceDays: 7, free: true },
      { kind: 'sourceDone', source: 'wttj', count: 0 },
      { kind: 'expansion', ...expansion },
      { kind: 'phaseStart', phase: 'broad', sinceDays: 30, free: true },
      { kind: 'offer', offer }, { kind: 'offer', offer: { ...offer, location: '' } },
      { kind: 'sourceDone', source: 'wttj', count: 1 },
      { kind: 'summary', companiesScanned: 1, unreachable: 0, matches: 1, status: 'ok', sources: [{ source: 'wttj', state: 'ok' }] },
      { kind: 'done', offers: [{ ...offer, vacancyCount: 2, match: { total: 95, components: { role: 60, location: 25, freshness: 5, evidence: 5 }, reasons: ['Função pedida.'] } }], count: 1 },
    ];
    return new Response(events.map(event => JSON.stringify(event)).join('\n') + '\n');
  });
  const hooks = { ...React, useState(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
    return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
  }, useRef(initial) {
    const index = cursor++;
    if (!(index in slots)) slots[index] = { current: initial };
    return slots[index];
  }, useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => effects.push(fn) };
  const { ExploreProvider } = await load('explore-provider.tsx', {
    react: hooks, 'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@/lib/explore': explore,
    '@/lib/explore-ai': exploreAi, '@/lib/whats-new.mjs': {}, '@/lib/explore-error.mjs': {},
  });
  const renderProvider = () => { cursor = 0; effects.length = 0; return ExploreProvider({ children: null }).props.value; };
  let ctx = renderProvider();
  ctx.initFilters({ ...explore.DEFAULT_FILTERS, ats: [], markets: ['portugal'] });
  await renderProvider().discover();
  ctx = renderProvider();
  assert.equal(ctx.phase, 'results');
  assert.equal(ctx.offers.length, 1);
  assert.equal(ctx.offers[0].match.total, 95);
  assert.equal(ctx.offers[0].vacancyCount, 2);
  assert.equal(ctx.searchPhase, 'broad');
  assert.deepEqual(ctx.expansion, expansion);
  assert.deepEqual(ctx.sources.wttj, { state: 'ok', matches: 1, message: undefined });
  effects.at(-1)();
  ctx.setFilters({ ...ctx.filters, opportunityType: 'freelance' });
  ctx = renderProvider();
  assert.deepEqual(ctx.offers, []);
  assert.equal(ctx.expansion, null);
  ctx.setFilters({ ...ctx.filters, opportunityType: 'employment' });
  assert.equal(renderProvider().offers[0].match.total, 95);
  assert.deepEqual(requested, [['/api/explore', 'employment']]);
  ctx = renderProvider();
  ctx.setFilters({ ...ctx.filters, opportunityType: 'freelance' });
  ctx = renderProvider();
  ctx.setMode('ai');
  ctx.setAiIntent('Find Flutter');
  await renderProvider().discoverAI();
  const sp = new URL(urls.at(-1), 'https://example.test').searchParams;
  assert.equal(sp.get('opportunity'), 'freelance', 'starting assisted search keeps the active type reloadable');
  assert.equal(sp.get('mode'), 'ai');
  assert.equal(sp.get('intent'), 'Find Flutter');
  assert.equal(renderProvider().offers[0].verification, 'unconfirmed');
  ctx = renderProvider();
  assert.equal(ctx.offers[0].opportunityType, 'freelance', 'assisted parser results retain the active type');
  context = ctx;
  const html = render(DiscoveryCard, { offer:ctx.offers[0], inPipeline:false });
  assert.match(html, /Guardar oportunidade/);
  assert.doesNotMatch(html, />Avaliar /);
  effects.at(-1)();
  const saved = JSON.parse(stored.get('career-ops:explore-results:freelance'));
  assert.equal(saved.offers[0].opportunityType, 'freelance');
  await ctx.addToPipeline(ctx.offers);
  assert.equal(pipelinePayloads[0].offers[0].opportunityType, 'freelance');
});

test('child URL initialization survives the parent mount hydration with and without a saved snapshot', async t => {
  const stored = new Map(), requested = [];
  for (const [name, value] of Object.entries({
    window: { location: { search: '?mode=ai&opportunity=freelance&q=Flutter&intent=Find%20Flutter' } },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
    fetch: async url => {
      requested.push(url);
      return new Response(JSON.stringify({ offers: [], count: 0 }));
    },
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  let owner, cursor, ctx;
  const slots = { parent: [], child: [] }, effects = { parent: [], child: [] };
  const hooks = { ...React, useState(initial) {
    const bucket = slots[owner], index = cursor++;
    if (!(index in bucket)) bucket[index] = typeof initial === 'function' ? initial() : initial;
    return [bucket[index], next => { bucket[index] = typeof next === 'function' ? next(bucket[index]) : next; }];
  }, useRef(initial) {
    const bucket = slots[owner], index = cursor++;
    if (!(index in bucket)) bucket[index] = { current: initial };
    return bucket[index];
  }, useContext: () => ctx, useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => effects[owner].push(fn) };
  const provider = await load('explore-provider.tsx', {
    react: hooks, 'next/navigation': { useRouter: () => ({ refresh() {} }) }, '@/lib/explore': explore,
    '@/lib/explore-ai': exploreAi, '@/lib/whats-new.mjs': { MAX_OFFER_LIMIT }, '@/lib/explore-error.mjs': {},
  });
  const placeholder = () => null;
  const { AiSearchBox } = await load('ai-search-box.tsx', { react: hooks });
  const { ExplorerView } = await load('explorer-view.tsx', {
    react: hooks, 'next/link': { default: placeholder }, '@/lib/explore': explore, './explore-provider': provider,
    '@/lib/pt-pt': { PT_PT_LOCALE: 'pt-PT' }, '@/lib/core/normalize-text-key.mjs': { normalizeTextKey: value => value },
    './discovering-state': { DiscoveringState: placeholder, SearchReceipt: placeholder }, './filter-builder': { FilterBuilder: placeholder },
    './ai-hunt-view': { AiHuntView: placeholder }, './explore-mode-toggle': { ExploreModeToggle: placeholder },
    './ai-search-box': { AiSearchBox }, './results-list': { ResultsList: placeholder }, './schedule-job-action': { ScheduleJobAction: placeholder },
  });
  const renderParent = () => { owner = 'parent'; cursor = 0; effects.parent.length = 0; ctx = provider.ExploreProvider({ children: null }).props.value; };
  for (const saved of [false, true]) {
    slots.parent.length = slots.child.length = effects.child.length = 0;
    stored.clear();
    if (saved) stored.set('career-ops:explore-results:freelance', JSON.stringify({
      v: 1, mode: 'scan', phase: 'results', offers: [offer], sort: 'company', searchPhase: 'broad',
      sources: { wttj: { state: 'ok', matches: 1 } }, aiIntent: 'Saved intent',
    }));
    renderParent();
    owner = 'child'; cursor = 0;
    ExplorerView({ seed: { filters: explore.DEFAULT_FILTERS, seededFrom: [] }, inboxSnapshot: [], appsSnapshot: [], rootExists: true });
    // React commits passive effects from the mounted child before its parent.
    effects.child.forEach(effect => effect());
    effects.parent.forEach(effect => effect());
    renderParent();
    assert.equal(ctx.mode, 'ai', `explicit URL mode wins (saved snapshot: ${saved})`);
    assert.equal(ctx.aiIntent, 'Find Flutter');
    assert.equal(ctx.filters.opportunityType, 'freelance');
    assert.deepEqual(ctx.filters.positive, ['Flutter']);
    assert.equal(ctx.offers.length, saved ? 1 : 0);
    assert.equal(ctx.sort, saved ? 'company' : 'match');
  }
  await t.test('view=fresh overrides a saved assisted employment snapshot after child-before-parent hydration', async () => {
    slots.parent.length = slots.child.length = effects.child.length = 0;
    stored.clear();
    window.location.search = '?view=fresh';
    const filters = { ...explore.DEFAULT_FILTERS, positive: ['Operador de Loja'], allow: ['Lisboa'] };
    stored.set('career-ops:explore-results:employment', JSON.stringify({
      v: 1, mode: 'ai', phase: 'results', filters, offers: [offer], sort: 'company',
      aiIntent: 'Snapshot assistido sintético view=fresh',
    }));
    const props = { seed: { filters, seededFrom: [] }, inboxSnapshot: [], appsSnapshot: [], rootExists: true };
    renderParent();
    owner = 'child'; cursor = 0;
    ExplorerView(props);
    effects.child.forEach(effect => effect());
    effects.parent.forEach(effect => effect());
    await new Promise(resolve => setImmediate(resolve));
    renderParent();
    assert.equal(ctx.mode, 'scan', 'explicit fresh view wins over the restored assisted mode');
    assert.equal(ctx.aiIntent, '');
    assert.deepEqual(ctx.filters, filters);
    assert.equal(ctx.sort, 'fresh');
    assert.equal(ctx.phase, 'empty-current');
    assert.deepEqual(ctx.offers, []);
    assert.deepEqual(requested, [`/api/whats-new?limit=${MAX_OFFER_LIMIT}`], 'fresh load never starts assisted search');
    owner = 'child'; cursor = 0;
    const html = render(ExplorerView, props);
    assert.doesNotMatch(html, /Pesquisar na web|Snapshot assistido sintético|<textarea/);
    assert.match(html, /Não foram encontradas ofertas/);
  });
  for (const search of ['?mode=scan', '?q=Sales%20Assistant&ats=greenhouse&markets=', '']) {
    await t.test(`direct URL intent wins after hydration while plain navigation may restore AI: ${search || 'plain'}`, () => {
      slots.parent.length = slots.child.length = effects.child.length = 0;
      stored.clear();
      window.location.search = search;
      stored.set('career-ops:explore-results:employment', JSON.stringify({
        v:1, mode:'ai', phase:'results', offers:[offer], aiIntent:'Saved assisted intent',
      }));
      renderParent();
      owner = 'child'; cursor = 0;
      ExplorerView({ seed:{ filters:explore.DEFAULT_FILTERS, seededFrom:[] }, inboxSnapshot:[], appsSnapshot:[], rootExists:true });
      effects.child.forEach(effect => effect());
      effects.parent.forEach(effect => effect());
      renderParent();
      assert.equal(ctx.mode, search ? 'scan' : 'ai');
      assert.equal(ctx.aiIntent, search ? '' : 'Saved assisted intent');
      assert.equal(ctx.offers.length, 1, 'hydrated results survive explicit surface selection');
    });
  }
});
