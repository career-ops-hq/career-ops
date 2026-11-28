// The apply checklist error page must call Next's retry prop, which refreshes
// the server render; reset only clears the boundary and leaves a repaired file
// reading as failed. Production error messages are redacted, so the page shows
// digest — the value that matches the server log line — instead.
//
// Run from web/: node --test tests/lib/apply-error-retry.test.mjs

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const source = readFileSync(
  fileURLToPath(new URL("../../src/app/pipeline/[id]/apply/error.tsx", import.meta.url)),
  "utf8",
);

test("Try again calls the Next.js retry prop", () => {
  assert.match(source, /retry:\s*\(\)\s*=>\s*void/);
  assert.match(source, /onClick=\{\(\)\s*=>\s*retry\(\)\}/);
  assert.doesNotMatch(source, /onClick=\{\(\)\s*=>\s*reset\(\)\}/);
});

test("the page shows error.digest rather than error.message", () => {
  assert.match(source, /error\.digest/);
  assert.doesNotMatch(source, /error\.message/);
});
