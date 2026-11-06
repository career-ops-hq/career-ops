// node tests/fixtures/tracker-window.mjs prints a fresh disposable data root
// with a long fictional tracker, for pipeline-window.browser.test.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-tracker-window-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, ".tracker-window-fixture"), "fictional-only\n");

const lines = [
  "# Fictional browser fixture",
  "",
  "| # | Date | Company | Role | Score | Status | PDF | Report | Notes |",
  "|---|------|---------|------|-------|--------|-----|--------|-------|",
];
for (let n = 1; n <= 120; n++) {
  const company = n === 120 ? "Fixture Zulu" : n === 2 ? "Fixture Company With A Name Long Enough To Wrap In Any Column Width" : `Fixture Co ${String(n).padStart(3, "0")}`;
  const role = n === 2 ? "Principal Platform Engineer For Distributed Data Infrastructure And Developer Tooling" : "Platform Engineer";
  lines.push(`| ${n} | 2026-04-01 | ${company} | ${role} | 4.0/5 | Evaluated | — | — | Fictional fixture only |`);
}
fs.writeFileSync(path.join(root, "data/applications.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
