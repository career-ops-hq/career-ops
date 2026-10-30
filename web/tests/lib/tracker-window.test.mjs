import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { trackerWindow } from "../../src/lib/tracker-window.mjs";

// A desktop viewport with the table sitting under the page header.
const FIRST_SCREEN = { rowHeight: 57, overscan: 6, tableTop: 220, viewportHeight: 900 };

test("the first screen of a long tracker mounts a window, not every row", () => {
  const span = trackerWindow({ count: 1560, ...FIRST_SCREEN });
  assert.equal(span.start, 0);
  assert.ok(span.end > span.start, "the first screen still shows rows");
  assert.ok(span.end - span.start < 40, `mounted ${span.end - span.start} rows`);
});

test("scrolling to the bottom mounts the last rows and not the first", () => {
  const count = 1560;
  const rowHeight = 57;
  const viewportHeight = 900;
  const span = trackerWindow({
    count,
    rowHeight,
    overscan: 6,
    viewportHeight,
    tableTop: viewportHeight - count * rowHeight,
  });
  assert.equal(span.end, count);
  assert.ok(span.start > 0);
  assert.ok(span.start > count - 40);
  assert.ok(span.end - span.start < 40);
});

test("a short list mounts every row", () => {
  assert.deepEqual(trackerWindow({ count: 3, ...FIRST_SCREEN }), { start: 0, end: 3 });
});

test("an empty list mounts nothing", () => {
  assert.deepEqual(trackerWindow({ count: 0, ...FIRST_SCREEN }), { start: 0, end: 0 });
});

test("a notice above the table changes which rows belong on screen", () => {
  const before = trackerWindow({ count: 1560, rowHeight: 57, overscan: 6, tableTop: -400, viewportHeight: 900 });
  const after = trackerWindow({ count: 1560, rowHeight: 57, overscan: 6, tableTop: -360, viewportHeight: 900 });
  assert.notDeepEqual(before, after);
});

test("the tracker remeasures when an off-screen save failure appears", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/components/pipeline-view.tsx"), "utf8");
  const start = src.indexOf("const rect = el.getBoundingClientRect()");
  assert.ok(start > 0, "measurement not found");
  const deps = src.slice(start).match(/\}, \[([^\]]+)\]/);
  assert.ok(deps, "measurement dependencies not found");
  assert.match(deps[1], /\bheldSaves\b/);
  const measure = src.slice(start, start + src.slice(start).indexOf("const next = trackerWindow"));
  const alertSkip = measure.indexOf("[role='alert']");
  const heightRead = measure.indexOf("getBoundingClientRect().height");
  assert.ok(alertSkip > 0 && alertSkip < heightRead, "an error row must not set the shared spacer height");
});
