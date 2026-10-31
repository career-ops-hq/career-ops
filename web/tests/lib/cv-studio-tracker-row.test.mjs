// The Studio route is addressed by tracker row, and the row's number is not the
// report's: they drift apart once a row is deleted or reports are renumbered
// (#1733). findReportFile resolves the row to its own report, but the tailored
// CV was then looked up in data/pdf-index.tsv under the ROW number, which is
// some other application's report. So the Studio opened that role's CV under
// this role's name, and saving wrote its PDF to this report's manifest row.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

const { loadStudio } = await import("../../src/lib/cv-studio/server.ts");
const CODE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const cv = (company) => `<html><body><div class="section">
    <div class="section-title">Work Experience</div>
    <div class="job">
  <div class="job-header"><span class="job-company">${company}</span></div>
  <ul>
    <li>Built the data pipeline</li>
  </ul>
</div>
  </div></body></html>`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cv-studio-row-"));
  for (const dir of ["data", "reports", "output"]) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, "data", "applications.md"), [
    "# Applications Tracker",
    "",
    "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
    "|---|------|---------|------|-------|--------|-----|--------|-------|",
    "| 3 | 2026-10-01 | Acme | Engineer | 4.0/5 | Evaluated | ✅ | [7](../reports/007-acme-2026-10-01.md) | |",
    "| 7 | 2026-10-01 | Globex | Engineer | 4.0/5 | Evaluated | ✅ | [3](../reports/003-globex-2026-10-01.md) | |",
    "",
  ].join("\n"));
  for (const [file, company] of [["007-acme-2026-10-01.md", "Acme"], ["003-globex-2026-10-01.md", "Globex"]]) {
    fs.writeFileSync(path.join(root, "reports", file), `# Evaluation: ${company} -- Engineer\n\n**Score:** 4.0/5\n`);
  }
  for (const company of ["acme", "globex"]) {
    fs.writeFileSync(path.join(root, "output", `cv-jane-${company}.html`), cv(company));
    fs.writeFileSync(path.join(root, "output", `cv-jane-${company}.pdf`), "%PDF");
  }
  fs.writeFileSync(path.join(root, "data", "pdf-index.tsv"), [
    "# report\tpdf\thtml\tformat\tdate",
    "003\toutput/cv-jane-globex.pdf\t\tletter\t2026-10-01",
    "007\toutput/cv-jane-acme.pdf\t\tletter\t2026-10-01",
    "",
  ].join("\n"));
  return root;
}

test("a tracker row opens its own report's CV, not the report that shares its number", async () => {
  const root = fixture();
  const previous = { root: process.env.CAREER_OPS_ROOT, code: process.env.CAREER_OPS_CODE_ROOT };
  process.env.CAREER_OPS_ROOT = root;
  process.env.CAREER_OPS_CODE_ROOT = CODE_ROOT;
  try {
    const row3 = await loadStudio("3");
    assert.equal(row3.ok, true, JSON.stringify(row3));
    assert.equal(row3.reportNum, "007");
    assert.equal(row3.file, "cv-jane-acme.html");

    const row7 = await loadStudio("7");
    assert.equal(row7.ok, true, JSON.stringify(row7));
    assert.equal(row7.reportNum, "003");
    assert.equal(row7.file, "cv-jane-globex.html");
  } finally {
    if (previous.root === undefined) delete process.env.CAREER_OPS_ROOT;
    else process.env.CAREER_OPS_ROOT = previous.root;
    if (previous.code === undefined) delete process.env.CAREER_OPS_CODE_ROOT;
    else process.env.CAREER_OPS_CODE_ROOT = previous.code;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
