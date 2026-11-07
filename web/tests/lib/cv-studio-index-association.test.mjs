import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const { loadStudio } = await import("../../src/lib/cv-studio/server.ts");
const CODE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const HTML = `<html><body><div class="section"><div class="section-title">Work Experience</div>
<div class="job"><div class="job-header"><span class="job-company">Fictional Northwind</span></div>
<ul><li>Built the original ledger</li></ul></div></div></body></html>`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-index-association-"));
  for (const dir of ["data", "reports", "output"]) fs.mkdirSync(path.join(root, dir));
  for (const n of ["042", "043"]) {
    fs.writeFileSync(path.join(root, "reports", `${n}-northwind-analyst-2026-03-01.md`), `# Evaluation: Northwind -- Analyst\n`);
  }
  const otherHtml = "output/cv-northwind-analyst-newer.html";
  fs.writeFileSync(path.join(root, otherHtml), HTML.replace("original ledger", "other application ledger"));
  fs.writeFileSync(path.join(root, "output/other.pdf"), "%PDF other application");
  const previous = Object.fromEntries(["CAREER_OPS_ROOT", "CAREER_OPS_CODE_ROOT", "CAREER_OPS_PDF_INDEX"].map((key) => [key, process.env[key]]));
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = CODE_ROOT;
  process.env.CAREER_OPS_PDF_INDEX = path.join(root, "data/pdf-index.tsv");
  return {
    root,
    index(pdf, html) {
      fs.writeFileSync(path.join(root, "data/pdf-index.tsv"), "# report\tpdf\thtml\tformat\tdate\tkind\n" +
        `42\t${pdf}\t${html}\tletter\t2026-03-01\tcv\n` +
        `43\toutput/other.pdf\t${otherHtml}\tletter\t2026-03-01\tcv\n`);
    },
    cleanup() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

for (const missing of ["html", "pdf"]) {
  test(`a report with missing indexed ${missing} never opens another application's matching HTML`, async () => {
    const f = fixture();
    try {
      if (missing === "html") fs.writeFileSync(path.join(f.root, "output/original.pdf"), "%PDF original application");
      f.index("output/original.pdf", "output/original.html");
      const load = await loadStudio("42");
      assert.deepEqual(load, { ok: false, reason: "no-tailored-cv" });
      const other = await loadStudio("43");
      assert.equal(other.ok, true);
      assert.equal(other.file, "cv-northwind-analyst-newer.html");
    } finally {
      f.cleanup();
    }
  });
}

test("an indexed PDF still uses its own HTML sibling when no HTML path was recorded", async () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.root, "output/original.pdf"), "%PDF original application");
    fs.writeFileSync(path.join(f.root, "output/original.html"), HTML);
    f.index("output/original.pdf", "");
    const load = await loadStudio("42");
    assert.equal(load.ok, true);
    assert.equal(load.file, "original.html");
  } finally {
    f.cleanup();
  }
});

test("a legacy report without an index row can still find its matching HTML", async () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.root, "reports/043-northwind-analyst-2026-03-01.md"));
    fs.writeFileSync(path.join(f.root, "output/cv-northwind-analyst-newer.html"), HTML);
    const load = await loadStudio("42");
    assert.equal(load.ok, true);
    assert.equal(load.file, "cv-northwind-analyst-newer.html");
  } finally {
    f.cleanup();
  }
});
