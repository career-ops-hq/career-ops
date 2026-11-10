// A client that leaves while the CV HTML is built must not get a saved PDF.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("a disconnect during CV build does not save or render the PDF", () => {
  const src = readFileSync(new URL("../../src/app/api/run/route.ts", import.meta.url), "utf8");
  const start = src.indexOf("const built = await materializeTailoredCv");
  const save = src.indexOf("saveCv(pdfPaths", start);
  assert.ok(start > 0 && save > start);
  assert.match(src.slice(start, save), /if \(closed\) return;/);
});
