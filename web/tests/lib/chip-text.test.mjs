// An Explore filter entry can hold a comma ("Portland, OR") when it is quoted,
// in the box and in the page address (#7424). Without quotes, text splits as
// it always did.
//
// Run:  node --experimental-strip-types --test tests/lib/chip-text.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cleanChips } from "../../src/lib/clean-chips.mjs";
import { commitsOnPaste, commitsOnType, joinChipParam, splitChipParam, splitChipText } from "../../src/lib/chip-text.mjs";

const chips = (text) => cleanChips(splitChipText(text));

test("text without quotes gives the same entries as the old separator split", () => {
  const old = (text) => cleanChips(text.split(/[,\n;\t\r]+/));
  for (const text of [
    "Afghanistan, Albania, Algeria",
    "Costa Rica, South Africa\nUnited States;Canada\tMexico\rPeru",
    "Remote,, , Toronto,",
    "Washington D.C.",
    "27\" monitor, desk",
    "",
  ]) {
    assert.deepEqual(chips(text), old(text), JSON.stringify(text));
  }
});

test("a quoted entry keeps its comma", () => {
  assert.deepEqual(chips('Toronto, "Portland, OR", Remote'), ["Toronto", "Portland, OR", "Remote"]);
  assert.deepEqual(chips('"Portland, OR"; "Portland, ME"'), ["Portland, OR", "Portland, ME"]);
});

test("inside quotes every separator is literal, and a doubled quote is one quote", () => {
  assert.deepEqual(chips('"a; b\tc", d'), ["a; b\tc", "d"]);
  assert.deepEqual(chips('"say ""hi"", twice"'), ['say "hi", twice']);
});

test("a quote that is never closed runs to the end of the text", () => {
  assert.deepEqual(chips('Toronto, "Portland, OR'), ["Toronto", "Portland, OR"]);
});

test("a quote inside an entry is an ordinary character", () => {
  assert.deepEqual(chips('27" monitor, desk'), ['27" monitor', "desk"]);
});

test("typing a separator commits the draft only outside quotes", () => {
  assert.equal(commitsOnType("Portland,"), true);
  assert.equal(commitsOnType("Portland;"), true);
  assert.equal(commitsOnType('"Portland,'), false);
  assert.equal(commitsOnType('"Portland, OR",'), true);
  assert.equal(commitsOnType('"Portland, OR"'), false);
  assert.equal(commitsOnType("Portland"), false);
  assert.equal(commitsOnType(""), false);
});

test("a paste commits only when it holds a separator outside quotes", () => {
  assert.equal(commitsOnPaste("Berlin, Munich"), true);
  assert.equal(commitsOnPaste('"Portland, OR"'), false);
  assert.equal(commitsOnPaste('"Portland, OR", Remote'), true);
  assert.equal(commitsOnPaste("Remote-EMEA"), false);
});

test("a URL parameter round-trips entries that hold commas or quotes", () => {
  for (const entries of [
    ["Portland, OR", "Portland, ME", "Remote"],
    ['say "hi", twice', '"Remote"', "plain"],
    ["Washington D.C.", "New York"],
  ]) {
    assert.deepEqual(cleanChips(splitChipParam(joinChipParam(entries))), entries);
  }
});

test("entries without a comma or a leading quote are written as before", () => {
  const entries = ["Toronto", "New York", 'a "b"', "Remote"];
  assert.equal(joinChipParam(entries), entries.join(","));
});

test("Explore's page address keeps a comma inside a location", async () => {
  const { DEFAULT_FILTERS, filtersToParams, paramsToFilters } = await import("../../src/lib/explore.ts");
  const f = {
    ...DEFAULT_FILTERS,
    positive: ["staff engineer"],
    allow: ["Portland, OR", "Portland, ME", "Remote"],
    block: ["Vancouver, WA"],
    blockHard: ["Paris, TX"],
    alwaysAllow: ["Toronto, ON"],
  };

  const back = paramsToFilters(new URLSearchParams(filtersToParams(f)));

  assert.deepEqual(back.allow, f.allow);
  assert.deepEqual(back.block, f.block);
  assert.deepEqual(back.blockHard, f.blockHard);
  assert.deepEqual(back.alwaysAllow, f.alwaysAllow);
  assert.deepEqual(back.positive, f.positive);
});

test("a link written before quoting existed reads as it always did", async () => {
  const { paramsToFilters } = await import("../../src/lib/explore.ts");

  const back = paramsToFilters(new URLSearchParams("q=staff+engineer%2Cplatform&loc=Toronto%2CRemote"));

  assert.deepEqual(back.positive, ["staff engineer", "platform"]);
  assert.deepEqual(back.allow, ["Toronto", "Remote"]);
});

const FILTER_BUILDER = new URL("../../src/components/explore/filter-builder.tsx", import.meta.url);

test("the quoting the Explore form shows under its location boxes is the rule the boxes follow", () => {
  const source = readFileSync(FILTER_BUILDER, "utf8");
  const hint = source.match(/function QuoteHint\([\s\S]*?<p[^>]*>([^<]+)<\/p>/);
  assert.ok(hint, "QuoteHint renders one line of text");
  const example = hint[1].replaceAll("&quot;", '"').match(/"[^"]*,[^"]*"/);
  assert.ok(example, `the hint shows a quoted entry with a comma: ${hint[1]}`);
  assert.deepEqual(chips(example[0]), [example[0].slice(1, -1)]);
});

test("every location box names a hint that is on the page as its description", () => {
  const source = readFileSync(FILTER_BUILDER, "utf8");
  const fields = source.split("<KeywordField").slice(1).map((s) => s.slice(0, s.indexOf("/>")));
  for (const label of ["City or location", "Always include", "Exclude locations", "Never include"]) {
    const field = fields.find((f) => f.includes(`ariaLabel="${label}"`));
    assert.ok(field, `a box labelled ${label}`);
    const ref = field.match(/describedBy=\{(\w+)\}/);
    assert.ok(ref, `${label} has a describedBy`);
    assert.match(source, new RegExp(`<QuoteHint id=\\{${ref[1]}\\} />`), `${label} points at a rendered hint`);
  }
});
