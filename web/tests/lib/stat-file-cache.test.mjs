import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const { readApplications, readScanDates, readInbox } = await import("../../src/lib/career-ops.ts");
const { assembleDedupContext } = await import("../../src/lib/core/discover.ts");
const { cachedFileValue } = await import("../../src/lib/stat-file-cache.mjs");

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

test("a ctime change alone drops the cached value", () => {
  const origStat = fs.statSync;
  let ctimeNs = 1n;
  fs.statSync = (path, opts) => (String(path).endsWith("fixed.md")
    ? { mtimeNs: 1_700_000_000_000_000_000n, size: 10n, ctimeNs }
    : origStat.call(fs, path, opts));
  const origReadFile = fs.readFileSync;
  let text = "Applied";
  fs.readFileSync = (path, ...args) => (String(path).endsWith("fixed.md") ? text : origReadFile.call(fs, path, ...args));
  try {
    const file = join(tmpdir(), "stat-cache-controlled", "fixed.md");
    const parse = (t) => ({ status: t });
    assert.equal(cachedFileValue(file, "test", parse).status, "Applied");
    text = "Offered";
    assert.equal(cachedFileValue(file, "test", parse).status, "Applied");
    ctimeNs = 2n;
    assert.equal(cachedFileValue(file, "test", parse).status, "Offered");
  } finally {
    fs.statSync = origStat;
    fs.readFileSync = origReadFile;
  }
});

test("a same-size edit with its mtime put back is still read again", (t) => {
  withRoot((root) => {
    writeFileSync(join(root, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-01-01 | Lumenfold | Platform Engineer | 4.2/5 | Applied | | | synthetic |",
    ].join("\n"));
  }, () => {
    const file = join(process.env.CAREER_OPS_ROOT, "data", "applications.md");
    // A whole-second mtime can be put back exactly.
    utimesSync(file, 1_700_000_000, 1_700_000_000);
    assert.equal(readApplications()[0].status, "Applied");
    const before = statSync(file, { bigint: true });
    const current = origRead(file, "utf8");
    const sameSize = current.replace("Applied", "Offered");
    assert.equal(Buffer.byteLength(sameSize), Buffer.byteLength(current));
    const deadline = Date.now() + 2000;
    let after;
    do {
      writeFileSync(file, sameSize);
      utimesSync(file, 1_700_000_000, 1_700_000_000);
      after = statSync(file, { bigint: true });
      if (after.ctimeNs === before.ctimeNs && Date.now() > deadline) break;
    } while (after.ctimeNs === before.ctimeNs);
    // Some filesystems (FAT, for one) put ctime back along with mtime. The
    // controlled-stat test above covers the cache there.
    if (after.ctimeNs === before.ctimeNs) {
      t.skip("this filesystem does not advance ctime after utimes");
      return;
    }
    assert.equal(after.mtimeNs, before.mtimeNs);
    assert.equal(after.size, before.size);
    assert.equal(readApplications()[0].status, "Offered");
  });
});

test("a changed header alias table reparses the tracker without the tracker file changing", () => {
  const aliases = {
    num: "num",
    applied: "date",
    employer: "company",
    title: "role",
    fit: "score",
    stage: "status",
    resume: "pdf",
    writeup: "report",
    notes: "notes",
  };
  withRoot((root) => {
    writeFileSync(join(root, "tracker-aliases.json"), JSON.stringify(aliases));
    writeFileSync(join(root, "data", "applications.md"), [
      "| Num | Applied | Employer | Title | Fit | Stage | Resume | Writeup | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-01-01 | Lumenfold | Platform Engineer | 4.2/5 | Applied | | | synthetic |",
    ].join("\n"));
  }, () => {
    assert.equal(readApplications()[0].company, "Lumenfold");
    const afterFirst = counted("applications.md");
    assert.ok(afterFirst >= 1);
    assert.equal(readApplications()[0].role, "Platform Engineer");
    assert.equal(counted("applications.md"), afterFirst);

    const swapped = { ...aliases, employer: "role", title: "company" };
    writeFileSync(join(process.env.CAREER_OPS_ROOT, "tracker-aliases.json"), JSON.stringify(swapped));
    const again = readApplications()[0];
    assert.equal(again.company, "Platform Engineer");
    assert.equal(again.role, "Lumenfold");
    assert.ok(counted("applications.md") > afterFirst);
  });
});

test("an unchanged inbox is not read again", () => {
  withRoot((root) => {
    // The URL column only parses through an alias table. Keep one in the
    // scratch root so the result does not depend on the working directory.
    writeFileSync(join(root, "tracker-aliases.json"), JSON.stringify({
      "#": "num", date: "date", company: "company", role: "role", score: "score",
      status: "status", pdf: "pdf", report: "report", notes: "notes", url: "url",
    }));
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
    assert.equal(first[0].done, false);
    const afterFirst = counted("pipeline.md");
    assert.ok(afterFirst >= 1);

    // The tracker changes while pipeline.md does not. The cached rows must
    // still be matched against the new tracker on every call.
    writeFileSync(join(process.env.CAREER_OPS_ROOT, "data", "applications.md"), [
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |",
      "|---|---|---|---|---|---|---|---|---|---|",
      "| 1 | 2026-01-01 | Lumenfold | Platform Engineer |  | Applied |  |  |  | https://jobs.example.com/inbox/1 |",
    ].join("\n"));
    const second = readInbox(readApplications());
    assert.equal(second.length, 1);
    assert.equal(second[0].done, true);
    assert.equal(readInbox([])[0].done, false);
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

test("a file deleted between the stat and the read is null, not an error", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "stat-cache-gone-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "scan-history.tsv");
  writeFileSync(file, "url\tfirst_seen\n");
  const wrapped = fs.readFileSync;
  fs.readFileSync = function (path, ...args) {
    if (String(path) === file) rmSync(file, { force: true });
    return wrapped.call(fs, path, ...args);
  };
  try {
    assert.equal(cachedFileValue(file, "gone-test", (text) => text.length), null);
  } finally {
    fs.readFileSync = wrapped;
  }
  // Nothing was cached for the vanished file, so a new one is read.
  writeFileSync(file, "abc");
  assert.equal(cachedFileValue(file, "gone-test", (text) => text.length), 3);
});
