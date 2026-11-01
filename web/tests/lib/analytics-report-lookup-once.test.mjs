import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import "../helpers/web-ts-alias-loader.mjs";

const skipTs = !process.features?.typescript && "this Node cannot import career-ops.ts (no type stripping)";
const careerOps = skipTs ? {} : await import("@/lib/career-ops");
const analytics = skipTs ? {} : await import("@/lib/analytics-data");

const ROWS = 40;
const report = (archetype) => `# Evaluation\n\n## Machine Summary\n\n\`\`\`yaml\narchetype_primary: ${archetype}\n\`\`\`\n`;

function seed(root) {
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "reports"), { recursive: true });
  const rows = [];
  for (let n = 1; n <= ROWS; n++) {
    const file = `${String(n).padStart(3, "0")}-northwind-labs-2026-10-01.md`;
    writeFileSync(join(root, "reports", file), report(`Archetype ${n}`));
    const link = n % 2 ? `[${n}](../reports/${file})` : "—";
    rows.push(`| ${n} | 2026-10-01 | Northwind Labs | Engineer ${n} | 4.0/5 | Applied | ❌ | ${link} | remote |`);
  }
  writeFileSync(join(root, "reports", "002-RESERVED.md"), "");
  writeFileSync(join(root, "data", "applications.md"), [
    "# Applications Tracker", "",
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows, "",
  ].join("\n"));
}

test("Search stats reads the tracker and lists reports/ once for the whole page", { skip: skipTs }, () => {
  const root = mkdtempSync(join(tmpdir(), "co-analytics-lookup-once-"));
  const prevRoot = process.env.CAREER_OPS_ROOT;
  const { readFileSync, readdirSync } = fs;
  const reads = [];
  const listings = [];
  try {
    seed(root);
    process.env.CAREER_OPS_ROOT = root;
    fs.readFileSync = function (p, ...rest) {
      reads.push(String(p));
      return readFileSync.call(this, p, ...rest);
    };
    fs.readdirSync = function (p, ...rest) {
      listings.push(String(p));
      return readdirSync.call(this, p, ...rest);
    };

    const rows = analytics.analyticsApplications(careerOps.readApplications());

    assert.deepEqual(
      rows.map((r) => r.archetype),
      Array.from({ length: ROWS }, (_, i) => `Archetype ${i + 1}`),
      "every row, linked or found by number, gets its own report's archetype",
    );
    assert.equal(reads.filter((p) => p.endsWith("applications.md")).length, 1, "the tracker was read more than once");
    assert.ok(listings.filter((p) => p.endsWith("reports")).length <= 1, "reports/ was listed more than once");
  } finally {
    fs.readFileSync = readFileSync;
    fs.readdirSync = readdirSync;
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("two rows that share a number keep the report each one links", { skip: skipTs }, () => {
  const root = mkdtempSync(join(tmpdir(), "co-analytics-shared-number-"));
  const prevRoot = process.env.CAREER_OPS_ROOT;
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    mkdirSync(join(root, "reports"), { recursive: true });
    writeFileSync(join(root, "reports", "011-larkspur.md"), report("Larkspur"));
    writeFileSync(join(root, "reports", "011-quillfeather.md"), report("Quillfeather"));
    writeFileSync(join(root, "data", "applications.md"), [
      "# Applications Tracker", "",
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 11 | 2026-10-01 | Larkspur Analytics | Engineer | 4.0/5 | Applied | ❌ | [11](../reports/011-larkspur.md) | remote |",
      "| 11 | 2026-10-02 | Quillfeather Health | Designer | 4.0/5 | Applied | ❌ | [11](../reports/011-quillfeather.md) | remote |",
      "",
    ].join("\n"));
    process.env.CAREER_OPS_ROOT = root;
    const rows = analytics.analyticsApplications(careerOps.readApplications());
    assert.deepEqual(rows.map((row) => row.archetype), ["Larkspur", "Quillfeather"]);
  } finally {
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});

test("a reports path that is not a directory is an error, not missing data", { skip: skipTs }, () => {
  const root = mkdtempSync(join(tmpdir(), "co-analytics-reports-not-dir-"));
  const prevRoot = process.env.CAREER_OPS_ROOT;
  try {
    mkdirSync(join(root, "data"), { recursive: true });
    writeFileSync(join(root, "reports"), "not a directory\n");
    writeFileSync(join(root, "data", "applications.md"), [
      "# Applications Tracker", "",
      "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
      "|---|---|---|---|---|---|---|---|---|",
      "| 11 | 2026-10-01 | Larkspur Analytics | Engineer | 4.0/5 | Applied | ❌ | - | remote |",
      "",
    ].join("\n"));
    process.env.CAREER_OPS_ROOT = root;
    assert.throws(
      () => analytics.analyticsApplications(careerOps.readApplications()),
      (err) => err && err.code === "ENOTDIR",
    );
  } finally {
    if (prevRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = prevRoot;
    rmSync(root, { recursive: true, force: true });
  }
});
