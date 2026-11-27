import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const { findApplication, findReportFile } = await import("../../src/lib/career-ops.ts");

function withTracker(fn) {
  const root = mkdtempSync(join(tmpdir(), "find-app-"));
  mkdirSync(join(root, "data"));
  mkdirSync(join(root, "reports"));
  writeFileSync(join(root, "reports", "007-acme-2026-07-01.md"), "# Acme\n");
  writeFileSync(join(root, "data", "applications.md"), [
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
    "| 7 | 2026-07-01 | Acme | Engineer | 4.5/5 | Evaluated | | [007](../reports/007-acme-2026-07-01.md) | |",
    "| 12 | 2026-07-02 | Globex | Analyst | 4.0/5 | Evaluated | | | |",
  ].join("\n"));
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

test("findApplication matches a zero-padded id the same way findReportFile does", () => {
  withTracker(() => {
    assert.ok(findReportFile("007"));
    assert.equal(findApplication("007")?.company, "Acme");
    assert.equal(findApplication("7")?.company, "Acme");
    assert.equal(findApplication("012")?.company, "Globex");
  });
});

test("findApplication returns null for a non-numeric or unknown id", () => {
  withTracker(() => {
    assert.equal(findApplication("abc"), null);
    assert.equal(findApplication("7abc"), null);
    assert.equal(findApplication("7.5"), null);
    assert.equal(findApplication("99"), null);
    assert.equal(findApplication(""), null);
  });
});
