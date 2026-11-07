import { test } from "node:test";
import assert from "node:assert/strict";
import { paletteItems, rankPalette } from "../../src/lib/command-palette.mjs";

const pages = [
  { href: "/", label: "Today" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/analytics", label: "Analytics" },
  { href: "/config", label: "Config" },
];

const app = (n, company, role, status, score = "4.0/5") => ({ n, company, via: "", role, status, score });

const applications = [
  app("3", "Kestrel Labs", "Robotics Engineer", "Evaluated"),
  app("7", "Lattice Robotics", "Platform Engineer", "Applied"),
  app("12", "Fixture Beta", "Designer", "Interview"),
  app("15", "Kestrel Robotics", "Controls Engineer", "Evaluated"),
  app("21", "Pipeworks", "Data Engineer", "Interview"),
  app("30", "?", "Analyst", "Rejected"),
];

const items = paletteItems(pages, applications);
const labels = (query, limit = 50) => rankPalette(items, query, limit).map((item) => item.label);

test("pages come first, then one item per application linking to its detail route", () => {
  assert.deepEqual(items.map((item) => item.kind), [...pages.map(() => "page"), ...applications.map(() => "application")]);
  assert.deepEqual(items.slice(0, pages.length).map(({ label, href }) => ({ label, href })), pages);
  const beta = items.find((item) => item.label === "Fixture Beta");
  assert.equal(beta.href, "/pipeline/12");
  assert.match(beta.detail, /Designer/);
  assert.match(beta.detail, /Interview/);
  assert.equal(beta.tag, "#12");
  assert.doesNotMatch(beta.detail, /#12/);
  assert.equal(items.find((item) => item.href === "/pipeline/30").label, "Confidential employer");
});

test("an empty query returns only the pages", () => {
  assert.deepEqual(labels(""), ["Today", "Pipeline", "Analytics", "Config"]);
  assert.deepEqual(labels("   "), ["Today", "Pipeline", "Analytics", "Config"]);
});

test("a label starting with the whole query outranks a label word matching the first token", () => {
  assert.deepEqual(labels("kestrel rob"), ["Kestrel Robotics", "Kestrel Labs"]);
  assert.deepEqual(labels("Kestrel ROB"), ["Kestrel Robotics", "Kestrel Labs"]);
});

test("every token must match", () => {
  assert.deepEqual(labels("kestrel lattice"), []);
  assert.deepEqual(labels("lattice platform"), ["Lattice Robotics"]);
});

test("the tracker number finds its application with or without #", () => {
  assert.equal(rankPalette(items, "#12", 50)[0].href, "/pipeline/12");
  assert.ok(labels("12").includes("Fixture Beta"));
  assert.deepEqual(labels("#12"), ["Fixture Beta"]);
});

test("the Pipeline page ranks above an application whose label also starts with the query", () => {
  assert.deepEqual(labels("pipe"), ["Pipeline", "Pipeworks"]);
});

test("a status token keeps only applications in that status", () => {
  assert.deepEqual(labels("interview"), ["Fixture Beta", "Pipeworks"]);
});

test("the company search text matches what the pipeline search matches", () => {
  assert.deepEqual(labels("confidential"), ["Confidential employer"]);
  assert.deepEqual(labels("analyst"), ["Confidential employer"]);
});

test("the result count never exceeds the limit", () => {
  assert.equal(rankPalette(items, "engineer", 2).length, 2);
  assert.equal(rankPalette(items, "", 3).length, 3);
});
