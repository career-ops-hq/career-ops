import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FILTERS, filtersToParams, paramsToFilters, parseExplorePatch } from "../../src/lib/explore.ts";
import * as explore from "../../src/lib/explore.ts";

const freelancePresets = await import("../../src/lib/freelance-presets.mjs").catch(() => ({}));

const employment = {
  opportunityType: "employment", positive: ["Farmácia", "iOS"], negative: ["sales"],
  allow: ["Lisboa"], block: ["India"], blockHard: ["Brazil"], alwaysAllow: ["Porto"],
  sinceDays: 30, ats: ["lever"], markets: ["portugal"], limitPerAts: 300,
};
const listFields = ["positive", "negative", "allow", "block", "blockHard", "alwaysAllow", "ats", "markets"];

test("assisted intent preserves the present employment criteria in PT-PT", () => {
  assert.equal(typeof explore.filtersToAssistedIntent, "function");
  const before = structuredClone(employment);
  const intent = explore.filtersToAssistedIntent(employment);
  for (const clause of [
    "ofertas de emprego", "Funções: Farmácia, iOS", "Excluir funções: sales",
    "Localizações: Lisboa", "Excluir localizações: India", "Excluir sempre localizações: Brazil",
    "Permitir sempre localizações: Porto", "Mercados: Portugal", "últimos 30 dias",
  ]) assert.ok(intent.includes(clause), clause);
  assert.doesNotMatch(intent, /salário|senioridade|remoto|Lever|300/i);
  assert.deepEqual(employment, before);
});

test("assisted intent uses only the active freelance criteria and market labels", () => {
  assert.equal(typeof explore.filtersToAssistedIntent, "function");
  const intent = explore.filtersToAssistedIntent({
    ...DEFAULT_FILTERS, opportunityType: "freelance", positive: ["Flutter", "LLM"], negative: ["estágio"],
    markets: ["united-kingdom", "remote"], sinceDays: 14,
  });
  for (const clause of ["oportunidades freelance", "Funções: Flutter, LLM", "Excluir funções: estágio", "Mercados: Reino Unido, Remoto", "últimos 14 dias"])
    assert.ok(intent.includes(clause), clause);
  assert.doesNotMatch(intent, /emprego|Farmácia|Lisboa|Portugal|Localizações|salário|senioridade|greenhouse/i);
});

test("assisted intent leaves empty filters free of invented criteria", () => {
  assert.equal(typeof explore.filtersToAssistedIntent, "function");
  const intent = explore.filtersToAssistedIntent({ ...DEFAULT_FILTERS, opportunityType: "freelance" });
  assert.equal(intent, "Procura oportunidades freelance. Publicadas nos últimos 7 dias.");
  assert.doesNotMatch(intent, /salário|senioridade|remoto|Portugal|país|Funções|Excluir|Localizações|Mercados/i);
  assert.equal(explore.filtersToAssistedIntent({ ...DEFAULT_FILTERS, sinceDays: 1 }), "Procura ofertas de emprego. Publicadas no último dia.");
  assert.equal(explore.filtersToAssistedIntent({ ...DEFAULT_FILTERS, sinceDays: 0 }), "Procura ofertas de emprego.");
});

test("first freelance snapshot is global and empty without mutating the employment seed", () => {
  const before = JSON.stringify(employment);
  const snapshots = explore.createOpportunitySnapshots(employment);
  const { filters } = explore.switchOpportunitySnapshot(snapshots, employment, "freelance");
  assert.deepEqual(filters, {
    opportunityType: "freelance", positive: [], negative: [], allow: [], block: [], blockHard: [], alwaysAllow: [],
    sinceDays: 7, ats: ["greenhouse", "lever", "ashby", "workday"], markets: [], limitPerAts: 150,
  });
  assert.equal(JSON.stringify(employment), before);
  assert.deepEqual(snapshots.employment, employment);
  for (const key of listFields) {
    assert.notEqual(snapshots.employment[key], employment[key]);
    assert.notEqual(filters[key], snapshots.freelance[key]);
    assert.notEqual(filters[key], DEFAULT_FILTERS[key]);
  }
});

test("switching twice restores independent filters without shared arrays", () => {
  const before = JSON.stringify(employment);
  let state = explore.switchOpportunitySnapshot(explore.createOpportunitySnapshots(employment), employment, "freelance");
  const freelance = {
    ...state.filters, positive: ["frontend"], negative: ["senior"], allow: ["Remote"], block: ["US"],
    blockHard: ["China"], alwaysAllow: ["Europe"], ats: [], markets: ["remote"], sinceDays: 14, limitPerAts: 200,
  };
  const updated = explore.updateOpportunitySnapshot(state.snapshots, freelance);
  for (const key of listFields) assert.notEqual(updated.freelance[key], freelance[key]);
  state = explore.switchOpportunitySnapshot(updated, freelance, "employment");
  assert.equal(JSON.stringify(state.filters), before);
  for (const key of listFields) assert.notEqual(state.filters[key], state.snapshots.employment[key]);
  state = explore.switchOpportunitySnapshot(state.snapshots, state.filters, "freelance");
  assert.deepEqual(state.filters, freelance);
  for (const key of listFields) state.filters[key].push("changed");
  assert.deepEqual(state.snapshots.freelance, freelance);
  assert.equal(JSON.stringify(employment), before);
});

