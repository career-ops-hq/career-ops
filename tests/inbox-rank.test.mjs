import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristicSegment } from "../rank-pipeline.mjs";
import { fitTargetsFromProfile, scorePosting } from "../lib/inbox-rank.mjs";

const targets = {
  roles: ["Senior Data Analyst"],
  places: ["Austin"],
  wantsRemote: true,
  payFloor: 100000,
  currency: "USD",
};

test("the CLI stamp helper uses the shared fit line", () => {
  const entry = { title: "Senior Data Analyst", location: "Remote", pay: "$140k" };
  const fit = scorePosting(entry, targets);
  const segment = heuristicSegment(entry, targets);
  assert.equal(fit.reason, "Title matches 'Senior Data Analyst' · Remote · pay above your floor");
  assert.equal(fit.score, 5);
  assert.equal(segment.startsWith("rank: 5.0/5"), true);
  assert.equal(segment.includes(fit.reason), true);
  assert.equal(segment.includes("|"), false);
});

test("a stamp already on the row wins over a fresh profile hit", () => {
  const segment = heuristicSegment({
    title: "Senior Data Analyst",
    location: "Remote",
    pay: "$140k",
    rankStamp: "1.5/5 \u2014 Keep for later",
  }, targets);
  assert.equal(segment.startsWith("rank: 1.5/5"), true);
  assert.equal(segment.includes("Keep for later"), true);
});

test("an unranked row writes no stamp", () => {
  assert.equal(heuristicSegment({ title: "Zookeeper", location: "Berlin", pay: "" }, targets), "");
});

test("a dot or a space between thousands is read as grouping in pay and floor", () => {
  const euro = fitTargetsFromProfile({
    target_roles: { primary: ["Data Engineer"] },
    compensation: { minimum: "60.000 €", currency: "EUR" },
  });
  assert.equal(euro.payFloor, 60000);
  for (const pay of ["70.000 € - 90.000 €", "70 000 € - 90 000 €", "€70.000-€90.000"]) {
    const fit = scorePosting({ title: "Data Engineer", location: "Berlin", pay }, euro);
    assert.equal(fit.reason.endsWith("pay above your floor"), true, pay);
  }
  const below = scorePosting({ title: "Data Engineer", location: "Berlin", pay: "50.000 €" }, euro);
  assert.equal(below.reason.endsWith("pay above your floor"), false);
});

test("a decimal point in an amount with no grouping stays a decimal point", () => {
  const euroFloor = (minimum) => fitTargetsFromProfile({
    target_roles: { primary: ["Data Engineer"] },
    compensation: { minimum, currency: "EUR" },
  });
  assert.equal(euroFloor("1234.567").payFloor, 1234.567);
  assert.equal(euroFloor("1.234.567 €").payFloor, 1234567);
  const decimal = euroFloor(60000.125);
  assert.equal(decimal.payFloor, 60000.125);
  const above = scorePosting({ title: "Data Engineer", location: "Berlin", pay: "€70000" }, decimal);
  assert.equal(above.reason.endsWith("pay above your floor"), true);
  const below = scorePosting({ title: "Data Engineer", location: "Berlin", pay: "1234.567 €" }, euroFloor("60.000 €"));
  assert.equal(below.reason.endsWith("pay above your floor"), false);
});
