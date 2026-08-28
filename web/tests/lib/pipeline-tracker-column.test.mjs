import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareTrackerNumbers } from "../../src/lib/pipeline-sort.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "components", "pipeline-view.tsx");
const source = readFileSync(SRC, "utf8");

test("tracker identifiers sort numerically rather than lexicographically", () => {
  const rows = [{ n: "10" }, { n: "2" }, { n: "1" }];
  assert.deepEqual([...rows].sort(compareTrackerNumbers).map(({ n }) => n), ["1", "2", "10"]);
  assert.deepEqual([...rows].sort((a, b) => compareTrackerNumbers(b, a)).map(({ n }) => n), ["10", "2", "1"]);
});

test("Tracker is the first sortable Pipeline column", () => {
  assert.match(source, /const SORT_KEYS = \["tracker", "company", "role", "score", "status", "date"\]/);
});

test("sortable Pipeline headers use native keyboard-operable buttons", () => {
  assert.match(source, /<th[\s\S]*?aria-sort=[\s\S]*?<button\s+type="button"[\s\S]*?onClick=/);
  assert.doesNotMatch(source, /<th(?:(?!>).)*onClick/s);
});

test("the visible tracker identifier uses the canonical tracker route", () => {
  assert.match(source, /<Link href=\{`\/pipeline\/\$\{r\.n\}`\}[^>]*>\s*#\{r\.n\}\s*<\/Link>/);
});

test("the lower-priority Date header and cells hide below the large breakpoint", () => {
  assert.match(source, /k === "date" && "hidden lg:table-cell"/);
  assert.match(source, /<td className="hidden whitespace-nowrap px-4 py-3 text-faint tabular-nums lg:table-cell">\{r\.date\}<\/td>/);
});
