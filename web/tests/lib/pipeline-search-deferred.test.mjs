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
  assert.match(predicate, /query\.toLowerCase\(\)/);
  assert.doesNotMatch(predicate, /deferredQ\.toLowerCase\(\)/, "surrounding spaces in the raw value are not part of the match");
  assert.doesNotMatch(predicate, /\bq\.trim\(\)|\bq\.toLowerCase\(\)/, "the filter still reads q directly");
  assert.match(predicate, /\[minFilter, query\]/);
  assert.doesNotMatch(predicate, /\[minFilter, query, deferredQ\]/);
  assert.match(src, /tabRows\.filter\(matchesFilters\)/);
});
