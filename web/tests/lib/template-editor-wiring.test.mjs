import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// While a save is in flight, "Discard and close" would unmount the editor but not
// cancel the PUT, so an edit the user just discarded could still be written. The
// button must wait for the save. Source-reading, in the style of
// config-form-persist-wiring.test.mjs: the editor has no test harness short of a
// live server.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/templates/template-editor.tsx"),
  "utf8",
);

test("the close/discard button is disabled while a save is in flight", () => {
  const opening = src.match(/<button\b[^>]*onClick=\{onClose\}[^>]*>/);
  assert.ok(opening, "found the button that calls onClose");
  assert.match(opening[0], /disabled=\{busy\}/);
});

test("Save is still gated on busy as well", () => {
  const opening = src.match(/<button\b[^>]*onClick=\{\(\) => void save\(\)\}[^>]*>/);
  assert.ok(opening, "found the Save button");
  assert.match(opening[0], /busy/);
});

test("the textarea takes focus once the template has loaded", () => {
  assert.match(src, /<textarea\b[^>]*ref=\{areaRef\}/);
  assert.match(src, /useEffect\(\(\) => \{[^}]*areaRef\.current\?\.focus\(\)[^}]*\}, \[loaded\]\)/);
  assert.match(src, /const loaded = text !== null/);
});
