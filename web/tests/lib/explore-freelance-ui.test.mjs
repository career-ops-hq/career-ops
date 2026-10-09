import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadBindings, transform } from "next/dist/build/swc/index.js";
import * as explore from "../../src/lib/explore.ts";
import * as discoveryState from "../../src/lib/explore-state.mjs";
import * as marketPresets from "../../src/lib/market-presets.mjs";
import * as freelancePresets from "../../src/lib/freelance-presets.mjs";

await loadBindings();
const require = createRequire(import.meta.url);
const icon = ({ children }) => createElement("span", null, children);
const lucide = new Proxy({}, { get: () => icon });
const cn = (...values) => values.flat().filter(Boolean).join(" ");

async function loadComponent(relative, filename, dependencies) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const { code } = await transform(source, {
    filename,
    jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => dependencies[id] ?? (id === "lucide-react" ? lucide : require(id)),
    module,
    module.exports,
  );
  return module.exports;
}

const filterDependencies = {
  "@/lib/cn": { cn }, "@/lib/explore": explore, "@/lib/explore-state.mjs": discoveryState,
  "@/lib/market-presets.mjs": marketPresets, "@/lib/freelance-presets.mjs": freelancePresets,
};
const employment = { ...explore.DEFAULT_FILTERS, positive: ["Farmácia", "iOS"], allow: ["Lisboa"], markets: ["portugal"] };

function elements(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}

test("opportunity buttons emit the selected type through the existing onChange contract", async () => {
  const { FilterBuilder } = await loadComponent("../../src/components/explore/filter-builder.tsx", "filter-builder.tsx", {
    ...filterDependencies, react: { ...React, useState: () => [false, () => {}] },
  });
  const changes = [];
  const tree = FilterBuilder({ filters: employment, onChange: (next) => changes.push(next) });
  const buttons = elements(tree).filter((el) => el.type === "button" && ["Emprego", "Freelance"].includes(el.props.children));
  assert.equal(buttons.length, 2);
  buttons.forEach((button) => button.props.onClick());
  assert.deepEqual(changes, [employment, { ...employment, opportunityType: "freelance" }]);
});

test("freelance terms are not attributed to the employment profile seed", async () => {
  const { FilterBuilder } = await loadComponent("../../src/components/explore/filter-builder.tsx", "filter-builder.tsx", filterDependencies);
  const props = { filters: { ...employment, opportunityType: "freelance", positive: ["Flutter"] }, seededFrom: ["perfil"], onChange() {} };
  assert.doesNotMatch(renderToStaticMarkup(createElement(FilterBuilder, props)), /Preenchido a partir/);
  assert.match(renderToStaticMarkup(createElement(FilterBuilder, { ...props, filters: employment })), /Preenchido a partir/);
});