test("an assistant patch that changes opportunity type uses the destination snapshot", () => {
  const freelance = { ...DEFAULT_FILTERS, opportunityType: "freelance", positive: ["frontend"], markets: ["remote"] };
  const snapshots = explore.updateOpportunitySnapshot(explore.createOpportunitySnapshots(employment), freelance);
  const state = explore.applyOpportunityPatch(snapshots, employment, { opportunityType: "freelance", positive: ["LLM"] }, true);
  assert.deepEqual(state.filters.positive, ["frontend", "LLM"]);
  assert.deepEqual(state.filters.negative, []);
  assert.deepEqual(state.filters.allow, []);
  assert.deepEqual(state.filters.markets, ["remote"]);
  assert.deepEqual(state.snapshots.employment, employment);
  assert.deepEqual(state.snapshots.freelance, state.filters);
  assert.deepEqual(snapshots.freelance, freelance);
  const back = explore.applyOpportunityPatch(state.snapshots, state.filters, { opportunityType: "employment", since: 14 });
  assert.deepEqual(back.filters, { ...employment, sinceDays: 14 });
  const replacement = explore.applyOpportunityPatch(state.snapshots, state.filters, { positive: ["Flutter"] });
  assert.deepEqual(replacement.filters.positive, ["Flutter"]);
  for (const key of listFields) assert.notEqual(replacement.filters[key], replacement.snapshots.freelance[key]);
});

test("a freelance URL seeds freelance without replacing the default employment snapshot", () => {
  const active = paramsToFilters(new URLSearchParams("opportunity=freelance&q=Flutter&markets=remote"));
  const snapshots = explore.createOpportunitySnapshots(active, employment);
  assert.deepEqual(snapshots.freelance, active);
  assert.deepEqual(explore.switchOpportunitySnapshot(snapshots, active, "employment").filters, employment);
  assert.deepEqual(explore.createOpportunitySnapshots(active).employment, DEFAULT_FILTERS);
});

test("the URL round-trip contains only the active snapshot", () => {
  const { filters } = explore.applyOpportunityPatch(explore.createOpportunitySnapshots(employment), employment, {
    opportunityType: "freelance", positive: ["Flutter"], markets: ["remote"],
  });
  const params = filtersToParams(filters);
  assert.equal(params, "opportunity=freelance&q=Flutter&markets=remote");
  assert.deepEqual(paramsToFilters(new URLSearchParams(params)), filters);
});

test("employment remains the default and freelance survives the shared URL codec", () => {
  assert.equal(DEFAULT_FILTERS.opportunityType, "employment");
  assert.equal(paramsToFilters(new URLSearchParams()).opportunityType, "employment");
  assert.equal(filtersToParams(DEFAULT_FILTERS).includes("opportunity="), false);

  const freelance = parseExplorePatch({ opportunityType: "freelance" }, DEFAULT_FILTERS);
  assert.equal(freelance.opportunityType, "freelance");
  const params = filtersToParams(freelance);
  assert.match(params, /(?:^|&)opportunity=freelance(?:&|$)/);
  assert.equal(paramsToFilters(new URLSearchParams(params)).opportunityType, "freelance");
  assert.equal(parseExplorePatch({ opportunityType: "contractor" }, freelance).opportunityType, "employment");
});

test("freelance shortcuts add useful editable title terms without replacing existing terms", () => {
  assert.equal(typeof freelancePresets.applyFreelanceShortcut, "function");
  assert.deepEqual(Object.keys(freelancePresets.FREELANCE_SHORTCUTS ?? {}), [
    "Websites", "Aplicações", "Chatbots", "Automação", "IA",
  ]);
  assert.deepEqual(freelancePresets.FREELANCE_SHORTCUTS, {
    Websites: ["web developer", "frontend", "full stack"],
    Aplicações: ["mobile developer", "flutter", "iOS developer", "Android developer"],
    Chatbots: ["chatbot", "conversational AI", "AI agent", "LLM"],
    Automação: ["automation engineer", "QA automation", "workflow automation", "n8n"],
    IA: ["AI engineer", "machine learning", "generative AI", "LLM"],
  });
  assert.deepEqual(
    freelancePresets.applyFreelanceShortcut(["Product Designer"], "Websites"),
    ["Product Designer", "web developer", "frontend", "full stack"],
  );
  assert.deepEqual(
    freelancePresets.applyFreelanceShortcut(["LLM", "chatbot"], "Chatbots"),
    ["LLM", "chatbot", "conversational AI", "AI agent"],
  );
});
