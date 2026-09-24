import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeScanResults, timedOutMessage } from "../../src/lib/core/scan-merge.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

test("mergeScanResults sums counts across sources and ORs capHit", () => {
  const merged = mergeScanResults(
    [
      { companiesScanned: 150, unreachableBoards: 40, postingsKept: 1, companiesAvailable: 8333, capHit: true, datasetStatus: { greenhouse: "ok" }, postingsDroppedNoDate: 0, offers: [] },
      { companiesScanned: 150, unreachableBoards: 60, postingsKept: 0, companiesAvailable: 4000, capHit: false, datasetStatus: { ashby: "stale" }, postingsDroppedNoDate: 3, offers: [] },
    ],
    1,
  );
  assert.deepEqual(merged, {
    companiesScanned: 300,
    unreachable: 100,
    matches: 1,
    companiesAvailable: 12333,
    capHit: true,
    datasetStatus: { greenhouse: "ok", ashby: "stale" },
    postingsDroppedNoDate: 3,
  });
});

test("mergeScanResults falls back to the surfaced offer count, and omits fields no source reported", () => {
  const merged = mergeScanResults([{ companiesScanned: 5, offers: [] }], 2);
  assert.equal(merged.matches, 2);
  assert.equal(merged.capHit, false);
  assert.equal("companiesAvailable" in merged, false);
  assert.equal("postingsDroppedNoDate" in merged, false);
});

test("timedOutMessage names the source, the deadline and the fix", () => {
  const one = timedOutMessage(["Workday"], 230);
  assert.match(one, /^Workday didn't finish within 230s, so its results are missing\./);
  assert.match(one, /without Workday/);
  assert.doesNotMatch(one, /no readable output/);
  assert.match(timedOutMessage(["Lever", "Workday"], 230), /^Lever and Workday .* their results/);
  assert.match(timedOutMessage(["Greenhouse", "Lever", "Workday"], 230), /^Greenhouse, Lever and Workday /);
});

// Wiring — source-reading, in the style of config-form-persist-wiring.test.mjs
// (scan.ts / the provider import through the "@/..." alias).

test("--json discovery runs one scanner child per source", () => {
  const src = readFileSync(join(SRC, "lib/core/scan.ts"), "utf8");
  // A single child spanning every source loses every result when one source hits
  // the deadline, because --json prints only on exit.
  assert.match(src, /ats\.map\(\(a\)\s*=>\s*runScanner\(\[a\],\s*true,/);
  assert.match(src, /incomplete\.length \? \{ incomplete \} : \{\}/);
  assert.match(src, /timedOutMessage\(/);
});

test("the Explore provider treats incomplete sources as a partial result", () => {
  const src = readFileSync(join(SRC, "components/explore/explore-provider.tsx"), "utf8");
  const summary = src.slice(src.indexOf('case "summary"'), src.indexOf('case "error"'));
  assert.match(summary, /ev\.incomplete\?\.length/);
  assert.match(summary, /if \(ev\.unreachable > 0 \|\| datasetIssue\) setPartial\(true\)/);
});
