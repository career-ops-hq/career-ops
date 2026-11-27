// Prints a new disposable, fictional data root for inbox-undo.browser.test.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-inbox-undo-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, ".inbox-undo-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "data/pipeline.md"), `# Fictional inbox

## Pending
- [ ] https://example.com/fixture-alpha | Fixture Alpha | Engineer | Toronto
- [ ] https://example.com/fixture-beta | Fixture Beta | Designer | Montreal
`);
// The existing endpoint loads this dependency from the data root. Copy only
// the core lock and the one module it imports (lib/dir-lock.mjs, since #5389),
// never a user's configuration or tracker.
for (const file of ["pipeline-lock.mjs", "lib/dir-lock.mjs"]) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL(`../../../${file}`, import.meta.url)), path.join(root, file));
}
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
console.log(root);
