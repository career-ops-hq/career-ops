// Reset put the full CV back on screen and left Apply pointed at the
// shortened PDF. The index row goes back to the full file when it exists.
//
// Run from web/: node --test tests/lib/cv-studio-reset-pdf.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";
import { restoreFullPdfIndex } from "../../src/lib/cv-studio/restore-pdf.mjs";

// test-all runs from the checkout root. A `cwd/..` code root then points at
// the parent of the repo, tracker-utils.mjs does not load, and the index
// rewrite looks like a miss. Pin the checkout from this file.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

test("reset leaves a COVER row and a blank-kind cover file on their own paths", () => {
  const upper = "011\toutput/cover-fixture-011-edited.pdf\toutput/cover-fixture-011-edited.html\tletter\t2026-11-10\tCOVER";
  const blank = "011\toutput/cover-fixture-011-edited.pdf\toutput/cover-fixture-011-edited.html\tletter\t2026-11-10\t";
  const titled = "011\toutput/cv-fixture-011-fixture-co-edited.pdf\toutput/cv-fixture-011-fixture-co-edited.html\tletter\t2026-11-10\tCV";
  for (const line of [upper, blank]) {
    const result = restoreFullPdfIndex(`${header}${line}\n`, "11", () => true);
    assert.equal(result.restored, false);
    assert.match(result.text, /cover-fixture-011-edited\.pdf/);
    assert.doesNotMatch(result.text, /cover-fixture-011\.pdf/);
  }
  const cv = restoreFullPdfIndex(`${header}${titled}\n`, "11", () => true);
  assert.equal(cv.restored, true);
  assert.match(cv.text, /cv-fixture-011-fixture-co\.pdf/);
});

test("reset leaves a custom kind on its edited path and still restores the CV row", () => {
  const portfolio = "011\toutput/portfolio-fixture-011-edited.pdf\toutput/portfolio-fixture-011-edited.html\tletter\t2026-11-10\tportfolio";
  const result = restoreFullPdfIndex(`${header}${portfolio}\n${edited}\n`, "11", () => true);
  assert.equal(result.restored, true);
  assert.match(result.text, /portfolio-fixture-011-edited\.pdf/);
  assert.doesNotMatch(result.text, /portfolio-fixture-011\.pdf/);
  assert.match(result.text, /cv-fixture-011-fixture-co\.pdf/);
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
  process.env.CAREER_OPS_CODE_ROOT = REPO_ROOT;
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

test("restoreIndexedFullPdf does not point Apply at a directory or a link outside output", async () => {
  const { restoreIndexedFullPdf } = await import("../../src/lib/cv-studio/server.ts");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-reset-pdf-"));
  const previous = {
    root: process.env.CAREER_OPS_ROOT,
    code: process.env.CAREER_OPS_CODE_ROOT,
    index: process.env.CAREER_OPS_PDF_INDEX,
  };
  const indexPath = path.join(root, "pdf-index.tsv");
  const output = path.join(root, "output");
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(path.join(output, "cv-fixture-011-fixture-co.pdf"));
  fs.writeFileSync(indexPath, `${header}${edited}\n`);
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = REPO_ROOT;
  process.env.CAREER_OPS_PDF_INDEX = indexPath;
  try {
    const directory = await restoreIndexedFullPdf("011");
    assert.equal(directory.restored, false);
    assert.equal(directory.reason, "missing");
    assert.match(fs.readFileSync(indexPath, "utf8"), /cv-fixture-011-fixture-co-edited\.pdf/);
    fs.rmSync(path.join(output, "cv-fixture-011-fixture-co.pdf"), { recursive: true, force: true });
    const outside = path.join(root, "outside.pdf");
    fs.writeFileSync(outside, "%PDF");
    let linked = false;
    try {
      fs.symlinkSync(outside, path.join(output, "cv-fixture-011-fixture-co.pdf"));
      linked = true;
    } catch (err) {
      if (!err || (err.code !== "EPERM" && err.code !== "EACCES")) throw err;
    }
    if (linked) {
      const escaped = await restoreIndexedFullPdf("011");
      assert.equal(escaped.restored, false);
      assert.equal(escaped.reason, "missing");
      assert.match(fs.readFileSync(indexPath, "utf8"), /-edited\.pdf/);
      fs.unlinkSync(path.join(output, "cv-fixture-011-fixture-co.pdf"));
      const inside = path.join(output, "cv-fixture-011-real.pdf");
      fs.writeFileSync(inside, "%PDF");
      fs.symlinkSync(inside, path.join(output, "cv-fixture-011-fixture-co.pdf"));
      const kept = await restoreIndexedFullPdf("011");
      assert.equal(kept.restored, true);
      assert.match(fs.readFileSync(indexPath, "utf8"), /cv-fixture-011-fixture-co\.pdf/);
      assert.doesNotMatch(fs.readFileSync(indexPath, "utf8"), /-edited\.pdf/);
    }
  } finally {
    for (const [key, value] of Object.entries({ CAREER_OPS_ROOT: previous.root, CAREER_OPS_CODE_ROOT: previous.code, CAREER_OPS_PDF_INDEX: previous.index })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("restoreIndexedFullPdf leaves the index alone when the manifest lock is held", async () => {
  const { restoreIndexedFullPdf } = await import("../../src/lib/cv-studio/server.ts");
  const { acquirePipelineLock } = await import(pathToFileURL(path.join(REPO_ROOT, "pipeline-lock.mjs")).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-reset-pdf-"));
  const previous = {
    root: process.env.CAREER_OPS_ROOT,
    code: process.env.CAREER_OPS_CODE_ROOT,
    index: process.env.CAREER_OPS_PDF_INDEX,
    timeout: process.env.CAREER_OPS_WEB_LOCK_TIMEOUT_MS,
  };
  const indexPath = path.join(root, "pdf-index.tsv");
  fs.mkdirSync(path.join(root, "output"), { recursive: true });
  fs.writeFileSync(path.join(root, "output", "cv-fixture-011-fixture-co.pdf"), "%PDF");
  fs.writeFileSync(indexPath, `${header}${edited}\n`);
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = REPO_ROOT;
  process.env.CAREER_OPS_PDF_INDEX = indexPath;
  process.env.CAREER_OPS_WEB_LOCK_TIMEOUT_MS = "400";
  const lock = await acquirePipelineLock(indexPath);
  try {
    await assert.rejects(restoreIndexedFullPdf("011"), (err) => err && err.name === "LockTimeoutError");
    assert.match(fs.readFileSync(indexPath, "utf8"), /-edited\.pdf/);
  } finally {
    await lock.release();
    for (const [key, value] of Object.entries({
      CAREER_OPS_ROOT: previous.root,
      CAREER_OPS_CODE_ROOT: previous.code,
      CAREER_OPS_PDF_INDEX: previous.index,
      CAREER_OPS_WEB_LOCK_TIMEOUT_MS: previous.timeout,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
