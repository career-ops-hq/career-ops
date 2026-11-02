// Disposable data root for the CV Studio live-preview browser test.
// Jane Doe and Example Co are fictional. Prints the root path and nothing else.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const company = "Northwind" + "Industrial".repeat(12);
const link = "jane.example.com/" + "portfolio".repeat(40);
const longPeriod = "September 2021 - August 2025, renewed each quarter" + " and renewed again".repeat(14);
const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { margin: 0; font-family: "Liberation Sans", "Helvetica Neue", Arial, sans-serif; font-size: 11px; }
.page { width: 100%; max-width: 8.5in; }
.contact-row { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 10.5px; }
a { white-space: nowrap; }
.job-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
.job-company { font-size: 12.5px; font-weight: 600; }
.job-period { white-space: nowrap; font-size: 10.5px; }
.summary-text { font-size: 11px; line-height: 1.5; }
</style></head><body>
<div class="page">
  <h1>Jane Doe</h1>
  <div class="contact-row">
    <a href="mailto:jane@example.com">jane@example.com</a>
    <a href="https://${link}">${link}</a>
  </div>
  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary-text">Shipped **"Microsoft PowerApps"** and cleared **~2,000 actionable items**.</div>
  </div>
  <div class="section">
    <div class="section-title">Work Experience</div>
    <div class="job">
      <div class="job-header">
        <span class="job-company">${company}</span>
        <div class="job-period">September 2025 - Present</div>
      </div>
      <ul><li>Kept a placeholder queue for a fictional retailer.</li></ul>
    </div>
    <div class="job">
      <div class="job-header">
        <span class="job-company">Example Co</span>
        <div class="job-period">${longPeriod}</div>
      </div>
      <ul><li>Ran a placeholder help desk for a fictional store.</li></ul>
    </div>
  </div>
</div>
</body></html>
`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cv-preview-"));
fs.mkdirSync(path.join(root, "data"));
fs.mkdirSync(path.join(root, "output"));
fs.mkdirSync(path.join(root, "reports"));
fs.writeFileSync(path.join(root, "cv.md"), "# Jane Doe\n\nemail: jane@example.com\n");
fs.writeFileSync(path.join(root, "reports", "007-example-co-2026-10-01.md"), "# 7: Example Co -- Operations Lead\n\nPlaceholder evaluation. No real person.\n");
fs.writeFileSync(path.join(root, "output", "cv-example-co.html"), html);
fs.writeFileSync(path.join(root, "output", "cv-example-co.pdf"), "%PDF-1.1\n");
fs.writeFileSync(path.join(root, "data", "pdf-index.tsv"), "7\toutput/cv-example-co.pdf\toutput/cv-example-co.html\thtml\t2026-10-01\tcv\n");
console.log(root);
