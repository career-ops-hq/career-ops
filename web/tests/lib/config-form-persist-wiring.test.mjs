import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// The helper tests in saved-cli-pick.test.mjs prove pickDefaultInstalled returns
// the right id, but they cannot see whether ConfigForm actually WRITES it. Delete
// the persistCliId call from the detect effect and every one of them still passes
// — while the bug this PR fixes is fully back: Config renders a selected CLI over
// an empty localStorage key, and every AI surface that reads that key silently
// does nothing. These assertions cover that wiring, in the source-reading style of
// first-run-copy.test.mjs and decision-card-cta.test.mjs.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/config-form.tsx"),
  "utf8",
);

test("ConfigForm imports the persist writer and the any-count picker", () => {
  assert.match(src, /import\s*{[^}]*\bpersistCliId\b[^}]*}\s*from\s*"@\/lib\/saved-cli"/);
  assert.match(src, /import\s*{[^}]*\bpickDefaultInstalled\b[^}]*}\s*from\s*"@\/lib\/cli-pick\.mjs"/);
});

test("the auto-selected CLI is persisted, not only rendered", () => {
  // The call the PR exists to add. Without it the rendered selection never
  // reaches localStorage.
  assert.match(
    src,
    /persistCliId\(\s*auto\s*\)/,
    "config-form.tsx must call persistCliId(auto) so the rendered default is written to storage",
  );
});

test("persisting is guarded by readSavedCliId so an explicit choice is never overwritten", () => {
  assert.match(src, /if\s*\(\s*!readSavedCliId\(\)\s*\)\s*persistCliId\(\s*auto\s*\)/);
});

test("the detect effect picks with pickDefaultInstalled, not the sole-install helper", () => {
  const detect = src.slice(src.indexOf('fetch("/api/clis")'), src.indexOf("function save()"));
  assert.notEqual(detect.length, 0, "could not locate the CLI-detection effect");
  assert.match(detect, /pickDefaultInstalled\(\s*list\s*\)/);
  assert.doesNotMatch(
    detect,
    /pickSoleInstalled\s*\(/,
    "the sole-install helper is what left multi-CLI machines unpersisted; the effect must not use it",
  );
});

test("the persist call lives in the detect effect, ahead of save()", () => {
  const persist = src.indexOf("persistCliId(auto)");
  const save = src.indexOf("function save()");
  assert.notEqual(persist, -1);
  assert.notEqual(save, -1);
  assert.ok(persist < save, "persistCliId(auto) must run in the detect effect, not only on an explicit Save");
});
