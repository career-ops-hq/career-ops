import { test } from "node:test";
import assert from "node:assert/strict";
import { isTheme, storedTheme, THEME_COLORS, THEME_STORAGE_KEY } from "../../src/lib/theme.mjs";

test("theme constants keep the persisted contract stable", () => {
  assert.equal(THEME_STORAGE_KEY, "career-ops:theme");
  assert.deepEqual(THEME_COLORS, { light: "#f7f6f3", dark: "#0a0a0a" });
});

test("theme helpers accept only the two supported modes", () => {
  for (const value of ["light", "dark"]) assert.equal(isTheme(value), true);
  for (const value of ["system", "LIGHT", "", null, undefined, 1]) assert.equal(isTheme(value), false);
  assert.equal(storedTheme("light"), "light");
  assert.equal(storedTheme("dark"), "dark");
  assert.equal(storedTheme("system"), "dark");
  assert.equal(storedTheme("system", "light"), "light");
});
