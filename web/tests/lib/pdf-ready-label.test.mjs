import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/components/mark-pdf-ready-button.tsx"),
  "utf8",
);

test("PDF ready is the label only when the file is on disk and the tracker is already marked", () => {
  assert.match(src, /settled \? "PDF ready"/);
  assert.match(src, /const settled = ready && trackerMarked/);
  assert.match(src, /const markedWithoutFile = \(trackerMarked \|\| saved\) && !ready/);
  assert.match(src, /Generate the tailored CV for this report/);
  assert.doesNotMatch(src, /setMarked|ready \|\| marked/);
});

test("the apply checklist is ready only when this report's resume can be downloaded", () => {
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../../src/app/pipeline/[id]/apply/page.tsx"),
    "utf8",
  );
  assert.match(page, /pdfReady=\{resume !== null\}/);
  assert.doesNotMatch(page, /pdfReady=\{disk\.exists\}/);
});
