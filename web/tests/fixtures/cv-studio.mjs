import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cv-studio-"));
for (const dir of ["reports", "output"]) fs.mkdirSync(path.join(root, dir));
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
fs.writeFileSync(
  path.join(root, "reports", "011-fixture-alpha-2026-10-28.md"),
  "# 011: Fixture Alpha -- Coordinator\n\nFictional browser test report.\n",
);
fs.writeFileSync(
  path.join(root, "output", "cv-fixture-alpha-2026-10-28.html"),
  `<html><body><div class="page">
  <div class="header"><h1>Not a real candidate</h1></div>
  <div class="section">
    <div class="section-title">Work Experience</div>
    <div class="job">
      <div class="job-header"><span class="job-company">Fixture Alpha</span><span class="job-period">2024-2026</span></div>
      <ul><li>Kept the Tuesday review.</li></ul>
    </div>
  </div>
</div></body></html>
`,
);
console.log(root);
