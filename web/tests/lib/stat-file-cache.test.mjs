import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const { readApplications, readScanDates, readInbox } = await import("../../src/lib/career-ops.ts");
const { assembleDedupContext } = await import("../../src/lib/core/discover.ts");

const origRead = fs.readFileSync;
const reads = [];
fs.readFileSync = function (path, ...args) {
  reads.push(String(path));
  return origRead.call(fs, path, ...args);
};

function counted(fragment) {
  return reads.filter((p) => p.includes(fragment)).length;
}

function withRoot(write, fn) {
  const root = mkdtempSync(join(tmpdir(), "stat-cache-"));
  mkdirSync(join(root, "data"));
  write(root);
  const prev = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  const mark = reads.length;
  try {
    return fn(root);
  } finally {
    if (prev === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
    reads.length = mark;
  }
}

test("an unchanged scan history is not read again, and a new row is", () => {
  withRoot((root) => {
    writeFileSync(join(root, "data", "scan-history.tsv"), [
      "url\tfirst_seen\tportal\ttitle\tcompany",
      "https://jobs.example.com/a\t2024-01-02\tgreenhouse\tRole\tLumenfold",
      "https://jobs.example.com/a\t2020-01-01\tgreenhouse\tRole\tLumenfold",
      "https://jobs.example.com/b\t2024-05-01\tashby\tRole\tPaperkite",
    ].join("\n"));
  }, () => {
    const first = readScanDates();
    assert.equal(first.get("https://jobs.example.com/a"), "2024-01-02");
    assert.equal(first.get("https://jobs.example.com/b"), "2024-05-01");
    const afterFirst = counted("scan-history.tsv");
    assert.ok(afterFirst >= 1);

    const second = readScanDates();
    assert.equal(second.get("https://jobs.example.com/b"), "2024-05-01");
    assert.equal(counted("scan-history.tsv"), afterFirst);

    appendFileSync(
      join(process.env.CAREER_OPS_ROOT, "data", "scan-history.tsv"),
      "\nhttps://jobs.example.com/c\t2026-10-01\tlever\tRole\tOddment Labs\n",
    );
    const third = readScanDates();
    assert.equal(third.get("https://jobs.example.com/c"), "2026-10-01");
    assert.equal(third.get("https://jobs.example.com/a"), "2024-01-02");
    assert.ok(counted("scan-history.tsv") > afterFirst);
  });
});

test("an unchanged tracker is not read again, and an edited row is", () => {
  withRoot((root) => {
    writeFileSync(join(root, "data", "applications.md"), [
      "# Applications Tracker",
      "",
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-01-01 | Lumenfold | Platform Engineer | 4.2/5 | Applied | | | synthetic |",
    ].join("\n"));
  }, () => {
    assert.equal(readApplications()[0].company, "Lumenfold");
    const afterFirst = counted("applications.md");
    assert.ok(afterFirst >= 1);
    assert.equal(readApplications()[0].status, "Applied");
    assert.equal(counted("applications.md"), afterFirst);

    const file = join(process.env.CAREER_OPS_ROOT, "data", "applications.md");
    writeFileSync(file, origRead(file, "utf8").replace("Applied", "Interview"));
    assert.equal(readApplications()[0].status, "Interview");
    assert.ok(counted("applications.md") > afterFirst);

    const current = origRead(file, "utf8");
    const sameSize = current.replace("Interview", "Evaluated");
    assert.equal(Buffer.byteLength(sameSize), Buffer.byteLength(current));
    const seen = statSync(file, { bigint: true }).mtimeNs;
    const deadline = Date.now() + 2000;
    let moved = false;
    while (!moved) {
      writeFileSync(file, sameSize);
      moved = statSync(file, { bigint: true }).mtimeNs !== seen;
      if (!moved && Date.now() > deadline) throw new Error("mtime did not advance");
    }
    assert.equal(readApplications()[0].status, "Evaluated");
  });
});

test("an unchanged inbox is not read again", () => {
  withRoot((root) => {
    writeFileSync(join(root, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
    ].join("\n"));
    writeFileSync(join(root, "data", "pipeline.md"), [
      "## Pending",
      "- [ ] https://jobs.example.com/inbox/1 | Lumenfold | Platform Engineer",
      "",
      "## Processed",
    ].join("\n"));
  }, () => {
    const first = readInbox([]);
    assert.equal(first.length, 1);
    assert.equal(first[0].company, "Lumenfold");
    const afterFirst = counted("pipeline.md");
    assert.ok(afterFirst >= 1);
    assert.equal(readInbox([]).length, 1);
    assert.equal(counted("pipeline.md"), afterFirst);
  });
});

test("explore dedup does not re-read scan history while the file is unchanged", () => {
  withRoot((root) => {
    writeFileSync(join(root, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
    ].join("\n"));
    writeFileSync(join(root, "data", "pipeline.md"), "## Pending\n\n## Processed\n");
    writeFileSync(join(root, "data", "scan-history.tsv"), [
      "url\tfirst_seen\tportal\ttitle\tcompany",
      "https://jobs.example.com/a\t2024-01-02\tgreenhouse\tRole\tLumenfold",
    ].join("\n"));
  }, () => {
    const first = assembleDedupContext();
    assert.equal(first.urls.size, 1);
    const afterFirst = counted("scan-history.tsv");
    assert.ok(afterFirst >= 1);
    const second = assembleDedupContext();
    assert.equal(second.urls.size, 1);
    assert.equal(counted("scan-history.tsv"), afterFirst);
  });
});
