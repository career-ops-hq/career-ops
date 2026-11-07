import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// The sequencing rules are tested as behavior in templates-state.test.mjs. This
// only checks the component actually goes through them, since the rules cannot
// see whether anything calls them. Source-reading, in the style of
// config-form-persist-wiring.test.mjs; deliberately no pattern spans a block.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/templates/templates-section.tsx"),
  "utf8",
);

test("choosing a default goes through settleChoice, which owns the apply-then-reload order", () => {
  assert.match(src, /import\s*{[^}]*\bsettleChoice\b[^}]*}\s*from\s*"@\/lib\/templates-state\.mjs"/);
  assert.match(src, /await settleChoice\(/);
});

test("a failed reload is classified by loadFailureView, not hard-coded", () => {
  assert.match(src, /setLoadError\(loadFailureView\(/);
});

test("Retry never passes the click event as the list-is-current flag", () => {
  assert.doesNotMatch(src, /onClick=\{load\}/);
});
