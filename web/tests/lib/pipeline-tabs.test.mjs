// pipeline-tabs — the canonical tab list shared by the tab strip, the assistant's
// filterPipeline action and the Config page's default-tab dropdown.
//
// Run:  node --test tests/lib/pipeline-tabs.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { PIPELINE_TABS, FALLBACK_PIPELINE_TAB, normalizePipelineTab } from "../../src/lib/pipeline-tabs.mjs";

test("the fallback is a real tab", () => {
  assert.ok(PIPELINE_TABS.includes(FALLBACK_PIPELINE_TAB));
  assert.equal(FALLBACK_PIPELINE_TAB, "INBOX");
});

test("every canonical tab normalizes to itself", () => {
  for (const t of PIPELINE_TABS) assert.equal(normalizePipelineTab(t), t);
});

test("case and padding are forgiven (URL query, hand-edited profile.yml)", () => {
  assert.equal(normalizePipelineTab("all"), "ALL");
  assert.equal(normalizePipelineTab("  Interview "), "INTERVIEW");
});

test("anything that is not a tab is null, never a guess", () => {
  for (const bad of ["", "NOPE", "IN BOX", null, undefined, 3, {}, ["ALL"]]) {
    assert.equal(normalizePipelineTab(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});
