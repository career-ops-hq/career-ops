// The age check has to run in a zone where local midnight and UTC midnight
// differ. On a UTC machine the old code and the new code agree, so the test
// would stay green without the fix. The child forces America/New_York.
//
// postedAt from a job board is the UTC day. At 23:00 in New York that day is
// already tomorrow on the UTC clock. The inbox still calls it today.
//
// Run from web/: node --experimental-strip-types --test tests/lib/inbox-local-day.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { daysSince } from "../../src/lib/inbox.ts";

const HERE = fileURLToPath(import.meta.url);
const NOW = Date.parse("2026-11-16T04:00:00Z");

function localIso(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

if (process.env.INBOX_DAY_CHILD === "1") {
  test("a posting dated the local day is today, and the UTC day is not negative", () => {
    assert.equal(localIso(NOW), "2026-11-15");
    assert.equal(daysSince("2026-11-15", NOW), 0);
    assert.equal(daysSince("2026-11-14", NOW), 1);
    assert.equal(daysSince("2026-11-16", NOW), 0);
  });
} else {
  test("local-day age is checked in America/New_York, not the machine zone", () => {
    const env = { ...process.env, TZ: "America/New_York", INBOX_DAY_CHILD: "1" };
    // A nested `node --test` that keeps the runner's channel reports to the
    // parent and exits 0 even when the assertion fails.
    delete env.NODE_CHANNEL_FD;
    delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--test", HERE],
      { env, encoding: "utf8" },
    );
    assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  });
}
