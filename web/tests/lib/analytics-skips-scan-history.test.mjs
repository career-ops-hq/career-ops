// The analytics page reads only tracker rows. It used to get them from
// pipelineSummary(), which also parses all of data/scan-history.tsv (append-only,
// one row per posting ever seen) to date the inbox, and then dropped the inbox.
//
// Run: npm test -- tests/lib/analytics-skips-scan-history.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "../..");

test("the analytics page does not go through pipelineSummary()", () => {
  const src = readFileSync(join(webRoot, "src/app/analytics/page.tsx"), "utf8");
  assert.doesNotMatch(src, /pipelineSummary\s*\(/, "analytics/page.tsx calls pipelineSummary(), which parses scan-history");
  assert.match(src, /readApplications\s*\(/);
});

const skipTs = !process.features?.typescript && "this Node cannot import career-ops.ts (no type stripping)";
const mods = skipTs ? {} : await import("@/lib/career-ops");

test("readApplications() leaves scan-history.tsv unread; pipelineSummary() reads it", { skip: skipTs }, () => {
  const root = mkdtempSync(join(tmpdir(), "co-analytics-scan-history-"));
  const prevRoot = process.env.CAREER_OPS_ROOT;
  const original = fs.readFileSync;
  const reads = [];
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "data/applications.md"), [
      "# Applications Tracker", "",
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-10-01 | Acme | Engineer | 4.2/5 | Applied | ❌ | — | note |", "",
    ].join("\n"));
    writeFileSync(join(root, "data/scan-history.tsv"), "url\tfirst_seen\nhttps://x.test/1\t2026-10-01\n");
    process.env.CAREER_OPS_ROOT = root;
    fs.readFileSync = function (p, ...rest) {
      reads.push(String(p));
      return original.call(this, p, ...rest);
    };
    const scanReads = () => reads.filter((p) => p.endsWith("scan-history.tsv")).length;

    const apps = mods.readApplications();
    assert.equal(apps.length, 1);
    assert.equal(scanReads(), 0, "readApplications() read scan-history.tsv");

    mods.pipelineSummary();
    assert.equal(scanReads(), 1, "control: pipelineSummary() is expected to read it");
  } finally {
    fs.readFileSync = original;
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});
