// Tests for personalization.mjs — the section-safe logic behind
// /api/personalization and setPersonalization. Imports directly from the module
// (single source of truth) so test and production code can never drift.
//
// Run:  node --test tests/lib/personalization.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coercePersonalization, mergeSections, renderSection, sectionState, SECTIONS } from "../../src/lib/personalization.mjs";

// The REAL shipped template, not a synthetic one: if its headings change, this
// fails here rather than silently leaving a section unaddressable.
const TEMPLATE = readFileSync(new URL("../../../modes/_profile.template.md", import.meta.url), "utf8");

test("every SECTIONS heading exists in the shipped template, in order", () => {
  let last = -1;
  for (const s of SECTIONS) {
    const i = TEMPLATE.indexOf(`\n${s.heading}\n`);
    assert.ok(i > last, `${s.heading} should appear after the previous heading (found at ${i})`);
    last = i;
  }
});

test("a fresh template reports every section as 'template', none 'filled'", () => {
  const st = sectionState(TEMPLATE, TEMPLATE);
  assert.equal(st.length, SECTIONS.length);
  for (const s of st) assert.equal(s.state, "template", s.heading);
});

test("an empty/missing file reports every section as 'missing'", () => {
  for (const s of sectionState("", TEMPLATE)) assert.equal(s.state, "missing");
});

test("merge replaces ONLY the given section bodies and keeps every other byte", () => {
  const rendered = { exitNarrative: "I am moving from consulting to product because I want to own outcomes." };
  const merged = mergeSections(TEMPLATE, rendered);

  // The replaced section carries the new body…
  assert.ok(merged.includes("## Your Exit Narrative\n\nI am moving from consulting to product"));
  // …the template text of that section is gone…
  assert.ok(!merged.includes("Use the candidate's exit story from `config/profile.yml`"));
  // …and every other section is byte-for-byte what the template had.
  const before = sectionState(TEMPLATE, TEMPLATE);
  const after = sectionState(merged, TEMPLATE);
  for (let i = 0; i < before.length; i++) {
    const expect = after[i].id === "exitNarrative" ? "filled" : "template";
    assert.equal(after[i].state, expect, after[i].heading);
  }
});

test("merge preserves the assistant's co-web-notes block and hand-written sections", () => {
  const custom = TEMPLATE
    + "\n## My own section\n\nHand-written, must survive.\n"
    + "\n## Notes from the web assistant\n<!-- co-web-notes:start -->\n- prefers remote\n<!-- co-web-notes:end -->\n";
  const merged = mergeSections(custom, { crossCuttingAdvantage: "Builder with real-world proof." });
  assert.ok(merged.includes("## My own section\n\nHand-written, must survive."));
  assert.ok(merged.includes("<!-- co-web-notes:start -->\n- prefers remote\n<!-- co-web-notes:end -->"));
  assert.ok(merged.includes("## Your Cross-cutting Advantage\n\nBuilder with real-world proof."));
});

test("a section whose heading is absent is appended — before the notes block", () => {
  const partial = "# Profile customization\n\n## Notes from the web assistant\n<!-- co-web-notes:start -->\n- x\n<!-- co-web-notes:end -->\n";
  // Mirror the route: render first, then merge — mergeSections takes rendered bodies.
  const merged = mergeSections(partial, { locationPolicy: renderSection("locationPolicy", ["Remote-first, EU timezones", "Hybrid only within NL"]) });
  const iSec = merged.indexOf("## Your Location Policy");
  const iNotes = merged.indexOf("## Notes from the web assistant");
  assert.ok(iSec !== -1 && iNotes !== -1 && iSec < iNotes, "new section must sit before the notes block");
  assert.ok(merged.includes("- Remote-first, EU timezones\n- Hybrid only within NL"));
});

test("merging is idempotent: the same patch twice yields the same file", () => {
  const p = { compTargets: "Targeting 85–100k EUR base for senior IC roles in NL." };
  const once = mergeSections(TEMPLATE, p);
  const twice = mergeSections(once, p);
  assert.equal(once, twice);
});

test("renderSection: tables scrub pipes and newlines out of cells", () => {
  const md = renderSection("targetRoles", [{ archetype: "AI | Platform\nEngineer", axes: "evals", buys: "ships metrics" }]);
  const rows = md.split("\n");
  assert.equal(rows.length, 3, "header + separator + one row");
  assert.ok(!rows[2].includes("AI | Platform"), "pipe inside a cell would split the table");
  assert.ok(rows[2].startsWith("| **AI / Platform Engineer** |"));
});

test("coerce keeps only well-formed fields and drops junk, unknown keys and bad URLs", () => {
  const p = coercePersonalization({
    targetRoles: [{ archetype: "ML Engineer", axes: "training, eval" }, { axes: "no archetype → dropped" }, "junk"],
    adaptiveFraming: [{ role: "ML", emphasize: "models to prod" }, { role: "no emphasize → dropped" }],
    exitNarrative: "   spaced   out   ",
    portfolio: { url: "javascript:alert(1)", description: "x" },
    negotiationScripts: ["a", 3, "b"],
    unknownKey: "ignored",
    locationPolicy: [],
  });
  assert.deepEqual(Object.keys(p).sort(), ["adaptiveFraming", "exitNarrative", "negotiationScripts", "targetRoles"]);
  assert.equal(p.targetRoles.length, 1);
  assert.equal(p.adaptiveFraming.length, 1);
  assert.equal(p.exitNarrative, "spaced out");
  assert.deepEqual(p.negotiationScripts, ["a", "b"]);
  assert.equal(p.portfolio, undefined, "non-http url is not a portfolio");
});

test("coerce of nothing usable is an empty object (→ 'nothing to write')", () => {
  assert.deepEqual(coercePersonalization({}), {});
  assert.deepEqual(coercePersonalization(null), {});
  assert.deepEqual(coercePersonalization({ exitNarrative: "" }), {});
});
