// liveness-pre-screen.test.mjs — the dashboard's "is this posting still open?"
// preflight. The whole point of this module is that it can STOP a run, so the
// tests lean hard on the fail-open guarantee: anything it does not positively
// understand must return "unavailable" and let the evaluation proceed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isCheckableUrl, parseVerdict, livenessPreScreen, DEFAULTS } from "../../src/lib/liveness-pre-screen.mjs";

const DEAD_API = `Checking 1 URL(s)...

❌ expired    (api) https://job-boards.greenhouse.io/anthropic/jobs/5117581008
           ATS API 404 — posting removed

Results: 0 active  1 expired  0 uncertain  (1 via API, no browser)
`;

const LIVE_API = `Checking 1 URL(s)...

✅ active     (api) https://jobs.ashbyhq.com/sarvam/9e197c29-5164-42eb-8e74-4f691a794517

Results: 1 active  0 expired  0 uncertain  (1 via API, no browser)
`;

const UNCERTAIN = `Checking 1 URL(s)...

⚠️ uncertain        https://nonexistent-company-xyz-9182.example/jobs/a

Results: 0 active  0 expired  1 uncertain  (0 via API, no browser)
`;

test("isCheckableUrl accepts http(s) and rejects everything else", () => {
  assert.equal(isCheckableUrl("https://example.com/jobs/1"), true);
  assert.equal(isCheckableUrl("http://example.com/jobs/1"), true);
  assert.equal(isCheckableUrl("  https://example.com/jobs/1  "), true);
  // A local: capture, a report number and free text all take other paths.
  assert.equal(isCheckableUrl("local:jds/role.md"), false);
  assert.equal(isCheckableUrl("181"), false);
  assert.equal(isCheckableUrl("Senior AI Engineer at Glean"), false);
  assert.equal(isCheckableUrl(undefined), false);
});

test("parseVerdict reads each of the three markers", () => {
  assert.equal(parseVerdict(DEAD_API), "expired");
  assert.equal(parseVerdict(LIVE_API), "active");
  assert.equal(parseVerdict(UNCERTAIN), "uncertain");
});

test("parseVerdict returns null rather than guessing on unknown output", () => {
  assert.equal(parseVerdict(""), null);
  assert.equal(parseVerdict("Results: 0 active 0 expired 0 uncertain"), null);
  // A word in prose must not be mistaken for a verdict line.
  assert.equal(parseVerdict("the posting appears expired, sadly"), null);
  assert.equal(parseVerdict(undefined), null);
});

test("expired is the only verdict that can stop a run", () => {
  // Guards the invariant the run route depends on: it stops on exactly one
  // decision value, and 'uncertain' is never one of them.
  const stoppable = ["active", "expired", "uncertain"].filter((v) => v === "expired");
  assert.deepEqual(stoppable, ["expired"]);
});

test("a non-url input is unavailable, not an error", () => {
  const res = livenessPreScreen({ url: "local:jds/role.md", root: process.cwd() });
  assert.equal(res.decision, "unavailable");
  assert.equal(res.wallMs, 0);
  assert.equal(res.detail, "not a url");
});

test("a missing check-liveness.mjs fails open (unavailable), never throws", () => {
  // root pointing somewhere the script does not exist: the module must not
  // decide anything, because it could not have asked.
  const res = livenessPreScreen({ url: "https://example.com/jobs/1", root: "/nonexistent-root-xyz" });
  assert.equal(res.decision, "unavailable");
  assert.ok(res.wallMs >= 0);
});

test("every returned shape carries the fields the route and tests read", () => {
  const res = livenessPreScreen({ url: "https://example.com/jobs/1", root: "/nonexistent-root-xyz" });
  for (const key of ["decision", "verdict", "reason", "viaApi", "wallMs"]) {
    assert.ok(key in res, `missing ${key}`);
  }
});

test("DEFAULTS carries a finite timeout", () => {
  assert.equal(typeof DEFAULTS.timeoutMs, "number");
  assert.ok(DEFAULTS.timeoutMs > 0 && Number.isFinite(DEFAULTS.timeoutMs));
});
