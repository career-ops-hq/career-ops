import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchPlan } from "../../src/lib/search-plan.mjs";
import { buildMarketPlan, classifyMarketLocation } from "../../src/lib/market-presets.mjs";

const filters = { opportunityType: "employment", positive: ["Operador de Loja"], negative: ["manager"], allow: ["Lisboa"], block: ["Porto"], blockHard: ["USA"], alwaysAllow: [], sinceDays: 7, ats: ["workday"], markets: ["portugal"], limitPerAts: 150 };

test("precise preserves intent while adding only spelling/gender and same-city forms", () => {
  const original = structuredClone(filters);
  const plan = buildSearchPlan(filters, "precise");
  assert.equal(plan.effectiveFilters.sinceDays, 7);
  assert.equal(plan.effectiveFilters.positive[0], "Operador de Loja");
  for (const term of ["Operadora de Loja", "Operador/a de Loja", "Operador(a) de Loja"]) assert.ok(plan.effectiveFilters.positive.includes(term), term);
  assert.ok(!plan.effectiveFilters.positive.includes("Retail Assistant"));
  assert.deepEqual(plan.effectiveFilters.allow, ["Lisboa", "Lisbon", "Lisbonne", "Lissabon"]);
  assert.deepEqual(filters, original);
  for (const field of ["negative", "block", "blockHard", "alwaysAllow", "markets", "ats"]) assert.deepEqual(plan.effectiveFilters[field], original[field]);
  assert.deepEqual(plan.expansion.changes, []);
});

test("accented and slash-gender input can reach literal scanner spellings", () => {
  const plan = buildSearchPlan({ ...filters, positive: ["Técnico Auxiliar de Farmácia", "Operador/a de Loja"] }, "precise");
  assert.deepEqual(plan.effectiveFilters.positive.slice(0, 2), ["Técnico Auxiliar de Farmácia", "Operador/a de Loja"]);
  assert.ok(plan.effectiveFilters.positive.includes("Tecnico Auxiliar de Farmacia"));
  assert.ok(plan.effectiveFilters.positive.includes("Operador de Loja"));
  assert.ok(plan.effectiveFilters.positive.includes("Operadora de Loja"));
  assert.ok(!plan.effectiveFilters.positive.includes("Ajudante de Farmácia"));
});

test("broad adds occupation translations, explicit metro and 30 days with an exact receipt", () => {
  const precise = buildSearchPlan(filters, "precise");
  const broad = buildSearchPlan(filters, "broad");
  assert.equal(broad.effectiveFilters.sinceDays, 30);
  assert.ok(broad.effectiveFilters.positive.includes("Retail Assistant"));
  assert.ok(broad.effectiveFilters.positive.includes("Assistente de Loja"));
  assert.deepEqual(broad.occupationIds, ["retail-assistant"]);
  assert.deepEqual(broad.expansion.termsAdded, ["Assistente de Loja", "Retail Assistant", "Store Assistant", "Shop Assistant"]);
  assert.deepEqual(broad.expansion.locationsAdded, ["Alcochete", "Almada", "Amadora", "Barreiro", "Cascais", "Loures", "Mafra", "Moita", "Montijo", "Odivelas", "Oeiras", "Palmela", "Seixal", "Sesimbra", "Setúbal", "Sintra", "Vila Franca de Xira"]);
  assert.equal(broad.expansion.originalSinceDays, 7);
  assert.equal(broad.expansion.effectiveSinceDays, 30);
  assert.equal(broad.expansion.changes.length, 3);
  assert.deepEqual(broad.effectiveFilters.positive.filter(term => !precise.effectiveFilters.positive.includes(term)), broad.expansion.termsAdded);
  assert.equal(buildSearchPlan({ ...filters, sinceDays: 60 }, "broad").effectiveFilters.sinceDays, 60);
});

test("unknown terms remain literal; unchanged broad plans have an empty receipt", () => {
  const input = { ...filters, positive: ["Quantum gardener"], allow: ["Atlantis"], markets: [], sinceDays: 60 };
  const plan = buildSearchPlan(input, "broad");
  assert.deepEqual(plan.effectiveFilters, input);
  assert.deepEqual(plan.expansion.changes, []);
  assert.deepEqual(plan.expansion.termsAdded, []);
  assert.deepEqual(plan.expansion.locationsAdded, []);
  assert.deepEqual(plan.occupationIds, []);
});

test("positive expansion is capped at 12 with originals first and exclusions intact", () => {
  const plan = buildSearchPlan({ ...filters, positive: ["Ajudante de Farmácia", "Sales Assistant", "Operador de Loja"], markets: ["europe"] }, "broad");
  assert.deepEqual(plan.effectiveFilters.positive.slice(0, 3), ["Ajudante de Farmácia", "Sales Assistant", "Operador de Loja"]);
  assert.equal(plan.effectiveFilters.positive.length, 12);
  assert.deepEqual(plan.effectiveFilters.negative, ["manager"]);
});

test("market classifier uses the same phase-aware geography as the temporary allow list", () => {
  for (const phase of ["precise", "broad"]) {
    const search = buildSearchPlan(filters, phase);
    const market = buildMarketPlan(filters.markets, search.effectiveFilters.positive, "employment", search);
    for (const city of ["Lisboa", "Lisbon", "Lisbonne"]) assert.equal(classifyMarketLocation({ location: city }, market).accepted, true, city);
    for (const city of ["Amadora", "Sintra", "Oeiras", "Cascais"]) assert.equal(classifyMarketLocation({ location: city }, market).accepted, phase === "broad", `${phase} ${city}`);
    for (const location of ["Lisbon, USA", "Lisbonne, France", "Amadora, Spain", "Sintra, ES", "Oeiras, Brazil", "Cascais, Canada"]) assert.equal(classifyMarketLocation({ location }, market).accepted, false, location);
  }
});
