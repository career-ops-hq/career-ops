import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchPlan } from "../../src/lib/search-plan.mjs";
import { rankOpportunity, rankOpportunities } from "../../src/lib/opportunity-rank.mjs";

const now = "2026-10-08T12:00:00.000Z";
const filters = { opportunityType: "employment", positive: ["Operador de Loja"], negative: [], allow: ["Lisboa"], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7, ats: [], markets: ["portugal"], limitPerAts: 150 };
const offer = { title: "Operador/a de loja", company: "Acme", url: "https://acme.example/jobs/1", location: "Lisbon, Portugal", source: "workday-api", ats: "workday", postedAt: "2026-10-08" };

test("original phrase and same-city spelling reach the four ceilings with literal reasons", () => {
  const result = rankOpportunity(offer, buildSearchPlan(filters, "precise"), now);
  assert.deepEqual(result.components, { role: 60, location: 25, freshness: 10, evidence: 5 });
  assert.equal(result.total, 100);
  assert.equal(result.occupation.kind, "literal");
  assert.deepEqual(result.reasons, ["Função pedida: «Operador de Loja».", "Localização: mesma cidade (Lisboa).", "Publicada nos últimos 7 dias.", "Evidência: 5 de 5 campos de origem."]);
});

test("same-concept translation is below the original and enumerated metro below the city", () => {
  const result = rankOpportunity({ ...offer, title: "Retail Assistant", location: "Amadora, Portugal", postedAt: "2026-09-18" }, buildSearchPlan(filters, "broad"), now);
  assert.deepEqual(result.components, { role: 50, location: 20, freshness: 5, evidence: 5 });
  assert.equal(result.total, 80);
  assert.deepEqual(result.occupation, { occupationId: "retail-assistant", input: "Operador de Loja", alias: "Retail Assistant", language: "en", kind: "alias" });
  assert.deepEqual(result.reasons, ["Função equivalente: «Retail Assistant» corresponde a «Operador de Loja».", "Localização: Área Metropolitana de Lisboa (Amadora).", "Publicada há 8 a 30 dias.", "Evidência: 5 de 5 campos de origem."]);
  assert.equal(rankOpportunity({ ...offer, location: "Amadora" }, buildSearchPlan(filters, "precise"), now).components.location, 0);
});

test("country and accepted remote score 10 without kilometre inference", () => {
  const country = rankOpportunity({ ...offer, location: "Porto, Portugal" }, buildSearchPlan({ ...filters, allow: ["Portugal"] }, "precise"), now);
  assert.equal(country.total, 85);
  assert.equal(country.components.location, 10);
  assert.equal(country.reasons[1], "Localização: país selecionado (Portugal).");
  const remote = rankOpportunity({ ...offer, location: "Remote" }, buildSearchPlan({ ...filters, allow: [], markets: ["remote"] }, "precise"), now);
  assert.equal(remote.total, 85);
  assert.equal(remote.reasons[1], "Localização: trabalho remoto aceite.");
});

test("source-proven remote and country city evidence use the same eligible market policy", () => {
  const remote = rankOpportunity({ ...offer, source: "remotive-api", location: "United States" }, buildSearchPlan({ ...filters, allow: [], markets: ["remote"] }, "precise"), now);
  assert.equal(remote.components.location, 10);
  assert.equal(remote.geography.scope, "remote");
  assert.equal(remote.reasons[1], "Localização: trabalho remoto aceite.");
  const country = rankOpportunity({ ...offer, location: "Lisboa" }, buildSearchPlan({ ...filters, allow: [], markets: ["portugal"] }, "precise"), now);
  assert.equal(country.components.location, 10);
  assert.equal(country.geography.scope, "country");
});

