// node tests/fixtures/blank.mjs prints a fresh disposable data root with no
// tracker or pipeline, only a fictional cv.md (so Home shows its onboarding
// banner). For the browser suites whose header asks only for "disposable data":
// with no tracker, an assistant status card reads `Mark #11 → …`, which is
// what those suites assert, where a fixture row would label it by company.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-blank-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
