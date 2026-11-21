// The Explore card's "posted" label must count days the way the inbox does.
// Its own Math.round over UTC midnight called a posting from today "1d ago"
// from 12:00 UTC on.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { daysSince } from "../../src/lib/inbox.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

test("the Explore card dates a posting with the inbox's daysSince", () => {
  const src = readFileSync(join(SRC, "components/explore/discovery-card.tsx"), "utf8");
  const body = src.slice(src.indexOf("function freshness("), src.indexOf("\n}\n", src.indexOf("function freshness(")));
  assert.match(body, /daysSince\(postedAt, Date\.now\(\)\)/);
  assert.doesNotMatch(body, /Math\.round/);
  assert.equal(daysSince("2026-11-16", Date.parse("2026-11-16T13:00:00Z")), 0);
});
