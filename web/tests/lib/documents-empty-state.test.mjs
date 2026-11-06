import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// An empty Documents page returned only an h2. The walk that waited for an h1
// never finished, and the copy did not say how a file gets there.

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/app/documents/page.tsx"),
  "utf8",
);

function emptyBranch(source) {
  const start = source.indexOf("if (documents.length === 0)");
  assert.ok(start >= 0);
  const end = source.indexOf("\n  return (", start);
  assert.ok(end > start);
  return source.slice(start, end);
}

test("the empty Documents page has the page title and a next step", () => {
  const empty = emptyBranch(src);
  assert.match(empty, /<h1[^>]*>\s*Documents\s*<\/h1>/);
  assert.match(empty, /Generate tailored CV \(PDF\)/);
});
