import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveScanTimeoutMs,
  scanTimeoutMessage,
  DEFAULT_SCAN_TIMEOUT_MS,
} from "../../src/lib/core/scan-timeout.mjs";

test("defaults when scan.timeout_seconds is missing, empty, or the profile is absent", () => {
  assert.equal(resolveScanTimeoutMs(undefined), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(resolveScanTimeoutMs(null), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(resolveScanTimeoutMs({}), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(resolveScanTimeoutMs({ scan: {} }), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(resolveScanTimeoutMs({ scan: { timeout_seconds: "" } }), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(resolveScanTimeoutMs({ scan: { timeout_seconds: "  " } }), DEFAULT_SCAN_TIMEOUT_MS);
});

test("honors a valid positive scan.timeout_seconds (seconds → ms, floored)", () => {
  assert.equal(resolveScanTimeoutMs({ scan: { timeout_seconds: 230 } }), 230_000);
  assert.equal(resolveScanTimeoutMs({ scan: { timeout_seconds: 500 } }), 500_000);
  assert.equal(resolveScanTimeoutMs({ scan: { timeout_seconds: "600" } }), 600_000);
  assert.equal(resolveScanTimeoutMs({ scan: { timeout_seconds: 1.5 } }), 1_500);
});

test("falls back on non-numeric, non-positive, or boolean values (Number(true) !== a timeout)", () => {
  for (const bad of [0, -1, -5000, "abc", "NaN", "Infinity", NaN, Infinity, true, false]) {
    assert.equal(
      resolveScanTimeoutMs({ scan: { timeout_seconds: bad } }),
      DEFAULT_SCAN_TIMEOUT_MS,
      `expected default for ${JSON.stringify(bad)}`,
    );
  }
});

test("ignores a malformed scan block (array / non-object)", () => {
  assert.equal(resolveScanTimeoutMs({ scan: [1, 2, 3] }), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(resolveScanTimeoutMs({ scan: "cli" }), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(resolveScanTimeoutMs([1, 2, 3]), DEFAULT_SCAN_TIMEOUT_MS);
});

test("the timeout message names the elapsed seconds and the config knob", () => {
  const m = scanTimeoutMessage(230_000);
  assert.match(m, /\b230s\b/);
  assert.match(m, /scan\.timeout_seconds/);
  assert.match(m, /config\/profile\.yml/);
  assert.equal(scanTimeoutMessage(60_000).includes("60s"), true);
  // exact, not rounded (#coderabbit): 1.5s must not read as 2s
  assert.equal(scanTimeoutMessage(1_500).includes("1.5s"), true);
});
