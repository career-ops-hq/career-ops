import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cv-upload-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, ".cv-upload-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "cv.md"), "# CV -- Fictional Original\n\n## Skills\n- TypeScript\n");
console.log(root);
