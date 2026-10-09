import test from "node:test";
import assert from "node:assert/strict";

const pt = await import("../../src/lib/pt-pt.ts").catch(() => ({}));

test("os estados canónicos mantêm o valor interno e apresentam um rótulo PT-PT", () => {
  assert.equal(typeof pt.statusLabel, "function");
  assert.equal(pt.statusLabel("Evaluated"), "Avaliada");
  assert.equal(pt.statusLabel("Applied"), "Candidatura enviada");
  assert.equal(pt.statusLabel("Responded"), "Com resposta");
  assert.equal(pt.statusLabel("Interview"), "Entrevista");
  assert.equal(pt.statusLabel("Offer"), "Proposta");
  assert.equal(pt.statusLabel("Hired"), "Contratação");
  assert.equal(pt.statusLabel("Rejected"), "Recusada");
  assert.equal(pt.statusLabel("Discarded"), "Descartada");
  assert.equal(pt.statusLabel("SKIP"), "Ignorar");
  assert.equal(pt.statusLabel("Estado externo"), "Estado externo");
});

test("uma pesquisa sem execuções não apresenta uma taxa de sucesso fictícia", () => {
  assert.equal(typeof pt.scheduledSuccessRate, "function");
  assert.equal(pt.scheduledSuccessRate(0, 0), "—");
  assert.equal(pt.scheduledSuccessRate(4, 3), "75%");
  assert.equal(pt.scheduledSuccessRate(3, 4), "100%");
});
