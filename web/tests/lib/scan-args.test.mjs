// Explore caps each source at a few hundred companies. Without --shuffle the
// scanner takes the dataset's alphabetical prefix, so every Explore saw the
// same companies whose names start with a digit or "a".
//
// Run:  node --test tests/lib/scan-args.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scannerArgs } from "../../src/lib/core/scan-args.mjs";

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// scan-ats-full.mjs imports js-yaml, which a web-only install does not have.
let scanner = null;
try {
  scanner = await import(path.join(CORE, "scan-ats-full.mjs"));
} catch {
  scanner = null;
}

const DIRECTORY = Array.from({ length: 2000 }, (_, i) => `company-${String(i).padStart(4, "0")}`);

test("Explore samples companies from the whole directory, not its alphabetical prefix", { skip: !scanner }, () => {
  const argv = ["node", "scan-ats-full.mjs", ...scannerArgs({ ats: ["greenhouse"], json: true, sinceDays: 7, limitPerAts: 150 })];
  const opts = scanner.parseArgs(argv);
  const sample = scanner.sampleCompanies(DIRECTORY, opts.limit, opts.shuffle);
  assert.equal(opts.dryRun, true);
  assert.equal(sample.length, 150);
  assert.ok(sample.filter((slug) => slug >= "company-1000").length > 0, "no company from the second half was sampled");
});

test("scannerArgs keeps the window, sources, cap and output mode Explore asked for", () => {
  assert.deepEqual(
    scannerArgs({ ats: ["greenhouse", "lever"], json: false, sinceDays: 30, limitPerAts: 300 }),
    ["--dry-run", "--since", "30", "--ats", "greenhouse,lever", "--limit", "300", "--shuffle"],
  );
  assert.deepEqual(
    scannerArgs({ ats: ["ashby"], json: true, sinceDays: 0, limitPerAts: 0 }),
    ["--dry-run", "--since", "7", "--ats", "ashby", "--limit", "150", "--shuffle", "--json"],
  );
});
