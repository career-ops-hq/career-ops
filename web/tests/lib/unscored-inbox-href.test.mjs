import { test } from "node:test";
import assert from "node:assert/strict";
import { unscoredInboxHref } from "../../src/lib/posting-url.mjs";

test("an unscored inbox row links to its posting", () => {
  assert.equal(
    unscoredInboxHref("https://example.com/jobs/initech-sre", false),
    "https://example.com/jobs/initech-sre",
  );
});

test("a scored row has no posting link, and a script URL never becomes one", () => {
  assert.equal(unscoredInboxHref("https://example.com/jobs/initech-sre", true), null);
  assert.equal(unscoredInboxHref("javascript:alert(1)", false), null);
});
