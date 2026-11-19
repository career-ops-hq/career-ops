import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { reportNumberFor } from "../../src/lib/apply-checklist.mjs";
import "../helpers/web-ts-alias-loader.mjs";

const { readCvDiskForRows } = await import("../../src/lib/read-cv-disk.ts");

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const saved = {
  root: process.env.CAREER_OPS_ROOT,
  index: process.env.CAREER_OPS_PDF_INDEX,
  code: process.env.CAREER_OPS_CODE_ROOT,
};

after(() => {
  if (saved.root === undefined) delete process.env.CAREER_OPS_ROOT;
  else process.env.CAREER_OPS_ROOT = saved.root;
  if (saved.index === undefined) delete process.env.CAREER_OPS_PDF_INDEX;
  else process.env.CAREER_OPS_PDF_INDEX = saved.index;
  if (saved.code === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
  else process.env.CAREER_OPS_CODE_ROOT = saved.code;
});

test("the CV disk check uses the report number, not the tracker row", async () => {
  const root = await mkdtemp(join(tmpdir(), "cv-disk-"));
  try {
    await mkdir(join(root, "output"), { recursive: true });
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "output", "cv-acme.pdf"), "%PDF-1.1\n");
    await writeFile(join(root, "data", "pdf-index.tsv"), "12\toutput/cv-acme.pdf\t\t\t2026-11-06\tcv\n");
    process.env.CAREER_OPS_ROOT = root;
    process.env.CAREER_OPS_PDF_INDEX = join(root, "data", "pdf-index.tsv");
    process.env.CAREER_OPS_CODE_ROOT = repo;

    const linked = await readCvDiskForRows([{ n: "3", company: "Other Co", reportNumber: 12 }]);
    assert.equal(linked["3"].exists, true);

    const otherReport = await readCvDiskForRows([{ n: "3", company: "Other Co", reportNumber: 4 }]);
    assert.equal(otherReport["3"].exists, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Apply is ready only when this report's indexed CV is on disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "cv-apply-ready-"));
  try {
    await mkdir(join(root, "output"), { recursive: true });
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "output", "cv-fixture-co.pdf"), "%PDF-1.1\n");
    process.env.CAREER_OPS_ROOT = root;
    process.env.CAREER_OPS_PDF_INDEX = join(root, "data", "pdf-index.tsv");
    process.env.CAREER_OPS_CODE_ROOT = repo;

    await writeFile(join(root, "data", "pdf-index.tsv"), "");
    const loose = await readCvDiskForRows([{ n: "7", company: "Fixture Co", reportNumber: 7 }]);
    assert.equal(loose["7"].exists, true);
    assert.equal(loose["7"].applyPdfReady, false);

    const noReport = await readCvDiskForRows([{ n: "7", company: "Fixture Co", reportNumber: null }]);
    assert.equal(noReport["7"].exists, true);
    assert.equal(noReport["7"].applyPdfReady, false);

    await writeFile(join(root, "data", "pdf-index.tsv"), "7\toutput/cv-fixture-co.pdf\t\t\t2026-11-06\tcv\n");
    const indexed = await readCvDiskForRows([{ n: "7", company: "Fixture Co", reportNumber: 7 }]);
    assert.equal(indexed["7"].exists, true);
    assert.equal(indexed["7"].applyPdfReady, true);

    const fromFile = reportNumberFor("7", { report: "—" }, "7-fixture.md");
    assert.equal(fromFile, 7);
    const named = await readCvDiskForRows([{ n: "7", company: "Fixture Co", reportNumber: fromFile }]);
    assert.equal(named["7"].applyPdfReady, true);
    const dropped = reportNumberFor("7", { report: "—" }, null);
    assert.equal(dropped, null);

    await writeFile(join(root, "data", "pdf-index.tsv"), "7\toutput/missing-cv.pdf\t\t\t2026-11-06\tcv\n");
    const missing = await readCvDiskForRows([{ n: "7", company: "Fixture Co", reportNumber: 7 }]);
    assert.equal(missing["7"].exists, false);
    assert.equal(missing["7"].applyPdfReady, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an untagged cover row is not a CV on disk, and an untagged cv row is", async () => {
  const root = await mkdtemp(join(tmpdir(), "cv-disk-cover-"));
  try {
    await mkdir(join(root, "output"), { recursive: true });
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "output", "cover-acme.pdf"), "%PDF-1.1\n");
    await writeFile(join(root, "output", "cv-acme.pdf"), "%PDF-1.1\n");
    process.env.CAREER_OPS_ROOT = root;
    process.env.CAREER_OPS_PDF_INDEX = join(root, "data", "pdf-index.tsv");
    process.env.CAREER_OPS_CODE_ROOT = repo;

    await writeFile(join(root, "data", "pdf-index.tsv"), "12\toutput/cover-acme.pdf\t\t\t2026-11-06\n");
    const cover = await readCvDiskForRows([{ n: "3", company: "Other Co", reportNumber: 12 }]);
    assert.equal(cover["3"].exists, false);

    await writeFile(join(root, "data", "pdf-index.tsv"), "12\toutput/cv-acme.pdf\t\t\t2026-11-06\n");
    const cv = await readCvDiskForRows([{ n: "3", company: "Other Co", reportNumber: 12 }]);
    assert.equal(cv["3"].exists, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
