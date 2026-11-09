// The unreadable-report page must call Next's retry prop. Next 16 passes
// retry, which refreshes the server render, and reset, which only clears the
// boundary. A repaired file stays failed if Try again calls reset.
//
// Run from web/: node --test tests/lib/report-error-retry.test.mjs

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../../src/app/pipeline/[id]/error.tsx", import.meta.url)),
  "utf8",
);

test("Try again calls the Next.js retry prop", () => {
  assert.match(source, /retry:\s*\(\)\s*=>\s*void/);
  assert.match(source, /onClick=\{\(\)\s*=>\s*retry\(\)\}/);
  assert.doesNotMatch(source, /onClick=\{\(\)\s*=>\s*reset\(\)\}/);
});