test("old, absent, invalid and future publication dates cannot become discovery freshness", () => {
  const plan = buildSearchPlan(filters, "precise");
  for (const postedAt of ["2026-08-01", "", "invalid", "2026-09-31", "2026-10-09"]) {
    const result = rankOpportunity({ ...offer, postedAt, observedAt: now }, plan, now);
    assert.equal(result.components.freshness, 0, postedAt);
    assert.equal(result.total, 90, postedAt);
  }
  assert.equal(rankOpportunity({ ...offer, postedAt: "" }, plan, now).reasons[2], "Data de publicação desconhecida.");
  assert.equal(rankOpportunity({ ...offer, postedAt: "2026-08-01" }, plan, now).reasons[2], "Publicada há mais de 30 dias.");
  assert.equal(rankOpportunity({ ...offer, postedAt: "2026-10-01" }, plan, now).components.freshness, 10);
  assert.equal(rankOpportunity({ ...offer, postedAt: "2026-09-08" }, plan, now).components.freshness, 5);
});

test("evidence counts only supplied core fields and never invents optional metrics", () => {
  const result = rankOpportunity({ ...offer, source: " ", location: "", postedAt: "" }, buildSearchPlan(filters, "precise"), now);
  assert.deepEqual(result.components, { role: 60, location: 0, freshness: 0, evidence: 3 });
  assert.equal(result.total, 63);
  assert.equal(result.reasons[3], "Evidência: 3 de 5 campos de origem.");
});

test("unmatched occupations cannot inherit fit and unknown user phrases remain literal", () => {
  const plan = buildSearchPlan(filters, "broad");
  const result = rankOpportunity({ ...offer, title: "Machine Operator", fit: { score: 1, band: "strong" } }, plan, now);
  assert.equal(result.total, 40);
  assert.equal(result.components.role, 0);
  assert.equal(result.occupation, undefined);
  assert.equal(result.reasons[0], "Sem correspondência profissional com a pesquisa.");
  const unknown = buildSearchPlan({ ...filters, positive: ["Quantum gardener"] }, "precise");
  assert.equal(rankOpportunity({ ...offer, title: "Senior Quantum gardener" }, unknown, now).components.role, 60);
  assert.equal(rankOpportunity({ ...offer, title: "Quantum gardening" }, unknown, now).components.role, 0);
  const retailInput = buildSearchPlan({ ...filters, positive: ["loja de roupa"] }, "broad");
  assert.equal(rankOpportunity({ ...offer, title: "Assistente de loja de roupa" }, retailInput, now).components.role, 60);
});

test("a winning unresolved literal cannot borrow losing alias evidence or its reason", () => {
  for (const positive of [["Operador de Loja", "Quantum gardener"], ["Quantum gardener", "Operador de Loja"]]) {
    const plan = buildSearchPlan({ ...filters, positive }, "broad");
    const literal = rankOpportunity({ ...offer, title: "Retail Assistant - Quantum gardener" }, plan, now);
    assert.equal(literal.total, 100);
    assert.deepEqual(literal.components, { role: 60, location: 25, freshness: 10, evidence: 5 });
    assert.equal(literal.occupation, undefined);
    assert.equal(literal.reasons[0], "Função pedida: «Quantum gardener».");
    const alias = rankOpportunity({ ...offer, title: "Retail Assistant" }, plan, now);
    assert.equal(alias.total, 90);
    assert.equal(alias.components.role, 50);
    assert.deepEqual(alias.occupation, { occupationId: "retail-assistant", input: "Operador de Loja", alias: "Retail Assistant", language: "en", kind: "alias" });
    assert.equal(alias.reasons[0], "Função equivalente: «Retail Assistant» corresponde a «Operador de Loja».");
  }
});

test("city evidence follows its winning 25-point branch when a metro token also occurs", () => {
  const plan = buildSearchPlan(filters, "broad");
  const city = rankOpportunity({ ...offer, location: "Lisboa, Amadora, Portugal" }, plan, now);
  assert.equal(city.total, 100);
  assert.deepEqual(city.components, { role: 60, location: 25, freshness: 10, evidence: 5 });
  assert.deepEqual(city.geography, { scope: "city", input: "Lisboa", matched: "Lisboa" });
  assert.equal(city.reasons[1], "Localização: mesma cidade (Lisboa).");
  const metro = rankOpportunity({ ...offer, location: "Amadora, Portugal" }, plan, now);
  assert.equal(metro.total, 95);
  assert.equal(metro.components.location, 20);
  assert.deepEqual(metro.geography, { scope: "metro", input: "Lisboa", matched: "Amadora" });
  assert.equal(metro.reasons[1], "Localização: Área Metropolitana de Lisboa (Amadora).");
});

