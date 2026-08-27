import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/components/documents-view.tsx", import.meta.url), "utf8");

test("Documents UI surfaces review-required cover-letter state", () => {
  assert.match(source, /Draft - Review Required|workflow\.status/);
  assert.match(source, />Review Cover Letter</);
});

test("Documents UI preserves approved cover and offers explicit regeneration", () => {
  assert.match(source, /approved PDF is preserved/i);
  assert.match(source, />Prepare New Cover Letter</);
});