test("the existing provider preserves snapshots and applies assistant patches without persistent writes", async (t) => {
  const slots = [];
  const effects = [];
  const writes = [];
  const storedResults = new Map();
  const urls = [];
  globalThis.window = { history: { replaceState: (_a, _b, url) => urls.push(url) } };
  t.after(() => { delete globalThis.window; });
  for (const name of ["localStorage", "sessionStorage"]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: {
      getItem: (key) => name === "sessionStorage" ? storedResults.get(key) ?? null : null,
      setItem: (key, value) => { writes.push([key, value]); if (name === "sessionStorage") storedResults.set(key, value); },
      removeItem: (key) => { if (name === "sessionStorage") storedResults.delete(key); },
    } });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
  }
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: (fn) => effects.push(fn),
  };
  const { ExploreProvider } = await loadComponent("../../src/components/explore/explore-provider.tsx", "explore-provider.tsx", {
    react: hooks, "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/lib/explore": explore, "@/lib/explore-ai": {}, "@/lib/whats-new.mjs": {},
    "@/lib/explore-error.mjs": {}, "@/lib/explore-state.mjs": discoveryState,
  });
  const render = () => { cursor = 0; effects.length = 0; return ExploreProvider({ children: null }).props.value; };
  let ctx = render();
  ctx.initFilters(employment);
  ctx = render();
  ctx.setFilters({ ...ctx.filters, opportunityType: "freelance" });
  ctx = render();
  assert.deepEqual(ctx.filters.positive, []);
  assert.deepEqual(ctx.filters.allow, []);
  ctx.setFilters({ ...ctx.filters, positive: ["Flutter"] });
  ctx = render();
  ctx.setFilters({ ...ctx.filters, opportunityType: "employment" });
  ctx = render();
  assert.deepEqual(ctx.filters, employment);
  ctx.applyPatch({ opportunityType: "freelance", positive: ["LLM"] }, { merge: true });
  ctx = render();
  assert.deepEqual(ctx.filters.positive, ["Flutter", "LLM"]);
  ctx.initFilters(employment);
  assert.equal(render().filters.opportunityType, "freelance");

  // A fresh provider initialized by a shared freelance URL keeps the profile seed.
  slots.length = 0;
  ctx = render();
  ctx.initFilters(explore.paramsToFilters(new URLSearchParams("opportunity=freelance&q=Flutter")), employment);
  ctx = render();
  ctx.setFilters({ ...ctx.filters, opportunityType: "employment" });
  assert.deepEqual(render().filters, employment);
  effects.forEach((effect) => effect());
  assert.deepEqual(writes, []);

  // Results belong to the opportunity type that produced them. A type switch
  // must not display a freelance scan under employment filters (or vice versa),
  // and both settled result sets must survive the switch within this tab.
  storedResults.set("career-ops:explore-results:employment", JSON.stringify({
    v: 1, mode: "scan", phase: "results",
    filters: employment, sort: "company", searchPhase: "broad", expansion: { phase: "broad", changes: ["Janela de pesquisa: 7 → 30 dias."], originalSinceDays: 7, effectiveSinceDays: 30, termsAdded: [], locationsAdded: [] },
    offers: [{ url: "https://example.test/job", title: "Farmácia", company: "Acme", location: "Lisboa" }],
    matchCount: 1, companiesScanned: 4, companiesAvailable: 4, capHit: false, droppedNoDate: 0,
    sources: { greenhouse: { state: "ok", matches: 1 } }, partial: false, status: "1 oferta encontrada.", error: "",
    scannerMissing: false, added: [], aiTrace: [], aiCost: { searches: 0, candidates: 0, fetches: 0 }, aiIntent: "",
  }));
  storedResults.set("career-ops:explore-results:freelance", JSON.stringify({
    v: 1, mode: "scan", phase: "empty-current", offers: [], matchCount: 0,
    filters: { ...explore.DEFAULT_FILTERS, opportunityType: "freelance", positive: ["Flutter"], markets: ["remote"] }, sort: "match", searchPhase: "precise", expansion: null,
    companiesScanned: 1, companiesAvailable: 1, capHit: false, droppedNoDate: 0,
    sources: { wttj: { state: "ok" } }, partial: false, status: "Nenhuma oferta encontrada.", error: "",
    scannerMissing: false, added: [], aiTrace: [], aiCost: { searches: 0, candidates: 0, fetches: 0 }, aiIntent: "",
  }));

  slots.length = 0;
  ctx = render();
  effects[0]();
  ctx = render();
  assert.equal(ctx.phase, "results");
  assert.equal(ctx.offers[0].title, "Farmácia");
  assert.equal(ctx.sort, "company");
  assert.equal(ctx.searchPhase, "broad");
  assert.deepEqual(ctx.expansion.changes, ["Janela de pesquisa: 7 → 30 dias."]);
  ctx.initFilters(employment);
  ctx = render();
  ctx.setFilters({ ...ctx.filters, opportunityType: "freelance" });
  ctx = render();
  assert.equal(ctx.phase, "empty-current");
  assert.equal(ctx.companiesScanned, 1);
  assert.deepEqual(ctx.offers, []);
  assert.equal(ctx.expansion, null);
  assert.equal(ctx.sort, "match");
  assert.equal(new URL(urls.at(-1), 'https://example.test').searchParams.get('opportunity'), 'freelance');
  assert.equal(new URL(urls.at(-1), 'https://example.test').searchParams.get('q'), 'Flutter');
  const freelanceUrl = urls.at(-1);
  ctx.setFilters({ ...ctx.filters, opportunityType: "employment" });
  ctx = render();
  assert.equal(ctx.phase, "results");
  assert.equal(ctx.offers[0].title, "Farmácia");
  assert.equal(ctx.sources.greenhouse.matches, 1);
  assert.equal(ctx.searchPhase, "broad");
  assert.equal(new URL(urls.at(-1), 'https://example.test').searchParams.get('q'), 'Farmácia,iOS');
  ctx.setSort('fresh');
  ctx = render();
  effects.at(-1)();
  assert.equal(JSON.parse(storedResults.get('career-ops:explore-results:employment')).sort, 'fresh');
  slots.length = 0;
  ctx = render();
  ctx.initFilters(explore.paramsToFilters(new URL(freelanceUrl, 'https://example.test').searchParams), employment);
  ctx = render();
  assert.equal(ctx.filters.opportunityType, 'freelance');
  assert.equal(ctx.phase, 'empty-current');
  ctx.reset();
  assert.equal(storedResults.has('career-ops:explore-results:freelance'), false);
  assert.equal(storedResults.has('career-ops:explore-results:employment'), true);
});

