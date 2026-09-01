import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { postNdjsonXhr } from "../../src/lib/post-ndjson-xhr.mjs";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src/lib/post-ndjson-xhr.mjs"), "utf8");

test("postNdjsonXhr is a function", () => {
  assert.equal(typeof postNdjsonXhr, "function");
});

test("Discover stream uses XMLHttpRequest, not fetch", () => {
  assert.match(src, /XMLHttpRequest/);
  assert.doesNotMatch(src, /\bfetch\s*\(/);
});
