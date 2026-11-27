// node tests/fixtures/pipeline-long.mjs prints a fresh disposable data root with
// 80 fictional applications, long enough that the Pipeline list scrolls.
// Use it as CAREER_OPS_ROOT for a localhost web server, and
// BACK_SCROLL_TEST_ROOT for back-link-scroll.browser.test.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-pipeline-long-"));
for (const dir of ["data", "reports"]) fs.mkdirSync(path.join(root, dir));
fs.writeFileSync(path.join(root, ".pipeline-long-fixture"), "fictional-only\n");
const rows = [];
for (let n = 1; n <= 80; n++) {
  const nn = String(n).padStart(2, "0");
  const company = `Fixture Company ${nn}`;
  const report = `${String(n).padStart(3, "0")}-fixture-company-${nn}.md`;
  const score = (3 + (n % 16) / 10).toFixed(1);
  rows.push(`| ${n} | 2026-10-02 | ${company} | Engineer | ${score}/5 | Evaluated | — | [${n}](../reports/${report}) | Fictional fixture only |`);
  fs.writeFileSync(path.join(root, "reports", report), `# ${company} — Engineer\n\nFictional browser test report.\n`);
}
fs.writeFileSync(path.join(root, "data/applications.md"), `# Fictional browser fixture

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
${rows.join("\n")}
`);
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
