import assert from "node:assert/strict";
import { test } from "node:test";
import { daysSince } from "../../src/lib/inbox.ts";

function localIso(ms) {
  const date = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

test("a posting dated today is not yesterday on a US evening", () => {
  const now = Date.parse("2026-11-16T04:00:00Z");
  const today = localIso(now);
  const [year, month, day] = today.split("-").map(Number);
  const prior = new Date(Date.UTC(year, month - 1, day));
  prior.setUTCDate(prior.getUTCDate() - 1);
  const yesterday = prior.toISOString().slice(0, 10);
  assert.equal(daysSince(today, now), 0);
  assert.equal(daysSince(yesterday, now), 1);
});
