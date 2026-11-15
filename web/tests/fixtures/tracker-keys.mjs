// node tests/fixtures/tracker-keys.mjs prints a fresh disposable data root.
// Use it as CAREER_OPS_ROOT for tracker-keys.browser.test.mjs.
// This is not the shared pipeline-status fixture. Row 10 is here so a range
// selection can prove the row outside it stays put. The other pipeline suites
// count the three shared rows and a score floor of 4, and this row would
// change both.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-tracker-keys-"));
for (const dir of ["data", "reports"]) fs.mkdirSync(path.join(root, dir));
fs.writeFileSync(path.join(root, ".inline-status-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "data/applications.md"), `# Fictional browser fixture

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 10 | 2026-10-02 | Fixture Outside | Engineer | 4.0/5 | Applied | — | | Fictional fixture only |
| 11 | 2026-10-02 | Fixture Alpha | Engineer | 4.2/5 | Evaluated | — | [11](../reports/011-fixture-alpha.md) | Fictional fixture only |
| 12 | 2026-10-02 | Fixture Beta | Designer | 3.8/5 | Applied | — | | Fictional fixture only |
| 13 | 2026-10-02 | Fixture Gamma | Analyst | 3.6/5 | Evaluated | — | | Fictional fixture only |
`);
fs.writeFileSync(path.join(root, "reports/011-fixture-alpha.md"), "# Fixture Alpha — Engineer\n\nFictional browser test report.\n");
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
