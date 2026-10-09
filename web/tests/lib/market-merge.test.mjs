import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarketPlan } from "../../src/lib/market-presets.mjs";
import { mergeDiscoveredOffers, parseMarketReceipt } from "../../src/lib/core/market-merge.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";
const { runDiscovery } = await import("@/lib/core/scan");

const offer = { url: "https://jobs.acme.com/42", company: "Acme", title: "Engineer", location: "Lisboa", postedAt: "", ats: "landingjobs", source: "Landing.jobs" };
const receipt = (offers, errors = []) => JSON.stringify({ version: "careerops.scan.receipt@1", scanned: 2, skipped: 0, found: offers.length, filtered: 0, duplicates: 0, added: offers.length, added_urls: offers.map(o => o.url), offers, errors, unverified_zero: [], dry_run: true });

test("receipt and canonical merge preserve only valid source metrics and combine sources", () => {
  const metrics = { contractType: " Sem termo ", hours: " 40 h/semana ", applicationDeadline: " 2026-11-01 ", vacancyCount: 2, observedAt: "2026-10-08T12:00:00.000Z", availabilityEvidence: "feed-seen", sources: ["Landing.jobs", "Remotive"] };
  const run = parseMarketReceipt(receipt([{ ...offer, ...metrics }]), 0, buildMarketPlan(["portugal"], []));
  const [merged] = mergeDiscoveredOffers([{ ...offer, source: "greenhouse-full", ats: "greenhouse", vacancyCount: -1, hours: " " }], run.offers);
  assert.equal(merged.contractType, "Sem termo");
  assert.equal(merged.hours, "40 h/semana");
  assert.equal(merged.applicationDeadline, "2026-11-01");
  assert.equal(merged.vacancyCount, 2);
  assert.equal(merged.observedAt, metrics.observedAt);
  assert.equal(merged.availabilityEvidence, "feed-seen");
  assert.equal(merged.postedAt, "");
  assert.deepEqual(merged.sources, ["greenhouse-full", "Landing.jobs", "Remotive"]);
  for (const vacancyCount of [-1, 0, 2.5, "2", null]) {
    const invalid = parseMarketReceipt(receipt([{ ...offer, vacancyCount, contractType: " ", hours: "", applicationDeadline: " ", availabilityEvidence: "invented", observedAt: "bad" }]), 0, buildMarketPlan(["portugal"], [])).offers[0];
    for (const field of ["vacancyCount", "contractType", "hours", "applicationDeadline", "availabilityEvidence", "observedAt"]) assert.equal(field in invalid, false, field);
  }
});

