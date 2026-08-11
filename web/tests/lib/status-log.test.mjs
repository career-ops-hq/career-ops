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

test("appendStatusTransition: a ledger that cannot be written never throws", () => {
  // Given a tracker path inside a directory that does not exist, so the append
  // cannot succeed. (Permissions are not used to provoke this: chmod does not
  // restrict directory writes on Windows, so a mode-based fixture passes on
  // POSIX and fails on CI.)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "status-log-"));
  const tracker = path.join(dir, "no-such-dir", "applications.md");

  // When the append fails
  const res = appendStatusTransition({ trackerFile: tracker, num: 2, from: "Evaluated", to: "Applied" });

  // Then it reports the failure instead of raising — the status write has
  // already committed, and a ledger problem must never surface as a failed
  // status change
  assert.equal(res.logged, false);
  assert.match(res.reason, /^error:/);
});

test("appendStatusTransition: a call with missing arguments reports instead of throwing", () => {
  // Given a caller that omits the arguments entirely, and one that omits only
  // the tracker path

  // When each is invoked
  // Then both report the failure. "Never throws" has to hold for a caller bug
  // too: the API route destructures the result after its tracker write has
  // already committed, so an exception here would surface a completed status
  // change as a 500.
  assert.deepEqual(appendStatusTransition(), { logged: false, reason: "invalid-field" });
  assert.deepEqual(appendStatusTransition({ num: 1, from: "Evaluated", to: "Applied" }), {
    logged: false,
    reason: "invalid-field",
  });
});

test("appendStatusTransition: an impossible or malformed date is rejected, not written", () => {
  // Given dates that pass a tab/newline check but do not name a real day —
  // a rolled-over day, an out-of-range month, free text, and an empty string
  for (const date of ["2026-02-30", "2026-13-40", "not-a-date", ""]) {
    const tracker = fixture();

    // When one is submitted
    const res = appendStatusTransition({ trackerFile: tracker, num: 6, from: "Evaluated", to: "Applied", date });

    // Then nothing is written. The ledger is the only record of WHEN a
    // transition happened, and funnel-velocity.mjs measures elapsed time from
    // this column — a date that cannot be parsed back is worse than a missing
    // row, because it is counted as real.
    assert.equal(res.logged, false, `expected ${JSON.stringify(date)} to be rejected`);
    assert.equal(res.reason, "invalid-field");
    assert.equal(fs.existsSync(ledgerFor(tracker)), false);
  }
});

test("appendStatusTransition: a value with no primitive form is rejected, not thrown", () => {
  // Given a value that cannot be converted to a string at all: a null-prototype
  // object has no toString, so String() on it throws. Both the date check and
  // the column check run before the try, so an unguarded conversion escapes the
  // helper entirely, which is the one thing it promises not to do.
  for (const field of ["date", "num", "from", "source"]) {
    const tracker = fixture();

    // When one is submitted in any of the inspected columns
    const res = appendStatusTransition({
      trackerFile: tracker,
      num: 1,
      from: "Evaluated",
      to: "Applied",
      [field]: Object.create(null),
    });

    // Then it comes back reported, like every other rejected input
    assert.deepEqual(res, { logged: false, reason: "invalid-field" }, `field: ${field}`);
    assert.equal(fs.existsSync(ledgerFor(tracker)), false);
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
