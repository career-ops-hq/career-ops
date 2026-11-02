// The report page opens the PDF named in data/pdf-index.tsv. The Studio has to
// open the HTML that same row names, even when that name is not the PDF's name
// and the report filename's slug is not a token in the HTML name.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const { loadStudio } = await import("../../src/lib/cv-studio/server.ts");

const HTML = `<html><body><div class="section">
    <div class="section-title">Work Experience</div>
    <div class="job">
  <div class="job-header"><span class="job-company">Northwind Traders</span></div>
  <ul>
    <li>Built the order ledger</li>
  </ul>
</div>
  </div></body></html>`;

const HEADER = "# report\tpdf\thtml\tformat\tdate\tkind\n";

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-load-"));
  fs.mkdirSync(path.join(root, "output"));
  fs.mkdirSync(path.join(root, "reports"));
  fs.mkdirSync(path.join(root, "data"));
  fs.writeFileSync(
    path.join(root, "reports", "042-northwind-traders-analyst-2026-03-01.md"),
    "# Evaluation: Northwind Traders -- Analyst\n",
  );
  const previousRoot = process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_ROOT = root;
  const cleanup = () => {
    if (previousRoot === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  };
  return { root, cleanup };
}

test("the studio opens the indexed HTML when its name is not the PDF name", async () => {
  const { root, cleanup } = workspace();
  try {
    const pdf = "output/cv-northwind-traders-2026-03-01.pdf";
    const html = "output/cv-northwind-traders.html";
    fs.writeFileSync(path.join(root, pdf), "%PDF");
    fs.writeFileSync(path.join(root, html), HTML);
    fs.writeFileSync(
      path.join(root, "data", "pdf-index.tsv"),
      HEADER +
        `42\toutput/cover-northwind-traders.pdf\toutput/cover-northwind-traders.html\tletter\t2026-03-01\tcover\n` +
        `42\t${pdf}\t${html}\tletter\t2026-03-01\tcv\n`,
    );

    const load = await loadStudio("42");

    assert.equal(load.ok, true);
    if (load.ok) assert.equal(load.file, "cv-northwind-traders.html");
  } finally {
    cleanup();
  }
});

test("the studio keeps the indexed HTML when a newer file matches the report slug", async () => {
  const { root, cleanup } = workspace();
  try {
    const pdf = "output/cv-northwind-traders-2026-03-01.pdf";
    const html = "output/cv-northwind-traders.html";
    const decoy = "output/cv-northwind-traders-analyst.html";
    fs.writeFileSync(path.join(root, pdf), "%PDF");
    fs.writeFileSync(path.join(root, html), HTML);
    fs.writeFileSync(path.join(root, decoy), HTML.replace("order ledger", "other ledger"));
    const later = new Date("2026-04-01T00:00:00Z");
    fs.utimesSync(path.join(root, decoy), later, later);
    fs.writeFileSync(
      path.join(root, "data", "pdf-index.tsv"),
      HEADER + `42\t${pdf}\t${html}\tletter\t2026-03-01\tcv\n`,
    );

    const load = await loadStudio("42");

    assert.equal(load.ok, true);
    if (load.ok) assert.equal(load.file, "cv-northwind-traders.html");
  } finally {
    cleanup();
  }
});

test("an indexed edited copy opens the original the tailor wrote", async () => {
  const { root, cleanup } = workspace();
  try {
    const pdf = "output/cv-northwind-traders-2026-03-01.pdf";
    fs.writeFileSync(path.join(root, pdf), "%PDF");
    fs.writeFileSync(path.join(root, "output", "cv-northwind-traders.html"), HTML);
    fs.writeFileSync(path.join(root, "output", "cv-northwind-traders-edited.html"), HTML);
    fs.writeFileSync(
      path.join(root, "data", "pdf-index.tsv"),
      HEADER + `42\t${pdf}\toutput/cv-northwind-traders-edited.html\tletter\t2026-03-01\tcv\n`,
    );

    const load = await loadStudio("42");

    assert.equal(load.ok, true);
    if (load.ok) assert.equal(load.file, "cv-northwind-traders.html");
  } finally {
    cleanup();
  }
});

test("an indexed ATS HTML is the studio source when it is the recorded CV", async () => {
  const { root, cleanup } = workspace();
  try {
    const pdf = "output/cv-northwind-traders-2026-03-01.pdf";
    const html = "output/cv-northwind-traders-ats.html";
    fs.writeFileSync(path.join(root, pdf), "%PDF");
    fs.writeFileSync(path.join(root, html), HTML);
    fs.writeFileSync(
      path.join(root, "data", "pdf-index.tsv"),
      HEADER + `42\t${pdf}\t${html}\tletter\t2026-03-01\tcv\n`,
    );

    const load = await loadStudio("42");

    assert.equal(load.ok, true);
    if (load.ok) assert.equal(load.file, "cv-northwind-traders-ats.html");
  } finally {
    cleanup();
  }
});
