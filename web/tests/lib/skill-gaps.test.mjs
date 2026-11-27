// The skill-gap panel has to say when its map is misleading, not just when it is
// empty. Both conditions below produce a list that looks perfectly reasonable.

import test from "node:test";
import assert from "node:assert/strict";
import { skillGapModel, barPct, blockerText } from "../../src/lib/skill-gaps.mjs";

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

test("gaps from Gap tables alone are still flagged as thin", () => {
  // The case the first version got wrong. upskill.mjs reads a report's Gap
  // TABLE as well as its Machine Summary — verified against the core:
  // parseReportGaps() on a table-only report returns hasMachineSummary false
  // and the gap text anyway. So a pipeline with ZERO summaries can produce a
  // full gap map, and gating the caveat on `withMs > 0` suppressed it in
  // precisely the thinnest case.
  const m = skillGapModel(payload({ reportsRead: 9, reportsWithMachineSummary: 0 }));
  assert.equal(m.gaps.length, 2, "the gaps are real and still shown");
  const c = m.caveats.find((x) => x.kind === "thin-coverage");
  assert.ok(c, "zero summaries with gaps present must be flagged");
  assert.match(c.text, /None of the 9 reports/);
  assert.doesNotMatch(c.text, /Based on 0 of 9/, "the zero case gets its own wording, not an odd ratio");
});

test("an empty gap map is not flagged as thin", () => {
  // Nothing to qualify — a coverage ratio beside an empty list is noise.
  const m = skillGapModel(payload({ reportsRead: 9, reportsWithMachineSummary: 0 }, []));
  assert.equal(m.gaps.length, 0);
  assert.equal(m.caveats.find((x) => x.kind === "thin-coverage"), undefined);
});

test("an empty install does not claim the CV had no recognised skills", () => {
  // /api/upskill on a fresh data root returns available:true with an error
  // string and no metadata. num() turns the missing knownSkillCount into 0,
  // so the panel used to print the no-known-skills caveat next to
  // "No recurring gaps yet" when there was no CV and no tracker.
  const fresh = skillGapModel({
    available: true,
    data: { error: "No applications tracker found. Run some evaluations first." },
  });
  assert.equal(fresh.available, true);
  assert.equal(fresh.gaps.length, 0);
  assert.equal(fresh.caveats.find((x) => x.kind === "no-known-skills"), undefined);

  // A counted zero with no gaps is the same situation. The caveat exists to
  // qualify a list of skills, and there is no list.
  const empty = skillGapModel(payload({ knownSkillCount: 0 }, []));
  assert.equal(empty.gaps.length, 0);
  assert.equal(empty.caveats.find((x) => x.kind === "no-known-skills"), undefined);
});

test("gaps with no knownSkillCount are not a CV that had zero skills", () => {
  // knownSkillCount absent is not the number 0. A check on gaps.length alone,
  // or num() which turns a missing field into 0, would flag this map.
  const uncounted = skillGapModel({
    available: true,
    data: {
      metadata: { reportsRead: 9, reportsWithMachineSummary: 5 },
      gaps: [
        { skill: "Kubernetes", reports: 4, lowFitReports: 2, weightedScore: 3.5, tier: "High", sources: [2, 3] },
      ],
    },
  });
  assert.equal(uncounted.gaps.length, 1);
  assert.equal(uncounted.caveats.find((x) => x.kind === "no-known-skills"), undefined);
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

test("skip blockers pass through with the skip count, and malformed rows drop", () => {
  const base = payload();
  const people = { label: "People management", kind: "theme", skips: 9, missing: 9, partial: 0, closeCalls: 5, nudge: "learn", reports: [193, 190], wordings: ["Managing managers"] };
  base.data.skipBlockers = { window: 20, skips: 20, blockers: [people, { label: "", skips: 3 }, { label: "Go", skips: 0 }] };
  const m = skillGapModel(base);
  assert.deepEqual(m.blockers, [people]);
  assert.equal(m.skips, 20);

  const older = skillGapModel(payload());
  assert.deepEqual([older.blockers, older.skips], [[], 0], "an upskill.mjs without skipBlockers renders no blocker list");
});

test("a blocker line names the verdict split, the close calls, and the matching nudge", () => {
  assert.deepEqual(blockerText({ label: "People management", skips: 9, missing: 9, partial: 0, closeCalls: 5, nudge: "learn", reports: [] }), {
    verdict: "missing in all 9 · 5 scored 3.5 or higher",
    nudge: "Your CV does not show this. Learn it, or aim at roles that do not ask for it.",
  });
  assert.deepEqual(blockerText({ label: "Kubernetes", skips: 3, missing: 1, partial: 2, closeCalls: 0, nudge: "evidence", reports: [] }), {
    verdict: "missing in 1, partial in 2",
    nudge: "Your CV shows some of this. If you have done more, add a bullet with the scope and the result.",
  });
});
