import assert from "node:assert/strict";
import { test } from "node:test";
import { archetypeCaption } from "../../src/lib/report-sections.mjs";

test("a report header archetype names itself so it is not a second job title", () => {
  assert.equal(archetypeCaption("AI/ML Engineer"), "Archetype: AI/ML Engineer");
  assert.equal(archetypeCaption("  "), "");
  assert.equal(archetypeCaption(null), "");
});
