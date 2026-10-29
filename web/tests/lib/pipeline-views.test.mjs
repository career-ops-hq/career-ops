import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeView, parseViews, removeView, upsertView, viewUpdates } from "../../src/lib/pipeline-views.mjs";

const staff = { name: "Staff 4+", tab: "evaluated", q: "Staff", min: "4", sort: "score", dir: "-1" };

test("a saved view restores the tab, search, score floor, and sort", () => {
  const view = normalizeView(staff);
  assert.deepEqual(view, { name: "Staff 4+", tab: "EVALUATED", q: "Staff", min: 4, sort: "score", dir: -1 });
  assert.deepEqual(viewUpdates(view), { tab: "EVALUATED", q: "Staff", min: 4, sort: "score", dir: -1 });
});

test("the inbox tab clears the tab query and a blank search clears q", () => {
  const view = normalizeView({ name: "Inbox", tab: "INBOX", q: "", min: null, sort: "date", dir: 1 });
  assert.deepEqual(viewUpdates(view), { tab: null, q: null, min: null, sort: "date", dir: 1 });
});

test("a blank name or a non-numeric score floor is rejected", () => {
  assert.equal(normalizeView({ name: "   ", tab: "ALL" }), null);
  assert.equal(normalizeView({ name: "x".repeat(41), tab: "ALL" }), null);
  assert.equal(normalizeView({ name: "Bad", tab: "ALL", min: "high" }), null);
  assert.equal(normalizeView(null), null);
});

test("an unknown sort falls back to score, and an unknown tab falls back to the inbox", () => {
  const view = normalizeView({ name: "Loose", tab: "nope", sort: "magic", dir: "1" });
  assert.equal(view.tab, "INBOX");
  assert.equal(view.sort, "score");
  assert.equal(view.dir, 1);
});

test("saving the same name replaces that view and does not grow the list", () => {
  const once = upsertView([], staff);
  const twice = upsertView(once, { ...staff, q: "Lead" });
  assert.equal(twice.length, 1);
  assert.equal(twice[0].q, "Lead");
  assert.equal(twice[0].name, "Staff 4+");
});

test("a ninth new name is refused, and replacing one of the eight still works", () => {
  let views = [];
  for (let i = 1; i <= 8; i++) views = upsertView(views, { name: `View ${i}`, tab: "ALL" });
  assert.equal(upsertView(views, { name: "View 9", tab: "ALL" }).length, 8);
  const replaced = upsertView(views, { name: "View 3", tab: "INTERVIEW", q: "remote" });
  assert.equal(replaced.length, 8);
  assert.equal(replaced.find((view) => view.name === "View 3").tab, "INTERVIEW");
});

test("corrupt storage drops bad entries and keeps the first of a repeated name", () => {
  const raw = JSON.stringify([
    { name: "Ok", tab: "ALL", q: "", min: null, sort: "score", dir: -1 },
    { name: "" },
    { name: "Ok", tab: "SKIP" },
    "nope",
  ]);
  assert.deepEqual(parseViews(raw).map((view) => view.name), ["Ok"]);
  assert.deepEqual(parseViews('[{"name":"Ok","tab":"ALL"},{"name":{"toString":null}},{"name":"Later","sort":{"toString":null}}]').map((view) => view.name), ["Ok", "Later"]);
  assert.equal(parseViews('[{"name":"Later","sort":{"toString":null}}]')[0].sort, "score");
  assert.deepEqual(parseViews("not json"), []);
  assert.deepEqual(parseViews("{"), []);
  assert.deepEqual(removeView(parseViews(raw), "Ok"), []);
});
