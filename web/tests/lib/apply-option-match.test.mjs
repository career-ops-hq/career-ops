import { test } from "node:test";
import assert from "node:assert/strict";
import { pickComboboxOption } from "../../src/lib/apply/option-match.mjs";

test("an exact option wins, ignoring case and surrounding space", () => {
  assert.equal(pickComboboxOption(["Female", " male "], "Male"), 1);
});

test("a short answer does not pick an option that only contains its letters", () => {
  assert.equal(pickComboboxOption(["Australia", "Belarus", "Cyprus"], "US"), -1);
  assert.equal(pickComboboxOption(["Female"], "Male"), -1);
});

test("a whole-word partial match is taken when it is the only one", () => {
  assert.equal(pickComboboxOption(["Canada", "United States (US)"], "US"), 1);
  assert.equal(pickComboboxOption(["São Paulo, Brasil", "Lisboa"], "são paulo"), 0);
});

test("an ambiguous partial match is left for the person", () => {
  assert.equal(pickComboboxOption(["Yes, I need sponsorship", "Yes, I do not need sponsorship"], "Yes"), -1);
});

test("regex characters in the answer are literal", () => {
  assert.equal(pickComboboxOption(["C++ (expert)", "C (expert)"], "C++"), 0);
  assert.equal(pickComboboxOption(["a.b"], "."), -1);
});

test("an empty menu or empty answer picks nothing", () => {
  assert.equal(pickComboboxOption([], "Yes"), -1);
  assert.equal(pickComboboxOption(["Yes"], "  "), -1);
});
