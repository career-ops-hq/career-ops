import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { showPortalsSetup } from "../../src/lib/portals-setup.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("a missing portals.yml is explained before the health check", () => {
  const view = readFileSync(join(root, "src/components/portals-view.tsx"), "utf8");
  const page = readFileSync(join(root, "src/app/portals/page.tsx"), "utf8");
  // The old empty line rendered only after a health check, and it told you to
  // ask the assistant. With no file, the page was a single button.
  assert.match(view, /templates\/portals\.example\.yml/);
  assert.match(view, /A health check does not create that file/);
  assert.match(view, /showPortalsSetup\(missing, res\)/);
  assert.doesNotMatch(view, /ask the assistant to set up/);
  assert.match(page, /missing=\{missing\}/);
});

test("the setup steps stay up until a check finds the file", () => {
  // Before any check, the page's own read decides.
  assert.equal(showPortalsSetup(true, null), true);
  assert.equal(showPortalsSetup(false, null), false);
  // A check that could not run says nothing about the file.
  assert.equal(showPortalsSetup(true, { available: false, configured: false }), true);
  assert.equal(showPortalsSetup(true, { available: false, configured: false, error: "timed out" }), true);
  assert.equal(showPortalsSetup(false, { available: false, configured: false, error: "timed out" }), false);
  // A check that ran reports the file directly.
  assert.equal(showPortalsSetup(false, { available: true, configured: false }), true);
  assert.equal(showPortalsSetup(true, { available: true, configured: true }), false);
});
