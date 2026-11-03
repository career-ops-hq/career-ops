// node tests/fixtures/pipeline-report-states.mjs prints a fresh disposable data
// root for pipeline-report-states.browser.test.mjs: row 11 has a readable
// report, and row 12 links a reports/ entry that is a directory, so reading it
// throws EISDIR even when the server runs as root.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-report-states-"));
for (const dir of ["data", "reports"]) fs.mkdirSync(path.join(root, dir));
fs.writeFileSync(path.join(root, ".inline-status-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "data/applications.md"), `# Fictional browser fixture

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 11 | 2026-10-02 | Fixture States Co | Engineer | 4.2/5 | Evaluated | — | [11](../reports/011-fixture-states-co.md) | Fictional fixture only |
| 12 | 2026-10-02 | Fixture Broken Co | Designer | 3.8/5 | Evaluated | — | [12](../reports/012-fixture-broken.md) | Fictional fixture only |
`);
fs.writeFileSync(
  path.join(root, "reports/011-fixture-states-co.md"),
  "# Fixture States Co — Engineer\n\n**URL:** https://jobs.fixture-states.example/engineer\n\nFictional browser test report.\n",
);
fs.mkdirSync(path.join(root, "reports/012-fixture-broken.md"));
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
