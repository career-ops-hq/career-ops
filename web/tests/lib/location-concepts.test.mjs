import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocationInputs } from "../../src/lib/location-concepts.mjs";

test("precise Lisboa keeps city aliases and excludes the metropolitan municipalities", () => {
  const result = resolveLocationInputs(["Lisboa"], "precise");
  assert.deepEqual(result.terms, ["Lisboa", "Lisbon", "Lisbonne", "Lissabon"]);
  assert.deepEqual(result.markets, ["portugal"]);
  assert.equal(result.locations[0]?.scope, "city");
  assert.deepEqual(result.locations[0]?.metroAliases, []);
  assert.deepEqual(result.expansions, []);
  for (const input of ["Lisbon", "LISBONNE", "Lissabon"]) {
    assert.equal(resolveLocationInputs(input, "precise").locations[0]?.id, "lisbon");
  }
  assert.ok(!result.terms.includes("Amadora"));
});

test("broad Lisboa adds only the enumerated municipalities and exposes the reason and additions", () => {
  const result = resolveLocationInputs("Lisboa", "broad");
  const additions = ["Alcochete", "Almada", "Amadora", "Barreiro", "Cascais", "Loures", "Mafra", "Moita", "Montijo", "Odivelas", "Oeiras", "Palmela", "Seixal", "Sesimbra", "Setúbal", "Sintra", "Vila Franca de Xira"];
  assert.deepEqual(result.locations[0]?.metroAliases, additions);
  assert.deepEqual(result.terms, ["Lisboa", "Lisbon", "Lisbonne", "Lissabon", ...additions]);
  assert.deepEqual(result.expansions[0]?.added, additions);
  assert.equal(result.expansions[0]?.input, "Lisboa");
  assert.match(result.expansions[0]?.reason, /Área Metropolitana de Lisboa/u);
  assert.match(result.expansions[0]?.reason, /municípios/u);
  assert.ok(!result.terms.includes("Porto"));
});

test("country and city aliases normalize supported markets without expanding countries to cities", () => {
  for (const [input, id, market, alias, scope] of [
    ["Espanha", "spain", "spain", "Spain", "country"],
    ["España", "spain", "spain", "Espanha", "country"],
    ["Madrid", "madrid", "spain", "Madri", "city"],
    ["Reino Unido", "united-kingdom", "united-kingdom", "United Kingdom", "country"],
    ["Londres", "london", "united-kingdom", "London", "city"],
    ["Suíça", "switzerland", "switzerland", "Schweiz", "country"],
    ["Genebra", "geneva", "switzerland", "Genève", "city"],
    ["Zurique", "zurich", "switzerland", "Zurich", "city"],
    ["Luxemburgo", "luxembourg", "luxembourg", "Luxembourg", "country"],
    ["Luxembourg City", "luxembourg-city", "luxembourg", "Cidade do Luxemburgo", "city"],
    ["Países Baixos", "netherlands", "netherlands", "Nederland", "country"],
    ["Amesterdão", "amsterdam", "netherlands", "Amsterdam", "city"],
    ["Haia", "the-hague", "netherlands", "Den Haag", "city"],
    ["Portugal", "portugal", "portugal", "PT", "country"],
  ]) {
    const result = resolveLocationInputs(input, "precise");
    assert.equal(result.locations[0]?.id, id, input);
    assert.equal(result.locations[0]?.scope, scope);
    assert.deepEqual(result.markets, [market]);
    assert.ok(result.terms.includes(alias), alias);
    assert.deepEqual(result.expansions, []);
    assert.deepEqual(resolveLocationInputs(input, "broad").expansions, []);
  }
});

test("remote aliases remain explicit remote scope", () => {
  for (const input of ["Remoto", "Remote", "Télétravail", "Homeoffice", "Op afstand"]) {
    const result = resolveLocationInputs(input, "broad");
    assert.deepEqual(result.markets, ["remote"]);
    assert.equal(result.locations[0]?.scope, "remote");
    assert.deepEqual(result.expansions, []);
  }
});

test("unknown or qualified locations stay literal, never gain a market or metro area", () => {
  for (const phase of ["precise", "broad"]) {
    for (const input of ["Atlantis", "Lisboa, Spain", "Cambridge"]) {
      assert.deepEqual(resolveLocationInputs(input, phase), {
        phase, terms: [input], locations: [], markets: [], unresolved: [input], expansions: [],
      });
    }
    assert.deepEqual(resolveLocationInputs([null, 3, {}, " "], phase).terms, []);
  }
});

test("precise Great Britain retains its literal scope instead of widening to the UK", () => {
  assert.deepEqual(resolveLocationInputs("Great Britain", "precise"), {
    phase: "precise", terms: ["Great Britain"], locations: [], markets: [], unresolved: ["Great Britain"], expansions: [],
  });
});

test("literal order and accent/case dedup survive multiple locations", () => {
  const result = resolveLocationInputs(["Genebra", "Suíça", "suica", "Atlantis", "Lisboa"], "precise");
  assert.deepEqual(result.terms.slice(0, 4), ["Genebra", "Suíça", "Atlantis", "Lisboa"]);
  assert.deepEqual(result.markets, ["switzerland", "portugal"]);
  assert.deepEqual(result.unresolved, ["Atlantis"]);
});
