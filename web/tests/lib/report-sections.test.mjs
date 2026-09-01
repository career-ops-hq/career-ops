// Tests for the report section splitter using Node's built-in test runner.
// Imports directly from report-sections.mjs (the single source of truth) so the
// test and production code can never drift out of sync.
//
// Run:  node --test tests/lib/report-sections.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHeading, authorLetter, splitSections } from "../../src/lib/report-sections.mjs";

test("strips the author letter from the blocks the core has always written", () => {
  assert.equal(cleanHeading("A) Role Summary"), "Role Summary");
  assert.equal(cleanHeading("G) Posting Legitimacy"), "Posting Legitimacy");
});

test("H) is stripped too — the #2324 regression", () => {
  // oferta.md and auto-pipeline.md write "## H) Draft Application Answers";
  // the old [A-G] range left this one heading showing its letter.
  assert.equal(cleanHeading("H) Draft Application Answers"), "Draft Application Answers");
  assert.equal(authorLetter("H) Draft Application Answers"), "H");
});

test("a block added past H needs no code change", () => {
  assert.equal(cleanHeading("I) Something New"), "Something New");
  assert.equal(authorLetter("Z. Last One"), "Z");
});

test("the (lead) / (verdict) marker is dropped with the letter", () => {
  assert.equal(cleanHeading("F) Verdict (lead)"), "Verdict");
  assert.equal(cleanHeading("F) Verdict (verdict)"), "Verdict");
});

test("all three delimiters and the spelled-out Block form", () => {
  assert.equal(cleanHeading("B) Match with CV"), "Match with CV");
  assert.equal(cleanHeading("B. Match with CV"), "Match with CV");
  assert.equal(cleanHeading("B: Match with CV"), "Match with CV");
  assert.equal(cleanHeading("Block H: Draft Application Answers"), "Draft Application Answers");
  assert.equal(authorLetter("Block C) Red Flags"), "C");
});

test("prose is not eaten: both reads need a real delimiter", () => {
  // The delimiter, not the narrowness of the letter range, is the safety —
  // which is why widening the range costs nothing. A bare letter followed by a
  // space is prose: reading it as a section would make ReportView expand it as
  // if it were Block A.
  assert.equal(cleanHeading("A Recommendation Was Requested"), "A Recommendation Was Requested");
  assert.equal(authorLetter("A Recommendation Was Requested"), null);
  assert.equal(cleanHeading("Machine Summary"), "Machine Summary");
  assert.equal(authorLetter("Machine Summary"), null);
  assert.equal(authorLetter("Risk Summary"), null);
});

test("the spelled-out Block form is stripped for display too", () => {
  // authorLetter reads "Block A — Role Summary" as section A, so cleanHeading
  // must not leave "Block A —" in the rendered heading: classifying a heading
  // one way and displaying it another is the same inconsistency #2324 is about.
  assert.equal(cleanHeading("Block A — Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block A – Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block A - Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block A Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block C) Red Flags"), "Red Flags");
  // The word Block is what licenses the whitespace form. A bare letter still
  // needs a delimiter, or prose loses its first word.
  assert.equal(cleanHeading("A Recommendation Was Requested"), "A Recommendation Was Requested");
});

test("the spelled-out Block form keeps its letter without a delimiter", () => {
  // oferta.md:47 writes "## Block A — Role Summary": nothing follows the letter
  // but a space. Losing the letter here would drop the F verdict callout and
  // the A/B expansion on those reports.
  assert.equal(authorLetter("Block A — Role Summary"), "A");
  assert.equal(authorLetter("Block F -- Interview Plan"), "F");
  assert.equal(authorLetter("Block G Posting Legitimacy"), "G");
});

test("a heading that is only a letter keeps its original text", () => {
  assert.equal(cleanHeading("H)"), "H)");
});

test("case is normalized on the way out", () => {
  assert.equal(authorLetter("h) draft application answers"), "H");
});

test("splitSections keeps the intro and letters every section", () => {
  const body = [
    "**Score:** 4.2/5",
    "",
    "## F) Verdict (lead)",
    "Apply.",
    "",
    "## A) Role Summary",
    "Senior role.",
    "",
    "## H) Draft Application Answers",
    "Q1: ...",
  ].join("\n");

  const { intro, sections } = splitSections(body);
  assert.equal(intro, "**Score:** 4.2/5");
  assert.deepEqual(
    sections.map((s) => [s.letter, cleanHeading(s.heading)]),
    [
      ["F", "Verdict"],
      ["A", "Role Summary"],
      ["H", "Draft Application Answers"],
    ],
  );
  assert.equal(sections[2].content, "Q1: ...");
});

test("a body with no headings is all intro", () => {
  const { intro, sections } = splitSections("just prose\nand more");
  assert.equal(intro, "just prose\nand more");
  assert.deepEqual(sections, []);
});

test("the ASCII double-hyphen Block form is stripped whole", () => {
  // modes/ja/kyujin.md and modes/hi/naukri.md write "## Block A -- Role Summary"
  // for every block. The separator matched a SINGLE dash character, so each of
  // those headings rendered with a stray leading hyphen ("- Role Summary") —
  // every block of every report produced by the Japanese or Hindi mode.
  assert.equal(cleanHeading("Block A -- Role Summary"), "Role Summary");
  assert.equal(cleanHeading("Block F -- Interview Plan"), "Interview Plan");
  assert.equal(cleanHeading("Block G -- Posting Legitimacy"), "Posting Legitimacy");
  assert.equal(authorLetter("Block F -- Interview Plan"), "F");
  // A heading whose text legitimately starts with a hyphen keeps it: only the
  // separator run is consumed, and it must be attached to the letter.
  assert.equal(cleanHeading("Block A) -- keep this"), "-- keep this");
});
