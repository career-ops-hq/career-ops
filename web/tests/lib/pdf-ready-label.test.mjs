import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/mark-pdf-ready-button.tsx"),
  "utf8",
);

test("PDF ready is the label only when the file is already on disk", () => {
  assert.match(src, /ready \? "PDF ready" : saved \? "Tracker marked"/);
  assert.doesNotMatch(src, /setMarked|ready \|\| marked/);
});
