import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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
  // The manifest resolver lives in the checkout's tracker-utils.mjs, found
  // from cwd unless CAREER_OPS_CODE_ROOT names it, so pin both it and the
  // manifest to this fixture whatever directory the suite runs from.
  const env = {
    CAREER_OPS_ROOT: root,
    CAREER_OPS_CODE_ROOT: REPO_ROOT,
    CAREER_OPS_PDF_INDEX: path.join(root, "data", "pdf-index.tsv"),
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const cleanup = () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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

test("an indexed HTML in a folder under output/ keeps its folder", async () => {
  const { root, cleanup } = workspace();
  try {
    const pdf = "output/client/cv-northwind-traders-2026-03-01.pdf";
    fs.mkdirSync(path.join(root, "output", "client"));
    fs.writeFileSync(path.join(root, pdf), "%PDF");
    fs.writeFileSync(path.join(root, "output", "client", "cv-northwind-traders.html"), HTML);
    fs.writeFileSync(path.join(root, "output", "client", "cv-northwind-traders-edited.html"), HTML);
    fs.writeFileSync(path.join(root, "output", "cv-northwind-traders.html"), HTML);
    fs.writeFileSync(
      path.join(root, "data", "pdf-index.tsv"),
      HEADER + `42\t${pdf}\toutput/client/cv-northwind-traders-edited.html\tletter\t2026-03-01\tcv\n`,
    );

    const load = await loadStudio("42");

    assert.equal(load.ok, true);
    if (load.ok) assert.equal(load.file, "client/cv-northwind-traders.html");
  } finally {
    cleanup();
  }
});

test("an indexed HTML path outside output/ is not the studio source", async () => {
  const { root, cleanup } = workspace();
  try {
    const pdf = "output/cv-northwind-traders-2026-03-01.pdf";
    fs.writeFileSync(path.join(root, pdf), "%PDF");
    fs.writeFileSync(path.join(root, "stolen.html"), HTML);
    fs.writeFileSync(
      path.join(root, "data", "pdf-index.tsv"),
      HEADER + `42\t${pdf}\tstolen.html\tletter\t2026-03-01\tcv\n`,
    );

    const load = await loadStudio("42");

    assert.equal(load.ok, false);
    if (!load.ok) assert.equal(load.reason, "no-tailored-cv");
  } finally {
    cleanup();
  }
});
