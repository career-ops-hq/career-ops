// Disposable fictional data for this browser suite; never reads user files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-evaluate-application-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, ".evaluation-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
