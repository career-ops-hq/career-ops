// Disposable fictional data for this browser suite; never reads user files.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-portal-monitors-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, ".portal-monitor-fixture"), "fictional-only\n");
fs.writeFileSync(path.join(root, "cv.md"), "# Fictional browser fixture\n\nNot a real candidate.\n");
// Only core/provider children receive this preload; the browser talks to the
// real server. Unexpected provider requests fail instead of reaching the web.
fs.writeFileSync(path.join(root, "fixture-fetch.mjs"), `
import fs from 'node:fs';
import path from 'node:path';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = String(input?.url || input);
  if (url.startsWith('https://boards-api.greenhouse.io/v1/boards/fixture-primary/jobs?')) {
    const file = process.env.PORTAL_TEST_FIXTURE_DATA || path.join(process.env.CAREER_OPS_ROOT, 'data/website-fixture.json');
    return Response.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  if (new URL(url).hostname === '127.0.0.1' || new URL(url).hostname === 'localhost') return originalFetch(input, options);
  throw new Error('Unexpected fixture network request: ' + url);
};
`);
console.log(root);