test("sparse live ATS then richer final JSON fills fields before all-source eligible ranking", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ranking-merge-"));
  const prior = { CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT, CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = root;
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config/profile.yml"), "{}");
  t.after(() => {
    for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const live = { ...offer, title: "Operador de Loja", location: "", source: "greenhouse-full", ats: "greenhouse", observedAt: "2026-10-08T12:00:00.000Z" };
  const final = { ...live, location: "Lisbon, Portugal", postedAt: "2026-10-08", contractType: "Permanent", hours: "40 h/semana", applicationDeadline: "2026-11-01", vacancyCount: 3, salary: { min: 24000, currency: "EUR" }, availabilityEvidence: "feed-seen", sources: ["greenhouse-full", "Employer"] };
  const market = { ...offer, title: "Retail Assistant", url: "https://acme.example/market", location: "Lisboa", postedAt: "" };
  fs.writeFileSync(path.join(root, "scan-ats-full.mjs"), `// --json capHit\nconsole.error(${JSON.stringify(JSON.stringify({ kind: "offer", ...live }))}); console.log(${JSON.stringify(JSON.stringify({ offers: [final], companiesAvailable: 1, companiesScanned: 1, capHit: false, datasetStatus: { greenhouse: "ok" }, unreachableBoards: 0, postingsDroppedNoDate: 0 }))});`);
  fs.writeFileSync(path.join(root, "scan.mjs"), `console.log(${JSON.stringify(receipt([market, { ...market, url: "https://acme.example/outside", location: "Madrid, Spain" }]))});`);
  // Both terms are explicitly requested so both sources are precise-eligible.
  const filters = { opportunityType: "employment", positive: ["Operador de Loja", "Retail Assistant"], negative: [], allow: ["Lisboa"], block: [], blockHard: [], alwaysAllow: [], sinceDays: 7, ats: ["greenhouse"], markets: ["portugal"], limitPerAts: 150 };
  const events = [];
  const offers = await runDiscovery(filters, event => events.push(event));
  assert.equal(offers.length, 2);
  assert.equal(offers[0].url, live.url);
  for (const field of ["contractType", "hours", "applicationDeadline", "vacancyCount", "salary", "availabilityEvidence"]) assert.deepEqual(offers[0][field], final[field], field);
  assert.equal(offers[0].location, "Lisbon, Portugal");
  assert.equal(offers[0].postedAt, "2026-10-08");
  assert.deepEqual(offers[0].sources, ["greenhouse-full", "Employer"]);
  assert.equal(offers[0].match.components.role, 60);
  assert.equal(offers[1].match.components.role, 60);
  assert.equal(offers[0].observedAt, offers[1].observedAt);
  assert.equal(events.find(event => event.kind === "summary").matches, 2);
  assert.ok(!offers.some(result => result.url.endsWith("outside")));
});

test("canonical URL merges origins in order and ATS fills empty fields", () => {
  const [merged] = mergeDiscoveredOffers([{ ...offer, url: offer.url + "?utm_source=ats", source: "greenhouse-full", ats: "greenhouse", location: "" }], [{ ...offer, postedAt: "2026-10-05", sources: ["Landing.jobs", "Remotive"] }]);
  assert.equal(merged.url, offer.url + "?utm_source=ats");
  assert.equal(merged.location, "Lisboa");
  assert.equal(merged.postedAt, "2026-10-05");
  assert.deepEqual(merged.sources, ["greenhouse-full", "Landing.jobs", "Remotive"]);
  assert.equal(mergeDiscoveredOffers([offer], [{ ...offer, url: "https://jobs.acme.com/43" }]).length, 2);
});

test("receipt normalizes date and salary, counts and rejects missing location", () => {
  const run = parseMarketReceipt(receipt([{ ...offer, postedAt: Date.UTC(2026, 9, 5), salary: { min: 42000, currency: "eur" } }, { ...offer, url: offer.url + "x", location: "" }]), 0, buildMarketPlan(["portugal"], []));
  assert.equal(run.valid, true);
  assert.equal(run.missingLocation, 1);
  assert.equal(run.offers.length, 1);
  assert.equal(run.offers[0].postedAt, "2026-10-05");
  assert.deepEqual(run.offers[0].salary, { min: 42000, currency: "EUR" });
});

test("freelance market receipts mark every accepted opportunity", () => {
  const plan = buildMarketPlan(["portugal"], ["designer"], "freelance");
  const run = parseMarketReceipt(receipt([offer]), 0, plan);
  assert.equal(run.offers.length, 1);
  assert.equal(run.offers[0].opportunityType, "freelance");
});

test("exit 2 preserves valid offers and source errors", () => {
  const run = parseMarketReceipt(receipt([offer], [{ company: "getManfred (EN)", error: "timeout" }]), 2, buildMarketPlan(["portugal", "spain"], []));
  assert.equal(run.valid, true);
  assert.equal(run.status, "partial");
  assert.equal(run.offers.length, 1);
  assert.equal(run.sources.find(s => s.source === "getManfred (EN)").state, "error");
});

test("all selected sources failing is a failed run even with a valid envelope", () => {
  const run = parseMarketReceipt(receipt([], [{ company: "Landing.jobs", error: "offline" }]), 2, buildMarketPlan(["portugal"], []));
  assert.equal(run.valid, false);
  assert.equal(run.status, "failed");
});

test("malformed receipts and fatal exits cannot masquerade as valid empty searches", () => {
  for (const [text, code] of [["oops", 0], ["{}", 0], [receipt([]), 1], [JSON.stringify({ offers: [], errors: [] }), 0]]) {
    assert.equal(parseMarketReceipt(text, code, buildMarketPlan(["portugal"], [])).valid, false);
  }
  assert.equal(parseMarketReceipt(receipt([]), 0, buildMarketPlan(["portugal"], [])).valid, true);
});

test("remote provider receipt ids prove remote work without inventing worldwide eligibility", () => {
  const run = parseMarketReceipt(receipt([{ ...offer, source: "remoteok-api", location: "United States" }]), 0, buildMarketPlan(["remote"], []));
  assert.equal(run.offers.length, 1);
  assert.deepEqual(run.offers[0].sources, ["remoteok-api"]);
  assert.equal(run.offers[0].verification, "unconfirmed");
});

test("timeout and unexplained nonzero exits retain valid offers and mark sources incomplete", () => {
  const plan = buildMarketPlan(["portugal"], []);
  for (const [code, timedOut] of [[2, true], [2, false], [1, false], [null, true]]) {
    const run = parseMarketReceipt(receipt([offer]), code, plan, timedOut);
    assert.equal(run.offers.length, 1);
    assert.equal(run.valid, true);
    assert.equal(run.status, "partial");
    assert.deepEqual(run.sources.map(s => s.state), ["error", "skipped"]);
    assert.ok(run.sources[0].message);
  }
});

test("an empty receipt with only skipped providers is not a healthy empty search", () => {
  const skipped = JSON.stringify({ ...JSON.parse(receipt([])), scanned: 0, skipped: 1 });
  const run = parseMarketReceipt(skipped, 0, buildMarketPlan(["portugal"], []));
  assert.equal(run.offers.length, 0);
  assert.equal(run.valid, false);
  assert.equal(run.status, "failed");
  assert.deepEqual(run.sources.map(s => s.state), ["skipped", "skipped"]);
});

test("new country markets retain only matching offers in the scanner receipt", () => {
  const offers = [
    { ...offer, location: "Geneva, Switzerland" },
    { ...offer, url: `${offer.url}/wrong`, location: "Geneva, Belgium" },
  ];
  const run = parseMarketReceipt(receipt(offers), 0, buildMarketPlan(["switzerland"], []));
  assert.equal(run.offers.length, 1);
  assert.equal(run.offers[0].location, "Geneva, Switzerland");
});

test("mixed skipped providers never certify unidentified sources as complete", () => {
  const plan = buildMarketPlan(["europe"], ["Engineer"]);
  for (const offers of [[], [offer]]) {
    const mixed = JSON.stringify({ ...JSON.parse(receipt(offers)), scanned: 3, skipped: 1 });
    const run = parseMarketReceipt(mixed, 0, plan);
    assert.equal(run.valid, true);
    assert.equal(run.status, "partial");
    assert.deepEqual(run.sources.map(s => s.state), ["partial", "partial", "partial", "partial"]);
    assert.ok(run.sources.every(s => s.message));
    assert.equal(run.offers.length, offers.length);
  }
});
