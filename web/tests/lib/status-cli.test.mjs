// Tests for the two things /api/status decides about set-status.mjs before and
// after it spawns: which tracker row was asked for, and which line of stdout is
// the CLI's JSON document.
//
// Imports directly from status-cli.mjs (the single source of truth) so the test
// and the route can never drift.
//
// Run:  node --test tests/lib/status-cli.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCliJson, trackerRowArg } from "../../src/lib/status-cli.mjs";

test("the JSON document is read even when a warning printed a brace first", () => {
  // --json puts one JSON object on stdout, but the CLI may print diagnostics
  // ahead of it. Scanning forward from the first `{` slices from inside the
  // warning, JSON.parse throws, and the route answers 500 for a write that
  // actually succeeded.
  const stdout = [
    "warning: ledger append skipped for row {12} (no notes column)",
    '{"ok":true,"changed":true,"statusLogged":true}',
  ].join("\n");
  assert.deepEqual(parseCliJson(stdout), { ok: true, changed: true, statusLogged: true });
});

test("a brace inside a warning is not mistaken for the document when no document follows", () => {
  assert.equal(parseCliJson("warning: nothing to do for {row 4}\n"), null);
});

test("the last JSON object wins, so a diagnostic object cannot shadow the result", () => {
  const stdout = ['{"note":"pre-flight"}', '{"ok":true,"changed":false}'].join("\n");
  assert.deepEqual(parseCliJson(stdout), { ok: true, changed: false });
});

test("a plain object is required: no output, no JSON, and a bare array all read as absent", () => {
  assert.equal(parseCliJson(""), null);
  assert.equal(parseCliJson("no json at all\n"), null);
  assert.equal(parseCliJson("[1,2,3]\n"), null);
});

test("a tracker row is the # column, so only digits select one", () => {
  assert.equal(trackerRowArg("42"), "42");
  assert.equal(trackerRowArg(42), "42");
  assert.equal(trackerRowArg("  42  "), "42");
});

test("a row selector that cannot name a row is refused before anything is spawned", () => {
  // body.n arrives from untrusted JSON, so it can be any shape. String(n) would
  // send "[object Object]" to --row and pay for a process spawn and a lock
  // acquisition to be told it is unusable.
  for (const bad of [{}, [], ["42"], null, undefined, "", "  ", "42abc", "-1", "1.5", "0x2a", true]) {
    assert.equal(trackerRowArg(bad), null, `${JSON.stringify(bad) ?? String(bad)} must not select a row`);
  }
});
