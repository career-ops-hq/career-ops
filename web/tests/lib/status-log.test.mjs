// Tests for the web-side transition-ledger append (status-log.tsv). Imports
// directly from status-log.mjs, the single source of truth, so the test and the
// production code cannot drift.
//
// The ledger is an observation trail: the tracker stays authoritative for STATE,
// the ledger records WHEN a transition happened. Every case here is therefore
// about not corrupting that trail and never letting a ledger problem turn a
// successful status change into a failed one.
//
// Run:  node --test tests/lib/status-log.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendStatusTransition } from "../../src/lib/core/status-log.mjs";

/** Fresh temp dir with a tracker file in it; returns the tracker path. */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "status-log-"));
  const tracker = path.join(dir, "applications.md");
  fs.writeFileSync(tracker, "| # | Date | Company |\n", "utf8");
  return tracker;
}

const ledgerFor = (tracker) => path.join(path.dirname(tracker), "status-log.tsv");

test("appendStatusTransition: writes one line in the set-status.mjs format", () => {
  // Given a tracker with no ledger beside it yet
  const tracker = fixture();

  // When a real transition is recorded
  const res = appendStatusTransition({
    trackerFile: tracker,
    num: 42,
    from: "Evaluated",
    to: "Applied",
    date: "2026-08-11",
  });

  // Then exactly one line lands, in the ledger format the CLI already writes:
  // {tracker#}\t{date}\t{from}\t{to}\t{source}\t
  assert.equal(res.logged, true);
  const body = fs.readFileSync(ledgerFor(tracker), "utf8");
  assert.equal(body, "42\t2026-08-11\tEvaluated\tApplied\tweb\t\n");
});

test("appendStatusTransition: creates the ledger next to the tracker, not in cwd", () => {
  // Given a tracker in a directory of its own
  const tracker = fixture();

  // When a transition is recorded
  appendStatusTransition({ trackerFile: tracker, num: 1, from: "Evaluated", to: "SKIP" });

  // Then the ledger is a sibling of the tracker, so CAREER_OPS_TRACKER
  // redirects keep the ledger next to the tracker it describes
  assert.ok(fs.existsSync(ledgerFor(tracker)));
});

test("appendStatusTransition: a no-op re-select writes nothing", () => {
  // Given a row already marked Applied
  const tracker = fixture();

  // When the same status is submitted again
  const res = appendStatusTransition({
    trackerFile: tracker,
    num: 7,
    from: "Applied",
    to: "Applied",
  });

  // Then no ledger line is written — re-selecting a status is not a transition,
  // and a ledger full of self-transitions would corrupt funnel velocity
  assert.equal(res.logged, false);
  assert.equal(res.reason, "no-change");
  assert.equal(fs.existsSync(ledgerFor(tracker)), false);
});

test("appendStatusTransition: appends rather than overwriting", () => {
  // Given one transition already recorded
  const tracker = fixture();
  appendStatusTransition({ trackerFile: tracker, num: 3, from: "Evaluated", to: "Applied", date: "2026-08-01" });

  // When a second transition on the same row is recorded
  appendStatusTransition({ trackerFile: tracker, num: 3, from: "Applied", to: "Rejected", date: "2026-08-09" });

  // Then both survive, oldest first — the ledger is append-only history.
  // Split on the newline only: trimming would eat the format's trailing tab.
  const lines = fs.readFileSync(ledgerFor(tracker), "utf8").split("\n").slice(0, -1);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "3\t2026-08-01\tEvaluated\tApplied\tweb\t");
  assert.equal(lines[1], "3\t2026-08-09\tApplied\tRejected\tweb\t");
});

test("appendStatusTransition: records the source so web and CLI rows stay distinguishable", () => {
  // Given a caller that names a different source
  const tracker = fixture();

  // When it records a transition
  appendStatusTransition({ trackerFile: tracker, num: 9, from: "Evaluated", to: "Applied", source: "set-status" });

  // Then the source column carries it — a reader must be able to tell a
  // web-originated transition from a CLI one
  const body = fs.readFileSync(ledgerFor(tracker), "utf8");
  assert.match(body, /\tset-status\t\n$/);
});

test("appendStatusTransition: defaults the date to today when none is given", () => {
  // Given no explicit event date
  const tracker = fixture();

  // When a transition is recorded
  appendStatusTransition({ trackerFile: tracker, num: 5, from: "Evaluated", to: "Applied" });

  // Then today's date is stamped in ISO form, matching the CLI default
  const [, date] = fs.readFileSync(ledgerFor(tracker), "utf8").split("\t");
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(date, new Date().toISOString().slice(0, 10));
});

test("appendStatusTransition: an unwritable ledger never throws", () => {
  // Given a tracker whose directory cannot be written to
  const tracker = fixture();
  const dir = path.dirname(tracker);
  fs.chmodSync(dir, 0o500);

  try {
    // When the append fails
    const res = appendStatusTransition({ trackerFile: tracker, num: 2, from: "Evaluated", to: "Applied" });

    // Then it reports the failure instead of raising — the status write has
    // already committed, and a ledger problem must never surface as a failed
    // status change
    assert.equal(res.logged, false);
    assert.match(res.reason, /^error:/);
  } finally {
    fs.chmodSync(dir, 0o700);
  }
});

test("appendStatusTransition: values containing a tab or newline are rejected, not written", () => {
  // Given a status that would break the TSV row apart
  const tracker = fixture();

  // When it is submitted
  const res = appendStatusTransition({
    trackerFile: tracker,
    num: 4,
    from: "Evaluated",
    to: "Applied\tRejected",
  });

  // Then nothing is written — one malformed line silently shifts every column
  // for every downstream reader
  assert.equal(res.logged, false);
  assert.equal(res.reason, "invalid-field");
  assert.equal(fs.existsSync(ledgerFor(tracker)), false);
});
