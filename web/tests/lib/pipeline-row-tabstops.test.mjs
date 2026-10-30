// Tracker rows put three Links to the same report (#, company, role) in the
// tab order. A 240-row power-user table is ~1200 Tab presses before the footer.
// Keep one report link in the tab order (company); leave # and role for click
// but skip them with tabIndex={-1}. Pipeline tabs also expose aria-pressed.
//
// Repro (Fri 2026-10-16 dogfood, Jordan Rivera 240 rows): each of 6 sample rows
// had focusable=[checkbox, a, a, a, button].
//
// Run: node --experimental-strip-types --test tests/lib/pipeline-row-tabstops.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/pipeline-view.tsx"),
  "utf8",
);

test("pipeline-view skips # and role report links in the tab order", () => {
  const withNum = [...src.matchAll(/<Link\b[^>]*>\s*#\{r\.n\}/g)].map((m) => m[0]);
  const withRole = [...src.matchAll(/<Link\b[^>]*>\{r\.role\}/g)].map((m) => m[0]);
  assert.equal(withNum.length, 1, `expected one # link, got ${withNum.length}: ${JSON.stringify(withNum)}`);
  assert.equal(withRole.length, 1, `expected one role link, got ${withRole.length}: ${JSON.stringify(withRole)}`);
  assert.match(withNum[0], /tabIndex=\{-1\}/, `# link must set tabIndex={-1}: ${withNum[0]}`);
  assert.match(withRole[0], /tabIndex=\{-1\}/, `role link must set tabIndex={-1}: ${withRole[0]}`);
  const companyOpen = [...src.matchAll(/<Link\b[^>]*className="flex items-center[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.equal(companyOpen.length, 1, `expected one company link, got ${companyOpen.length}`);
  assert.doesNotMatch(companyOpen[0], /tabIndex=\{-1\}/, "company link must stay tabbable");
});

test("pipeline tabs expose aria-pressed for the active tab", () => {
  assert.match(src, /aria-pressed=\{visibleTab === t\}/);
});
