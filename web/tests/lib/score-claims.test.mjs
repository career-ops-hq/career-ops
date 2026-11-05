// The score screen only claims levers the rubric says move the 1-5 score.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ignoredByScore, leverCopy, scoreBandSummary, scoringDimensions } from "../../src/lib/score-claims.mjs";
import { scoreLevers } from "../../src/lib/machine-summary.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("the methodology lists the five scoring dimensions and not a sixth", () => {
  const names = scoringDimensions().map((row) => row.name);
  assert.deepEqual(names, ["CV match", "North Star alignment", "Compensation", "Cultural signals", "Red flags"]);
  const joined = scoringDimensions().map((row) => `${row.name} ${row.detail}`).join("\n");
  assert.match(joined, /unknown and does not move the score/);
  assert.match(joined, /not a middle score/);
  assert.equal(joined.includes("Overall"), false);
  assert.equal(ignoredByScore().some((item) => /block B/i.test(item)), true);
  assert.equal(ignoredByScore().some((item) => /block G/i.test(item)), true);
  assert.equal(ignoredByScore().some((item) => /confidence/i.test(item)), true);
});

test("the band lines come from the shared table", () => {
  const lines = scoreBandSummary().join("\n");
  assert.match(lines, /Strong apply starts at 4\.5/);
  assert.match(lines, /Apply starts at 4\.0/);
  assert.match(lines, /Maybe starts at 3\.0/);
  assert.match(lines, /Skip is below 3\.0/);
});

test("holding-it-down copy is limited to red flags", () => {
  const copy = leverCopy();
  assert.match(copy.holdingHint, /red flags/i);
  assert.equal(/requirement/i.test(copy.holdingHint), false);
  assert.match(copy.verifyHint, /does not change the 1 to 5 score/);
  const screen = readFileSync(path.join(HERE, "../../src/components/score-methodology.tsx"), "utf8");
  assert.equal(screen.includes("six dimensions"), false);
  assert.equal(screen.includes("Overall"), false);
});

test("a missing requirement is not returned as a score lever", () => {
  const levers = scoreLevers({
    decision: "Consider",
    strengths: [],
    hardStops: [],
    softGaps: ["Light on stakeholder updates"],
    requirements: [{ requirement: "Kubernetes", importance: "critical", match: "missing" }],
    confidenceGaps: [],
    unknownEvidence: ["Compensation"],
  });
  assert.deepEqual(levers.holding, []);
  assert.deepEqual(levers.close, [{ text: "Light on stakeholder updates", importance: null }]);
  assert.deepEqual(levers.verify, ["Compensation evidence is unknown"]);
});
