import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cvDiskState } from "../../src/lib/cv-disk-state.mjs";
import { listOutputPdfNames } from "../../src/lib/output-pdf-names.mjs";
import { tailoredCvOnDisk } from "../../src/lib/tailored-cv-ready.mjs";

const isFile = (abs) => {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
};

test("a file on disk is View tailored CV, and a missing file is not", () => {
  assert.deepEqual(cvDiskState({ onDisk: true, trackerMarked: true }), {
    exists: true,
    stale: false,
    viewLabel: "View tailored CV",
    note: null,
  });
  assert.deepEqual(cvDiskState({ onDisk: false }), {
    exists: false,
    stale: false,
    viewLabel: null,
    note: null,
  });
});

test("a tracker mark or a finished job with no file is a stale flag", () => {
  const stale = cvDiskState({ onDisk: false, trackerMarked: true, jobFinished: true });
  assert.equal(stale.exists, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.viewLabel, null);
  assert.match(stale.note, /no file is in output/);
  assert.match(stale.note, /Generate it again/);
});

test("a missing output directory is an empty list, and any other read error is thrown", () => {
  const missing = path.join(tmpdir(), `cv-disk-missing-${process.pid}`);
  assert.deepEqual(listOutputPdfNames(missing, isFile), []);
  const file = path.join(tmpdir(), `cv-disk-not-a-dir-${process.pid}.pdf`);
  writeFileSync(file, "%PDF-1.1\n");
  try {
    assert.throws(
      () => listOutputPdfNames(file, isFile),
      (err) => err && err.code === "ENOTDIR",
    );
  } finally {
    rmSync(file, { force: true });
  }
});

test("a real PDF in output counts, and deleting it leaves the tracker mark stale", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cv-disk-"));
  try {
    writeFileSync(path.join(dir, "cv-sundial-pharmacy.pdf"), "%PDF-1.1\n");
    const presentNames = listOutputPdfNames(dir, isFile);
    const present = cvDiskState({
      onDisk: tailoredCvOnDisk({ indexStatus: "not-found", filenames: presentNames, company: "Sundial Pharmacy" }),
      trackerMarked: false,
    });
    assert.equal(present.exists, true);
    assert.equal(present.viewLabel, "View tailored CV");

    rmSync(path.join(dir, "cv-sundial-pharmacy.pdf"));
    const goneNames = listOutputPdfNames(dir, isFile);
    const stale = cvDiskState({
      onDisk: tailoredCvOnDisk({ indexStatus: "not-found", filenames: goneNames, company: "Sundial Pharmacy" }),
      trackerMarked: true,
    });
    assert.equal(stale.exists, false);
    assert.equal(stale.stale, true);
    assert.equal(stale.viewLabel, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
