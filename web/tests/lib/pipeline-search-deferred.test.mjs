// The tracker table re-filtered and re-rendered every row synchronously on each
// search keystroke, so typing waited on the whole table. pipeline-view.tsx now
// filters on useDeferredValue(q): the input updates at once and the table
// catches up at low priority.
//
// Run: npm test -- tests/lib/pipeline-search-deferred.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/components/pipeline-view.tsx"), "utf8");

test("the search input stays bound to the immediate value", () => {
  assert.match(src, /value=\{q\}/);
});

test("the row filter reads the deferred search value, not the keystroke value", () => {
  assert.match(src, /const deferredQ = useDeferredValue\(q\)/);
  assert.match(src, /const query = deferredQ\.trim\(\)/);
  const start = src.indexOf("const matchesFilters = useCallback(");
  assert.ok(start !== -1, "row filter not found");
  const end = src.indexOf("]);", start);
  const predicate = src.slice(start, end + 3);
  // The needle is lowercased once outside the predicate, so the guard is that
  // it derives from the trimmed deferred value and nothing else.
  assert.match(src, /const needle = query\.toLowerCase\(\);/);
  assert.match(predicate, /\bneedle\b/);
  assert.doesNotMatch(predicate, /deferredQ/, "surrounding spaces in the raw value are not part of the match");
  assert.doesNotMatch(predicate, /\bq\.trim\(\)|\bq\.toLowerCase\(\)/, "the filter still reads q directly");
  assert.match(predicate, /\[minFilter, needle,/);
  assert.match(src, /tabRows\.filter\(matchesFilters\)/);
});

test("opening a row reads the current search without passing it into every row", () => {
  assert.match(src, /const detailQuery = pipelineQuery\(params\.toString\(\), deferredQ\)/);
  const followDetailStart = src.indexOf("const followDetail = useCallback(");
  const followDetailEnd = src.indexOf("const stampDetail", followDetailStart);
  assert.ok(followDetailEnd > followDetailStart, "followDetail must end before stampDetail");
  const followDetail = src.slice(followDetailStart, followDetailEnd);
  assert.match(followDetail, /trackerDetailHref\(n, paramsRef\.current, qRef\.current\)/);
  assert.match(followDetail, /syncSearchRef\.current\(event\)/);
  assert.doesNotMatch(followDetail, /pipelineQuery\(params\.toString\(\), q\)/);
  assert.match(followDetail, /\[\]\);/);
});

// The same per-row keys were derived inside the filter and the sort comparator,
// so a keystroke rebuilt them for every row -- twice over, since `matchesInAll`
// scans the tracker again -- and the sort re-parsed a score cell on every
// comparison. Measured on a tracker of a few thousand rows: 21.2 ms -> 5.4 ms
// per keystroke of data work, against 8.2 ms once per row-list change. If these
// move back inline that cost returns with nothing else failing, because the
// rendered table is identical either way.
test("per-row search and sort keys are precomputed, not derived per keystroke", () => {
  assert.match(src, /const rowKeys = useMemo\(\(\) => \{/);
  const start = src.indexOf("const rowKeys = useMemo(");
  const index = src.slice(start, src.indexOf("}, [visibleApplications]);", start));
  assert.match(index, /haystack\.set\(r, companySearchText\(r\)\.toLowerCase\(\)\)/);
  assert.match(index, /label\.set\(r, companyPresentation\(r\)\.label\)/);

  const sortStart = src.indexOf("sortRows(");
  const sortCall = src.slice(sortStart, src.indexOf(") as Application[]", sortStart));
  assert.match(sortCall, /scoreOf/);
  assert.match(sortCall, /companyLabelOf/);
  assert.doesNotMatch(sortCall, /companyPresentation\(row\)/, "the comparator derives the label again");
  assert.doesNotMatch(sortCall, /\bscoreNum\b/, "the comparator parses the score cell again");
});

test("the tab strip reads precomputed counts, not a scan per tab", () => {
  assert.match(
    src,
    /const tabCounts = useMemo\(\(\) => pipelineTabCounts\(visibleApplications\), \[visibleApplications\]\)/,
    "tab counts must be memoized on the row list",
  );
  assert.doesNotMatch(
    src,
    /visibleApplications\s*\.filter\(\s*\(r\)\s*=>\s*rowOnPipelineTab\(r\.status,\s*t\s*\)\s*\)\s*\.length/,
    "the strip scans every row once per tab again -- rows x tabs per render, measured at 46 ms",
  );
});