test("the existing explorer page passes the employment seed when opening a freelance URL", async (t) => {
  const calls = [];
  const aiCalls = [];
  const context = { filters: employment, offers: [], sources: {}, mode: "scan", phase: "idle", initFilters: (...args) => calls.push(args), setMode: mode => aiCalls.push(['mode', mode]), setAiIntent: intent => aiCalls.push(['intent', intent]) };
  const dependencies = new Proxy({
    react: { ...React, useEffect: (fn) => fn(), useMemo: (fn) => fn(), useRef: (initial) => ({ current: initial }), useState: (initial) => [initial, () => {}] },
    "@/lib/explore": explore, "@/lib/cn": { cn }, "@/lib/fonts": { instrumentSerif: { className: "serif" } },
    "@/lib/explore-state.mjs": discoveryState, "./explore-provider": { useExplore: () => context },
  }, { get: (target, key) => target[key] ?? (key.startsWith("@/") || key.startsWith("./") ? {} : undefined) });
  globalThis.window = { location: { search: "?opportunity=freelance&q=Flutter" } };
  t.after(() => { delete globalThis.window; });
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });
  t.after(() => { if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor); else delete globalThis.localStorage; });
  const { ExplorerView } = await loadComponent("../../src/components/explore/explorer-view.tsx", "explorer-view.tsx", dependencies);
  ExplorerView({ seed: { filters: employment, seededFrom: ["perfil"] }, inboxSnapshot: [], appsSnapshot: [], rootExists: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0].opportunityType, "freelance");
  assert.deepEqual(calls[0][0].positive, ["Flutter"]);
  assert.deepEqual(calls[0][1], employment);
  window.location.search = '?mode=ai&opportunity=freelance&q=Flutter&intent=Find%20Flutter';
  ExplorerView({ seed: { filters: employment, seededFrom: ["perfil"] }, inboxSnapshot: [], appsSnapshot: [], rootExists: true });
  assert.equal(calls.length, 2, 'assisted URL initializes the active opportunity type before intent');
  assert.equal(calls[1][0].opportunityType, 'freelance');
  assert.deepEqual(calls[1][0].positive, ['Flutter']);
  assert.deepEqual(aiCalls, [['mode', 'scan'], ['intent', ''], ['mode', 'ai'], ['intent', 'Find Flutter']]);
});

test("freelance filters expose the explicit mode selector and editable shortcuts", async () => {
  const { FilterBuilder } = await loadComponent("../../src/components/explore/filter-builder.tsx", "filter-builder.tsx", {
    "@/lib/cn": { cn },
    "@/lib/explore": {
      ATS_LABEL: { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", workday: "Workday" },
      ATS_SOURCES: ["greenhouse", "lever", "ashby", "workday"],
      MARKET_IDS: ["portugal", "remote"],
      cleanChips: (values) => [...new Set(values)],
    },
    "@/lib/explore-state.mjs": { MARKET_LABEL: { portugal: "Portugal", remote: "Remoto" } },
    "@/lib/market-presets.mjs": { inferMarketsFromLocations: () => [] },
    "@/lib/freelance-presets.mjs": {
      FREELANCE_SHORTCUTS: { Websites: ["website"], Aplicações: ["application"], Chatbots: ["chatbot"], Automação: ["automation"], IA: ["AI"] },
      applyFreelanceShortcut: (values, label) => [...values, label],
    },
  });
  const filters = {
    opportunityType: "freelance", positive: [], negative: [], allow: [], block: [], blockHard: [], alwaysAllow: [],
    sinceDays: 7, ats: ["greenhouse"], markets: [], limitPerAts: 150,
  };
  const html = renderToStaticMarkup(createElement(FilterBuilder, { filters, onChange() {} }));
  for (const label of ["Emprego", "Freelance", "Websites", "Aplicações", "Chatbots", "Automação", "IA"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /min-h-\[44px\][^>]*>Websites</);
  assert.match(html, /As plataformas ATS de emprego não são consultadas/);
});

test("freelance cards can be saved but never offer employment evaluation", async () => {
  const { DiscoveryCard } = await loadComponent("../../src/components/explore/discovery-card.tsx", "discovery-card.tsx", {
    "@/lib/cn": { cn },
    "@/lib/fonts": { instrumentSerif: { className: "serif" } },
    "@/lib/explore-state.mjs": { offerProvenance: () => ({ origins: ["Welcome to the Jungle"], eligibilityUnknown: false }) },
    "@/components/jobs/job-store": { useJobs: () => ({ jobs: [], startJob() { throw new Error("evaluation must not start while rendering"); } }) },
    "./explore-provider": { useExplore: () => ({ added: new Set(), adding: new Set(), addToPipeline() {} }) },
  });
  const base = { url: "https://example.test/1", company: "Acme", title: "Designer", location: "Lisboa", postedAt: "", ats: "wttj-api", source: "wttj-api" };
  const freelance = renderToStaticMarkup(createElement(DiscoveryCard, { offer: {
    ...base, opportunityType: "freelance", verification: "unconfirmed", matchedKeyword: "designer", fit: { band: "strong", score: 1 },
  }, inPipeline: false }));
  assert.match(freelance, />Freelance</);
  assert.match(freelance, /Guardar oportunidade/);
  assert.doesNotMatch(freelance, />Avaliar</);
  assert.doesNotMatch(freelance, /avaliação|A a F/i);

  const employment = renderToStaticMarkup(createElement(DiscoveryCard, { offer: { ...base, opportunityType: "employment" }, inPipeline: false }));
  assert.match(employment, />Adicionar</);
  assert.match(employment, />Avaliar/);
});
