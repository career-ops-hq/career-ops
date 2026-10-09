import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
// RED must not reach local scanners before the injectable pass seam exists.
process.env.CAREER_OPS_CODE_ROOT = os.tmpdir();
import "../helpers/web-ts-alias-loader.mjs";
const { runDiscovery } = await import("@/lib/core/scan");

const filters = { opportunityType: "employment", positive: ["Operador de Loja"], negative: [], allow: ["Lisboa"], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7, ats: ["workday"], markets: ["portugal"], limitPerAts: 150 };
const healthy = { kind: "summary", companiesScanned: 2, companiesAvailable: 2, unreachable: 0, matches: 0, capHit: false, datasetStatus: { workday: "ok" }, postingsDroppedNoDate: 0, status: "ok", sources: [{ source: "workday", state: "ok" }, { source: "Landing.jobs", state: "ok" }] };
const offer = { company: "Acme", title: "Retail Assistant", location: "Amadora", url: "https://example.com/1", source: "workday-full", ats: "workday", postedAt: "2026-10-08" };

async function run(summary, preciseOffers = [], broadOffers = [offer], input = filters) {
  const events = [], plans = [];
  const offers = await runDiscovery(input, event => events.push(event), async (plan, emit) => {
    plans.push(plan);
    emit({ kind: "sourceStart", source: "workday" });
    const result = plan.phase === "precise" ? preciseOffers : broadOffers;
    for (const found of result) emit({ kind: "offer", offer: found });
    emit({ ...summary, matches: result.length });
    return result;
  });
  return { offers, events, plans };
}

test("healthy precise zero executes exactly one broad pass and returns its offers", async () => {
  const result = await run(healthy);
  assert.deepEqual(result.plans.map(plan => plan.phase), ["precise", "broad"]);
  assert.deepEqual(result.plans.map(plan => plan.effectiveFilters.sinceDays), [7, 30]);
  assert.deepEqual(result.offers, [offer]);
  assert.deepEqual(result.events.filter(event => ["phaseStart", "expansion"].includes(event.kind)).map(event => event.kind), ["phaseStart", "expansion", "phaseStart"]);
  assert.ok(result.events.filter(event => event.kind === "phaseStart").every(event => event.free === true));
  assert.equal(result.events.filter(event => event.kind === "summary").length, 1);
  assert.equal(result.events.at(-1).matches, 1);
});

test("precise results stop the ladder", async () => {
  const result = await run(healthy, [offer]);
  assert.equal(result.plans.length, 1);
  assert.deepEqual(result.offers, [offer]);
  assert.equal(result.events.some(event => event.kind === "expansion"), false);
});

test("partial, failed, capped, stale, empty, dropped-undated and timeout results stop", async () => {
  for (const patch of [
    { status: "partial" }, { status: "failed" }, { capHit: true },
    { datasetStatus: { workday: "stale" } }, { datasetStatus: { workday: "empty" } },
    { postingsDroppedNoDate: 1 }, { incomplete: ["workday"] }, { unreachable: 1 },
    { sources: [{ source: "workday", state: "error" }] }, { missingLocation: 1 },
  ]) {
    const result = await run({ ...healthy, ...patch });
    assert.equal(result.plans.length, 1, JSON.stringify(patch));
    assert.equal(result.events.some(event => event.kind === "expansion"), false);
  }
});

test("missing authoritative ATS health fields stop rather than certify legacy zeros", async () => {
  for (const field of ["capHit", "datasetStatus", "postingsDroppedNoDate", "companiesAvailable", "sources", "status"]) {
    const summary = { ...healthy };
    delete summary[field];
    assert.equal((await run(summary)).plans.length, 1, field);
  }
  assert.equal((await run({ ...healthy, datasetStatus: {} })).plans.length, 1);
});

test("broad zero ends once and never dispatches assisted search", async () => {
  const result = await run(healthy, [], []);
  assert.equal(result.plans.length, 2);
  assert.deepEqual(result.offers, []);
  assert.equal(result.events.filter(event => event.kind === "summary").length, 1);
  assert.equal(result.events.some(event => event.kind === "done" || event.kind === "aiStart"), false);
  assert.equal(result.events.at(-1).matches, 0);
});

test("a market-only healthy zero broadens without requiring inapplicable ATS metadata", async () => {
  const summary = { kind: "summary", companiesScanned: 1, unreachable: 0, matches: 0, status: "ok", sources: [{ source: "Welcome to the Jungle", state: "ok" }] };
  const result = await run(summary, [], [], { ...filters, opportunityType: "freelance", ats: [], markets: [] });
  assert.equal(result.plans.length, 2);
});

test("a streamed error blocks broadening even beside an otherwise healthy summary", async () => {
  const phases = [], events = [];
  await runDiscovery(filters, event => events.push(event), async (plan, emit) => {
    phases.push(plan.phase);
    emit({ kind: "error", message: "timeout" });
    emit(healthy);
    return [];
  });
  assert.deepEqual(phases, ["precise"]);
  assert.ok(events.some(event => event.kind === "error"));
});
