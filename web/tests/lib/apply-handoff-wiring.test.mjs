// The review screen and the fill route are what the person can see: a green
// "pre-filled" banner, a resume claim, and an employer window. These read the
// source the page ships, so a rewrite that puts the old promise back fails here.
//
// Run: node --test tests/lib/apply-handoff-wiring.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const src = join(dirname(fileURLToPath(import.meta.url)), "../../src");

test("the review screen does not promise a CV from the field label alone", () => {
  const view = readFileSync(join(src, "components/apply-view.tsx"), "utf8");
  assert.match(view, /resumeFieldNotice\(/);
  assert.doesNotMatch(view, /will be attached automatically/);
});

test("the fill route holds the employer window when the handoff gate refuses", () => {
  const route = readFileSync(join(src, "app/api/apply/fill/route.ts"), "utf8");
  assert.match(route, /handoffDecision\(/);
  assert.match(route, /decision\.handoff/);
});

test("a finished fill is not marked pre-filled unless the server handed the window over", () => {
  const provider = readFileSync(join(src, "components/apply/apply-provider.tsx"), "utf8");
  assert.match(provider, /if \(d\.handedOff\)/);
});
