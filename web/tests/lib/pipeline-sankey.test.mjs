// Graph + layout tests for the analytics Pipeline Sankey.
// Run:  node --test tests/lib/pipeline-sankey.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLeaf, buildPipelineSankey, layoutSankey, parseStatusLog, statusToken } from "../../src/lib/pipeline-sankey.mjs";

test("statusToken strips dates and markdown bold", () => {
  assert.equal(statusToken("Interview"), "INTERVIEW");
  assert.equal(statusToken("Interview 2026-08-20"), "INTERVIEW");
  assert.equal(statusToken("**Rejected**"), "REJECTED");
  assert.equal(statusToken("—"), "DISCARDED");
});

test("parseStatusLog skips header and reads Interview→Rejected rows", () => {
  const rows = parseStatusLog(
    "num\tdate\tfrom\tto\tsource\tnote\n13\t2026-08-26\tInterview\tRejected\tset-status\t\n3\t2026-08-15\tApplied\tRejected\tset-status\t\n",
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].num, 13);
  assert.equal(rows[0].from, "Interview");
  assert.equal(rows[0].to, "Rejected");
});

test("rejected after interview stays on the interview path", () => {
  const leaf = classifyLeaf({ n: 13, status: "Rejected" }, [{ num: 13, from: "Interview", to: "Rejected" }]);
  assert.equal(leaf, "rejectedInterview");
});

test("rejected with no interview log is rejectedApply", () => {
  const leaf = classifyLeaf({ n: 3, status: "Rejected" }, [{ num: 3, from: "Applied", to: "Rejected" }]);
  assert.equal(leaf, "rejectedApply");
});

test("current Interview counts as interview even without a log", () => {
  assert.equal(classifyLeaf({ n: 46, status: "Interview" }, []), "interview");
});

test("buildPipelineSankey conserves tracked = skip + evaluated + submitted", () => {
  const apps = [
    { n: 1, status: "SKIP" },
    { n: 2, status: "Evaluated" },
    { n: 3, status: "Applied" },
    { n: 4, status: "Applied" },
    { n: 5, status: "Responded" },
    { n: 12, status: "Interview" },
    { n: 13, status: "Rejected" },
    { n: 26, status: "Rejected" },
  ];
  const log = [{ num: 13, from: "Interview", to: "Rejected" }];
  const g = buildPipelineSankey(apps, log);
  const v = Object.fromEntries(g.nodes.map((n) => [n.id, n.value]));
  assert.equal(g.total, 8);
  assert.equal(v.tracked, 8);
  assert.equal(v.skip, 1);
  assert.equal(v.evaluated, 1);
  assert.equal(v.submitted, 6);
  assert.equal(v.waiting, 2);
  assert.equal(v.engaged, 3);
  assert.equal(v.rejectedApply, 1);
  assert.equal(v.screening, 1);
  assert.equal(v.interview, 1);
  assert.equal(v.rejectedInterview, 1);
  assert.equal(v.tracked, v.skip + v.evaluated + v.submitted);
  assert.equal(v.submitted, v.waiting + v.engaged + v.rejectedApply);
  assert.equal(v.engaged, v.screening + v.interview + v.rejectedInterview);
});

test("empty apps yield empty graph", () => {
  const g = buildPipelineSankey([]);
  assert.equal(g.total, 0);
  assert.equal(g.nodes.length, 0);
  assert.equal(g.links.length, 0);
});

test("layoutSankey positions nodes and draws a path per live link", () => {
  const g = buildPipelineSankey(
    [
      { n: 1, status: "Applied" },
      { n: 2, status: "Interview" },
      { n: 3, status: "Rejected" },
    ],
    [{ num: 3, from: "Interview", to: "Rejected" }],
  );
  const laid = layoutSankey(g, { width: 800, height: 300 });
  assert.equal(laid.nodes.length, g.nodes.length);
  assert.equal(laid.links.length, g.links.length);
  for (const n of laid.nodes) {
    assert.ok(n.width > 0);
    assert.ok(n.height > 0);
    assert.ok(n.x >= 0);
    assert.ok(n.y >= 0);
  }
  for (const l of laid.links) {
    assert.ok(l.d.startsWith("M"));
    assert.ok(l.d.includes("C"));
    assert.ok(l.thickness > 0);
  }
});
