// Reset put the full CV back on screen and left Apply pointed at the
// shortened PDF. The index row goes back to the full file when it exists.
//
// Run from web/: node --test tests/lib/cv-studio-reset-pdf.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";
import { restoreFullPdfIndex } from "../../src/lib/cv-studio/restore-pdf.mjs";

const header = "# report\tpdf\thtml\tformat\tdate\tkind\n";
const edited = "011\toutput/cv-fixture-011-fixture-co-edited.pdf\toutput/cv-fixture-011-fixture-co-edited.html\tletter\t2026-11-10\tcv";
const cover = "011\toutput/cover-fixture-011-edited.pdf\toutput/cover-fixture-011-edited.html\tletter\t2026-11-10\tcover";
const other = "012\toutput/cv-other-012-fixture-co-edited.pdf\toutput/cv-other-012-fixture-co-edited.html\tletter\t2026-11-10\tcv";

test("reset points the report row at the full PDF and leaves other rows", () => {
  const index = `${header}${edited}\n${cover}\n${other}\n`;
  const result = restoreFullPdfIndex(index, "11", () => true);
  assert.equal(result.restored, true);
  assert.match(result.text, /011\toutput\/cv-fixture-011-fixture-co\.pdf\toutput\/cv-fixture-011-fixture-co\.html\t/);
  assert.match(result.text, /cover-fixture-011-edited\.pdf/);
  assert.match(result.text, /cv-other-012-fixture-co-edited\.pdf/);
});

test("reset leaves the shortened row when the full PDF is not on disk", () => {
  const result = restoreFullPdfIndex(`${header}${edited}\n`, "011", () => false);
  assert.equal(result.restored, false);
  assert.equal(result.reason, "missing");
  assert.match(result.text, /-edited\.pdf/);
});

test("restoreIndexedFullPdf rewrites the index only when the full file exists", async () => {
  const { restoreIndexedFullPdf } = await import("../../src/lib/cv-studio/server.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-reset-pdf-"));
  const previous = {
    root: process.env.CAREER_OPS_ROOT,
    code: process.env.CAREER_OPS_CODE_ROOT,
    index: process.env.CAREER_OPS_PDF_INDEX,
  };
  const indexPath = path.join(root, "pdf-index.tsv");
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "output", "cv-fixture-011-fixture-co.pdf"), "%PDF");
  fs.writeFileSync(indexPath, `${header}${edited}\n${cover}\n`);
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = path.resolve(process.cwd(), "..");
  process.env.CAREER_OPS_PDF_INDEX = indexPath;
  try {
    const restored = await restoreIndexedFullPdf("011");
    assert.equal(restored.restored, true);
    const written = fs.readFileSync(indexPath, "utf8");
    assert.match(written, /cv-fixture-011-fixture-co\.pdf/);
    assert.doesNotMatch(written, /cv-fixture-011-fixture-co-edited\.pdf/);
    assert.match(written, /cover-fixture-011-edited\.pdf/);
  } finally {
    for (const [key, value] of Object.entries({ CAREER_OPS_ROOT: previous.root, CAREER_OPS_CODE_ROOT: previous.code, CAREER_OPS_PDF_INDEX: previous.index })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
