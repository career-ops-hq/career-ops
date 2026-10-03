// The skill-gap panel has to say when its map is misleading, not just when it is
// empty. Both conditions below produce a list that looks perfectly reasonable.

import test from "node:test";
import assert from "node:assert/strict";
import { skillGapModel, barPct } from "../../src/lib/skill-gaps.mjs";

const payload = (meta = {}, gaps = null) => ({
  available: true,
  reason: null,
  data: {
    metadata: { reportsRead: 9, reportsWithMachineSummary: 5, knownSkillCount: 5, ...meta },
    gaps: gaps ?? [
      { skill: "Kubernetes", reports: 4, lowFitReports: 2, weightedScore: 3.5, tier: "High", sources: [2, 3, 4, 9] },
      { skill: "Terraform", reports: 3, lowFitReports: 1, weightedScore: 2.3, tier: "Medium", sources: [2, 3] },
    ],
  },
});

test("a CV with no recognised skills is flagged, because the map still renders", () => {
  // upskill.mjs: nothing can be subtracted as already-held, so the map fills
  // with skills the user may already have. A confident list of things to learn
  // that you already know is worse than no list.
  const m = skillGapModel(payload({ knownSkillCount: 0 }));
  assert.equal(m.available, true);
  assert.equal(m.gaps.length, 2, "the gaps are still shown");
  const c = m.caveats.find((x) => x.kind === "no-known-skills");
  assert.ok(c, "a zero known-skill count must be surfaced");
  assert.match(c.text, /already have/);
});

test("a map drawn from a minority of reports says so", () => {
  const thin = skillGapModel(payload({ reportsRead: 9, reportsWithMachineSummary: 2 }));
  const c = thin.caveats.find((x) => x.kind === "thin-coverage");
  assert.ok(c);
  assert.match(c.text, /2 of 9/);

  // A majority needs no caveat — 5 of 9 is most of the pipeline.
  const ok = skillGapModel(payload({ reportsRead: 9, reportsWithMachineSummary: 5 }));
  assert.equal(ok.caveats.find((x) => x.kind === "thin-coverage"), undefined);
});

test("no Machine Summaries at all is not reported as thin coverage", () => {
  // Zero is the "nothing to read" case, and upskill returns no gaps for it —
  // a coverage ratio of 0 of 9 would be noise next to an empty list.
  const m = skillGapModel(payload({ reportsWithMachineSummary: 0 }, []));
  assert.equal(m.gaps.length, 0);
  assert.equal(m.caveats.find((x) => x.kind === "thin-coverage"), undefined);
});

test("malformed gaps cannot reach the panel", () => {
  const m = skillGapModel(payload({}, [
    { skill: "Kubernetes", weightedScore: 3.5 },
    { skill: "", weightedScore: 1 },
    { skill: "   ", weightedScore: 1 },
    { weightedScore: 9 },
    null,
  ]));
  assert.deepEqual(m.gaps.map((g) => g.skill), ["Kubernetes"]);
});

test("the list is capped", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ skill: `s${i}`, weightedScore: 30 - i }));
  assert.equal(skillGapModel(payload({}, many)).gaps.length, 8);
  assert.equal(skillGapModel(payload({}, many), 3).gaps.length, 3);
  assert.equal(skillGapModel(payload({}, many), 0).gaps.length, 1, "a nonsense limit still yields something");
});

test("unavailable keeps its reason and shows no gaps", () => {
  for (const reason of ["no-script", "unparseable"]) {
    const m = skillGapModel({ available: false, reason, data: null });
    assert.equal(m.available, false);
    assert.equal(m.reason, reason);
    assert.deepEqual(m.gaps, []);
    assert.deepEqual(m.caveats, []);
  }
  assert.equal(skillGapModel(null).reason, "unavailable");
  assert.equal(skillGapModel(undefined).available, false);
});

test("bar widths are relative to the heaviest gap shown", () => {
  const gaps = [
    { skill: "a", weightedScore: 4 },
    { skill: "b", weightedScore: 2 },
    { skill: "c", weightedScore: 0 },
  ];
  assert.equal(barPct(gaps[0], gaps), 100);
  assert.equal(barPct(gaps[1], gaps), 50);
  // Never zero-width: a gap that made the list is still a gap, and an invisible
  // bar reads as a rendering fault.
  assert.equal(barPct(gaps[2], gaps), 2);
  // weightedScore has no ceiling, so an absolute scale would render every gap as
  // a stub on one pipeline and a full bar on another.
  const heavy = [{ skill: "x", weightedScore: 400 }, { skill: "y", weightedScore: 200 }];
  assert.equal(barPct(heavy[0], heavy), 100);
  assert.equal(barPct(heavy[1], heavy), 50);
  assert.equal(barPct({ skill: "z", weightedScore: NaN }, heavy), 2);
});
