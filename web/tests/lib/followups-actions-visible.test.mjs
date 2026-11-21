// At 1280px with the 240px sidebar open, the follow-ups table is wider than
// the page. Log and Next date live in the last column. That column sticks to
// the right edge of the horizontal scroller so both controls stay on screen.
//
// Run: node --experimental-strip-types --test tests/lib/followups-actions-visible.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/followups/followups-view.tsx"),
  "utf8",
);

function sticky(className) {
  return className.includes("sticky") && className.includes("right-0");
}

test("the Actions column sticks to the right and holds Log and Next date", () => {
  const header = src.match(/<th className="([^"]*)">\s*Actions\s*<\/th>/);
  assert.ok(header, "expected an Actions header cell");
  assert.equal(sticky(header[1]), true, `Actions header must stick right: ${header[1]}`);

  const cell = src.match(/<td className="([^"]*)">\s*<span className="inline-flex items-center gap-0\.5">([\s\S]*?)<\/span>\s*<\/td>/);
  assert.ok(cell, "expected the actions cell");
  assert.equal(sticky(cell[1]), true, `actions cell must stick right: ${cell[1]}`);
  assert.match(cell[2], />\s*Log\s*</);
  assert.match(cell[2], /Next date/);
  assert.doesNotMatch(cell[2], /hidden xl:inline/, "Next date stays written out, not only at xl");
});
