// Tests for the Preparation page helpers.
// Run:  node --test tests/lib/prep.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTaskItems, tickKey, countDone, normalizeProgress, matchesCompany, pickForCompany } from "../../src/lib/prep.mjs";

test("parseTaskItems reads checked and unchecked items only", () => {
  const md = "# T\n- [ ] one\n  * [x] two\n- plain bullet\n+ [X] three\r\n- [ ]no space\n";
  assert.deepEqual(parseTaskItems(md), [
    { text: "one", done: false },
    { text: "two", done: true },
    { text: "three", done: true },
  ]);
});

test("countDone: a saved tick overrides the markdown state", () => {
  const items = parseTaskItems("- [ ] a\n- [x] b\n- [ ] c\n");
  assert.equal(countDone("f.md", items, {}), 1);
  assert.equal(countDone("f.md", items, { [tickKey("f.md", "a")]: true, [tickKey("f.md", "b")]: false }), 1);
  assert.equal(countDone("other.md", items, { [tickKey("f.md", "a")]: true }), 1); // other file's ticks ignored
});

test("tickKey trims and caps long text", () => {
  assert.equal(tickKey("f", "  hi  "), "f::hi");
  assert.equal(tickKey("f", "x".repeat(300)).length, "f::".length + 120);
});

test("normalizeProgress keeps well-formed ticks and tasks only", () => {
  const p = normalizeProgress({
    ticks: { "a::b": true, c: "yes" },
    tasks: { acme: [{ id: "1", text: "t", done: 1 }, { id: 2, text: "bad" }], bad: "x" },
  });
  assert.deepEqual(p, { ticks: { "a::b": true }, tasks: { acme: [{ id: "1", text: "t", done: false }] } });
  assert.deepEqual(normalizeProgress(undefined), { ticks: {}, tasks: {} });
  assert.deepEqual(normalizeProgress([1]), { ticks: {}, tasks: {} });
});

test("matchesCompany: company folders, and file names carrying the slug as a whole token", () => {
  assert.equal(matchesCompany("output/acme/swe_2026/evaluation.md", "acme"), true);
  assert.equal(matchesCompany("output/acme/swe_2026/evaluation.md", "acme-corp"), false);
  assert.equal(matchesCompany("output/cv-jane-3-acme-2026-01-01.pdf", "acme"), true);
  assert.equal(matchesCompany("interview-prep/acme-backend-engineer.md", "acme"), true);
  assert.equal(matchesCompany("interview-prep/metabase-sre.md", "meta"), false); // "meta" is not "metabase"
  assert.equal(matchesCompany("output/other/x.md", ""), false);
  assert.equal(matchesCompany("output/other/x.md", "a.*"), false); // not a slug, never a pattern
});

test("pickForCompany prefers interview prep, then evaluation, then anything", () => {
  const paths = [
    "output/acme/swe/cv.pdf",
    "output/acme/swe/evaluation.md",
    "interview-prep/acme-swe.md",
    "output/acme/swe/interview-prep.md",
    "output/zed/swe/evaluation.md",
  ];
  assert.equal(pickForCompany(paths, "acme"), "output/acme/swe/interview-prep.md");
  assert.equal(pickForCompany(paths.filter((p) => !p.endsWith("/interview-prep.md")), "acme"), "interview-prep/acme-swe.md");
  assert.equal(pickForCompany(["output/acme/swe/cv.pdf", "output/acme/swe/evaluation.md"], "acme"), "output/acme/swe/evaluation.md");
  assert.equal(pickForCompany(["output/zed/x.md"], "acme"), null);
});
