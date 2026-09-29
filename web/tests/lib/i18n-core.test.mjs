// Tests for the UI localisation core (src/lib/i18n/core.mjs).
//
// Run:  node --test tests/lib/i18n-core.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolate, intlLocale, isLocale, makeT, normalizeLocale, translate } from "../../src/lib/i18n/core.mjs";

test("English is the source: t() returns the key untouched", () => {
  const t = makeT("en");
  assert.equal(t("Today"), "Today");
  assert.equal(t("Never translated anywhere"), "Never translated anywhere");
});

test("Turkish translates known keys and falls back to English for unknown ones", () => {
  const t = makeT("tr");
  assert.equal(t("Today"), "Bugün");
  assert.equal(t("A string added upstream later"), "A string added upstream later");
});

test("placeholders interpolate; unknown ones stay visible instead of vanishing", () => {
  assert.equal(interpolate("{a} of {b}", { a: 1, b: 2 }), "1 of 2");
  assert.equal(interpolate("{a} and {missing}", { a: "x" }), "x and {missing}");
  assert.equal(interpolate("no vars"), "no vars");
  assert.equal(makeT("tr")("{a} of {b}", { a: "3", b: "9" }), "3 / 9");
});

test("t.n picks singular/plural in English and keys Turkish on the plural form", () => {
  const en = makeT("en");
  assert.equal(en.n(1, "{n} match", "{n} matches"), "1 match");
  assert.equal(en.n(3, "{n} match", "{n} matches"), "3 matches");
  const tr = makeT("tr");
  assert.equal(tr.n(1, "{n} match", "{n} matches"), "1 eşleşme");
  assert.equal(tr.n(3, "{n} match", "{n} matches"), "3 eşleşme");
  // untranslated pair → English grammar, never a raw key
  assert.equal(tr.n(2, "{n} widget", "{n} widgets"), "2 widgets");
});

test("t.ctx disambiguates the same English word by context", () => {
  const tr = makeT("tr");
  assert.equal(tr("Action"), "İşlem");
  assert.equal(tr.ctx("star", "Action"), "Eylem");
  assert.equal(tr.ctx("no-such-context", "Action"), "İşlem");
  assert.equal(makeT("en").ctx("star", "Action"), "Action");
});

test("locale normalisation accepts BCP-47 tags and rejects junk", () => {
  assert.equal(normalizeLocale("tr"), "tr");
  assert.equal(normalizeLocale("tr-TR"), "tr");
  assert.equal(normalizeLocale("EN_us"), "en");
  assert.equal(normalizeLocale("de"), "en");
  assert.equal(normalizeLocale(undefined, "tr"), "tr");
  assert.equal(normalizeLocale("<script>", "en"), "en");
  assert.equal(isLocale("tr"), true);
  assert.equal(isLocale("fr"), false);
});

test("translate() and intlLocale() agree with makeT", () => {
  assert.equal(translate("tr", "Save"), makeT("tr")("Save"));
  assert.equal(intlLocale("tr"), "tr-TR");
  assert.equal(intlLocale("en"), "en-US");
});
