// Guards the day the run route stamps on reports, tracker rows and PDF paths.
//
// `new Date().toISOString().slice(0, 10)` is the UTC day. On an evening west of
// Greenwich the web UI's evaluation named reports/{num}-{slug}-{date}.md and
// filled the tracker's date column with tomorrow's date, while the CLI
// (batch-runner.sh) and the followups route already used the local day.
//
// route.ts is TypeScript and imports via the `@/` alias, which plain
// `node --test` cannot resolve without the Next.js build, so — same as
// tests/lib/pipeline-local-today.test.mjs (#3070) — this reads the source and
// asserts the shape.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/run-route-local-today.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "app",
  "api",
  "run",
  "route.ts",
);
const src = readFileSync(SRC, "utf8");

test("the run route no longer derives the day from toISOString().slice(0, 10)", () => {
  assert.doesNotMatch(
    src,
    /toISOString\(\)\.slice\(\s*0\s*,\s*10\s*\)/,
    `${SRC}: the UTC day is back. West of Greenwich it dates the report, tracker row and PDF ` +
      `paths a day ahead of the user's clock — use localISODate() from @/lib/followups.`,
  );
});

test("today comes from localISODate(), imported from @/lib/followups", () => {
  assert.match(
    src,
    /import\s*{\s*localISODate\s*}\s*from\s*["']@\/lib\/followups["']\s*;/,
  );
  assert.match(src, /const\s+today\s*=\s*localISODate\(\)\s*;/);
});