test("ranking is pure and deterministic: total, publication date, company, then URL", () => {
  const offers = [
    { ...offer, url: "https://acme.example/jobs/2", company: "Beta" },
    { ...offer, url: "https://acme.example/jobs/4", postedAt: "2026-10-07" },
    { ...offer, url: "https://acme.example/jobs/3" },
    { ...offer, url: "https://acme.example/jobs/1", fit: { score: 0, band: "weak" } },
    { ...offer, url: "https://acme.example/jobs/0", title: "Retail Assistant", fit: { score: 1, band: "strong" } },
  ];
  const original = structuredClone(offers);
  const plan = buildSearchPlan(filters, "broad");
  const ranked = rankOpportunities(offers, plan, now);
  assert.deepEqual(ranked.map(o => o.url), ["https://acme.example/jobs/1", "https://acme.example/jobs/3", "https://acme.example/jobs/2", "https://acme.example/jobs/4", "https://acme.example/jobs/0"]);
  assert.deepEqual(rankOpportunities([...offers].reverse(), plan, now), ranked);
  assert.deepEqual(offers, original);
  assert.deepEqual(ranked[0].fit, { score: 0, band: "weak" });
});

test("explicit operators rank their proven query at the existing literal ceiling with deterministic ties", () => {
  for (const phase of ["precise", "broad"]) for (const [query, accepted, rejected] of [
    ["word:agent", "AI Agent Engineer", "Agentic Engineer"],
    ["stem:agent", "Agentic Engineer", "Reagents Engineer"],
    ["Python + SQL", "Python Developer with SQL", "Python Developer"],
  ]) {
    const plan = buildSearchPlan({ ...filters, positive:[query] }, phase);
    const matched = { ...offer, title:accepted, matchedKeyword:query };
    const result = rankOpportunity(matched, plan, now);
    assert.deepEqual(result.components, { role:60, location:25, freshness:10, evidence:5 }, `${query}: ${phase}`);
    assert.equal(result.total, 100);
    assert.equal(result.reasons[0], `Função pedida: «${query}».`);
    assert.equal(result.occupation, undefined);
    const notMatched = { ...matched, title:rejected, url:"https://acme.example/jobs/0" };
    assert.equal(rankOpportunity(notMatched, plan, now).components.role, 0, 'receipt metadata is not proof of a title match');
    const offers = [
      { ...matched, company:"Beta", url:"https://acme.example/jobs/2" },
      { ...matched, postedAt:"2026-10-07", url:"https://acme.example/jobs/4" },
      { ...matched, url:"https://acme.example/jobs/3" },
      { ...matched, url:"https://acme.example/jobs/1" },
      notMatched,
    ];
    const original = structuredClone(offers);
    const ranked = rankOpportunities(offers, plan, now);
    assert.deepEqual(ranked.map(item => item.url), [1, 3, 2, 4, 0].map(id => `https://acme.example/jobs/${id}`));
    assert.deepEqual(rankOpportunities([...offers].reverse(), plan, now), ranked);
    assert.deepEqual(offers, original);
  }
});

test("generic no-role searches never inherit operator role points from receipt metadata", () => {
  for (const phase of ["precise", "broad"]) {
    const result = rankOpportunity({ ...offer, title:"AI Agent Engineer", matchedKeyword:"word:agent" }, buildSearchPlan({ ...filters, positive:[] }, phase), now);
    assert.equal(result.components.role, 0);
    assert.equal(result.total, 40);
    assert.equal(result.reasons[0], "Sem correspondência profissional com a pesquisa.");
  }
});
