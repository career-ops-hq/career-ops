import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeView, omissionAfterAttempt, parseViews, removeView, savedViewPayload, upsertView, viewUpdates, viewsForMutation } from "../../src/lib/pipeline-views.mjs";

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

test("loading saved views does not write them back", () => {
  const views = [normalizeView({ name: "Other tab", tab: "ALL" })];
  assert.equal(savedViewPayload("load", views), null);
  assert.equal(savedViewPayload("save", views), JSON.stringify(views));
  assert.equal(savedViewPayload("remove", []), "[]");
});

test("a save starts from the list on disk when the last write landed", () => {
  const memory = [normalizeView({ name: "Local", tab: "ALL" })];
  const stored = [normalizeView({ name: "Other tab", tab: "EVALUATED" })];
  assert.deepEqual(viewsForMutation(memory, stored, false).map((view) => view.name), ["Other tab"]);
  assert.deepEqual(removeView(viewsForMutation(memory, stored, false), "Other tab"), []);
});

test("a view storage rejected stays for the next save, with the other tab's view", () => {
  const memory = [normalizeView({ name: "Page only", tab: "ALL" })];
  const stored = [normalizeView({ name: "Other tab", tab: "SKIP" })];
  const base = viewsForMutation(memory, stored, true);
  assert.deepEqual(base.map((view) => view.name), ["Page only", "Other tab"]);
  const saved = upsertView(base, { name: "Newer", tab: "ALL" });
  assert.deepEqual(saved.map((view) => view.name), ["Page only", "Other tab", "Newer"]);
});

test("a view removed while storage is rejected is not merged back from disk", () => {
  const memory = [normalizeView({ name: "Kept", tab: "ALL" })];
  const stored = [normalizeView({ name: "Kept", tab: "ALL" }), normalizeView({ name: "Gone", tab: "SKIP" })];
  assert.deepEqual(viewsForMutation(memory, stored, true, ["Gone"]).map((view) => view.name), ["Kept"]);
  assert.deepEqual(viewsForMutation(memory, stored, true).map((view) => view.name), ["Kept", "Gone"]);
});

test("a refused save keeps a removed name omitted", () => {
  assert.deepEqual(omissionAfterAttempt(["Gone"], "Gone", false), ["Gone"]);
  assert.deepEqual(omissionAfterAttempt(["Gone", "Other"], "Gone", true), ["Other"]);
});
