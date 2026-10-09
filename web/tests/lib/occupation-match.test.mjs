import test from "node:test";
import assert from "node:assert/strict";
import { resolveOccupations, expandOccupationTerms, matchOccupationTitle } from "../../src/lib/occupation-match.mjs";

test("approved PT/ES/EN/FR/DE/NL labels resolve to stable occupation IDs", () => {
  for (const input of ["Técnico Auxiliar de Farmácia", "Auxiliar de Farmacia", "Pharmacy Assistant", "Assistant en pharmacie", "Apothekenhelfer", "Apotheekassistent"]) {
    const result = resolveOccupations([input]);
    assert.equal(result.resolved[0]?.id, "pharmacy-assistant", input);
    assert.equal(result.resolved[0]?.input, input);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.ambiguous, []);
  }
  for (const input of ["Assistente de Vendas", "Asistente de ventas", "Sales Assistant", "Assistant de vente", "Verkaufsassistent", "Verkoopassistent"]) {
    assert.equal(resolveOccupations(input).resolved[0]?.id, "sales-assistant", input);
  }
});

test("Portuguese slash and parenthesized gender spellings match both genders", () => {
  for (const input of ["Operador/a de Loja", "Operador(a) de Loja"]) {
    const { resolved } = resolveOccupations(input);
    assert.equal(resolved[0]?.id, "retail-assistant");
    for (const title of ["Operador de Loja", "Operadora de Loja", "Operador/a de loja", "Operador(a) de loja", "Retail Assistant"]) {
      assert.equal(matchOccupationTitle(title, resolved)?.occupationId, "retail-assistant", title);
    }
    assert.equal(matchOccupationTitle("Machine operator", resolved), null);
  }
});

test("pharmacy support aliases match while pharmacist managers and generic assistants do not", () => {
  for (const input of ["Técnico de Farmácia", "Ajudante de Farmácia", "Auxiliar de Farmácia"]) {
    const { resolved } = resolveOccupations(input);
    assert.equal(resolved[0]?.id, "pharmacy-assistant");
    for (const title of ["Pharmacy Assistant - Lisbon", "Auxiliar de Farmacia", "AJUDANTE DE FARMACIA"]) {
      assert.equal(matchOccupationTitle(title, resolved)?.occupationId, "pharmacy-assistant", title);
    }
    for (const title of ["Pharmacist Manager", "Farmacêutico responsável", "Assistant", "Pharmacy Manager", "Pharmacy Assistantship"]) {
      assert.equal(matchOccupationTitle(title, resolved), null, title);
    }
  }
});

test("sales evidence preserves the original input and matched alias without accepting assistant alone", () => {
  const { resolved } = resolveOccupations("Assistente de Vendas");
  assert.deepEqual(matchOccupationTitle("Sales Assistant (m/f)", resolved), {
    occupationId: "sales-assistant", input: "Assistente de Vendas", alias: "Sales Assistant", language: "en", kind: "alias",
  });
  assert.equal(matchOccupationTitle("Assistente de Vendas - Lisboa", resolved)?.kind, "literal");
  for (const title of ["Executive Assistant", "Sales Manager", "Assistant", "Presales Assistant", "Sales Assistantship"]) {
    assert.equal(matchOccupationTitle(title, resolved), null, title);
  }
});

test("retail, web, app, chatbot and AI automation queries stay in their approved concepts", () => {
  for (const [input, title, id] of [
    ["loja de roupa", "Store Assistant", "retail-assistant"],
    ["retalho", "Retail Assistant", "retail-assistant"],
    ["desenvolvimento web", "Web Developer", "web-developer"],
    ["websites", "Frontend Developer", "web-developer"],
    ["aplicações", "Mobile Developer", "app-developer"],
    ["chatbots", "Chatbot Developer", "chatbot-developer"],
    ["automação com IA", "AI Automation Specialist", "ai-automation"],
  ]) {
    const { resolved } = resolveOccupations(input);
    assert.equal(resolved[0]?.id, id, input);
    assert.equal(matchOccupationTitle(title, resolved)?.occupationId, id, title);
    assert.equal(matchOccupationTitle("Developer", resolved), null);
  }
});

test("unresolved and ambiguous inputs retain literal fallback in original order", () => {
  assert.deepEqual(resolveOccupations(["Quantum gardener", "developer", "Assistant"]), {
    resolved: [], unresolved: ["Quantum gardener", "Assistant"], ambiguous: ["developer"],
  });
  assert.deepEqual(expandOccupationTerms(["Quantum gardener", "developer", "Assistant"], ["en"]).terms,
    ["Quantum gardener", "developer", "Assistant"]);
  assert.deepEqual(resolveOccupations([null, 42, {}, " "]), { resolved: [], unresolved: [], ambiguous: [] });
});

test("German retail aliases require the retail sector rather than generic selling", () => {
  const { resolved } = resolveOccupations("Operador de Loja");
  assert.equal(matchOccupationTitle("Verkäufer Versicherungen", resolved), null);
  assert.equal(matchOccupationTitle("Verkäufer im Einzelhandel", resolved)?.occupationId, "retail-assistant");
  assert.equal(matchOccupationTitle("Verkäuferin im Einzelhandel", resolved)?.occupationId, "retail-assistant");
});

test("expansion puts user terms first, deduplicates accents/case, respects languages and the 12-term cap", () => {
  const result = expandOccupationTerms(["Ajudante de Farmácia", "Sales Assistant", "sales assistant"], ["pt", "es", "en"]);
  assert.deepEqual(result.terms.slice(0, 2), ["Ajudante de Farmácia", "Sales Assistant"]);
  assert.ok(result.terms.includes("Pharmacy Assistant"));
  // PT and ES spellings differ only by accent: retain the first literal spelling.
  assert.ok(result.terms.includes("Auxiliar de Farmácia"));
  assert.ok(!result.terms.includes("Apotheekassistent"));
  assert.ok(result.terms.length <= 12);
  const capped = expandOccupationTerms(["Ajudante de Farmácia", "Sales Assistant"], ["pt", "es", "en", "fr", "de", "nl"], 100);
  assert.equal(capped.terms.length, 12);
  assert.ok(capped.omitted.length > 0);
  assert.deepEqual(expandOccupationTerms(["Sales Assistant", "Chatbots"], ["en"], 1).terms, ["Sales Assistant"]);
  assert.deepEqual(expandOccupationTerms("Pharmacy Assistant", ["nl"]).terms, ["Pharmacy Assistant", "Apotheekassistent"]);
  assert.deepEqual(expandOccupationTerms("Auxiliar de Farmácia", ["pt"]).terms.filter(term => /^auxiliar de farmacia$/i.test(term.normalize("NFD").replace(/\p{M}/gu, ""))), ["Auxiliar de Farmácia"]);
});
