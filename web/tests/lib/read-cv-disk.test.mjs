import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
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
