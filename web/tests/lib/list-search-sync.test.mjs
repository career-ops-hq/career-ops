// Typed list search stays on the page, so a reload or the browser Back button
// used to drop it. The list URL has to catch up, and an older in-flight write
// must not replace a newer query or a Back navigation.
//
// Run: node --test tests/lib/list-search-sync.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSearchWrite, noteNavigation, queryWithLiveSearch } from "../../src/lib/list-search-sync.mjs";

function decide(state) {
  return nextSearchWrite({ expected: [], cancelled: [], ...state });
}

test("a typed search is written, and a landed write does not clobber newer typing", () => {
  assert.equal(decide({ local: "Quill", url: "", urlChanged: false }).write, "Quill");
  const landed = decide({ local: "Quill", url: "Quill", urlChanged: true, expected: ["Quill"] });
  assert.equal(landed.write, null);
  assert.deepEqual(landed.expected, []);
  const newer = decide({ local: "Quillfeather", url: "Quill", urlChanged: true, expected: ["Quill"] });
  assert.equal(newer.adopt, false);
  assert.equal(newer.write, "Quillfeather");
  const older = decide({
    local: "Quillfeather",
    url: "Quill",
    urlChanged: true,
    expected: ["Quill", "Quillfeather"],
  });
  assert.equal(older.adopt, false);
  assert.equal(older.write, null);
  assert.deepEqual(older.expected, ["Quillfeather"]);
});

test("browser Back to a URL without the search replaces the local query", () => {
  const back = decide({ local: "Quill", url: "", urlChanged: true });
  assert.equal(back.adopt, true);
  assert.equal(back.write, null);
});

test("a later render still writes a search that never reached the URL", () => {
  assert.equal(decide({ local: "Quill", url: "", urlChanged: false }).write, "Quill");
  const queued = decide({ local: "Quill", url: "", urlChanged: false, expected: ["Quill"] });
  assert.equal(queued.write, null);
});

test("a tab change that wrote B does not replace typing that continued to C", () => {
  const expected = noteNavigation([], { tab: "SKIP" }, "B");
  assert.deepEqual(expected, ["B"]);
  const stillTyping = decide({ local: "C", url: "", urlChanged: false, expected });
  assert.equal(stillTyping.adopt, false);
  assert.equal(stillTyping.write, "C");
  const arrived = decide({ local: "C", url: "B", urlChanged: true, expected });
  assert.equal(arrived.adopt, false);
  assert.equal(arrived.write, "C");
});

test("Back cancels a search write that has not landed, and that write does not stick", () => {
  const expected = noteNavigation([], { q: "Quill" }, "");
  const back = decide({ local: "Quill", url: "", urlChanged: true, expected });
  assert.equal(back.adopt, true);
  assert.deepEqual(back.expected, []);
  assert.deepEqual(back.cancelled, ["Quill"]);
  const late = decide({ local: "", url: "Quill", urlChanged: true, expected: back.expected, cancelled: back.cancelled });
  assert.equal(late.adopt, false);
  assert.equal(late.write, "");
  assert.equal(late.immediate, true);
  assert.deepEqual(late.cancelled, ["Quill"]);
});

test("tab changes keep the search the reader has typed", () => {
  assert.equal(queryWithLiveSearch("tab=ALL", { tab: "SKIP" }, "Quill"), "tab=SKIP&q=Quill");
  assert.equal(queryWithLiveSearch("tab=ALL&q=Quill", { sort: "company" }, ""), "tab=ALL&sort=company");
  assert.equal(queryWithLiveSearch("tab=ALL&q=Quill", { q: "Other" }, "Quill"), "tab=ALL&q=Other");
});
