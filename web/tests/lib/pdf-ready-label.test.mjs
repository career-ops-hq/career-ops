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

test("the report Apply button is not ready from a loose cv file", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, "../../src/app/pipeline/[id]/page.tsx"), "utf8");
  const view = readFileSync(join(here, "../../src/components/report-view.tsx"), "utf8");
  const home = readFileSync(join(here, "../../src/app/page.tsx"), "utf8");
  assert.match(page, /applyPdfReady=\{disk\.applyPdfReady\}/);
  assert.match(view, /pdfReady=\{applyPdfReady\}/);
  assert.doesNotMatch(view, /pdfReady=\{disk\.exists\}/);
  assert.match(home, /pdfOnDisk: disks\[app\.n\]\?\.applyPdfReady/);
  assert.doesNotMatch(home, /pdfOnDisk: disks\[app\.n\]\?\.exists/);
  assert.match(home, /reportFile: report\?\.file \?\? null/);
  assert.match(home, /reportNumberFor\(app\.n, app, readApp\(app\)\.reportFile\)/);
  assert.doesNotMatch(home, /reportNumberFor\(app\.n, app, null\)/);
});
