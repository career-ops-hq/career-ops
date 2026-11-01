import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// The report control on a follow-up card was an icon with title "Open report"
// and no visible text. A person scanning Today could not tell that control
// opens the report. These assertions read the source, same as the other
// wiring tests, because the bug is the missing word in the markup.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/home/follow-up-card.tsx"),
  "utf8",
);

test("the follow-up report link shows the word Open", () => {
  const start = src.indexOf('title="Open report"');
  assert.ok(start >= 0, "the report link keeps title Open report");
  const link = src.slice(start, src.indexOf("Snooze", start));
  assert.match(link, />Open</, "a visible Open sits in the report link");
});
