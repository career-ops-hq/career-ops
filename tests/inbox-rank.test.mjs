import { test } from "node:test";
import assert from "node:assert/strict";
import { heuristicSegment } from "../rank-pipeline.mjs";
import { scorePosting } from "../lib/inbox-rank.mjs";

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
