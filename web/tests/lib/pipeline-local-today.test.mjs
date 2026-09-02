// Guards the date computed by the child-process snippet in
// src/lib/core/pipeline.ts (`addOffersToPipeline`) — the "Add to pipeline"
// writer that stamps data/scan-history.tsv's first_seen column (#3070).
//
// `new Date().toISOString().slice(0, 10)` is the UTC day. West of Greenwich,
// an evening "Add to pipeline" click stamped first_seen one day ahead of the
// user's own clock, so scan.mjs's shouldDedupScanHistoryRow recheck/cooldown
// window opened a day late for that row. #3071 fixed the same pattern in six
// core .mjs call sites (including scan.mjs's own DEFAULT for this argument),
// but pipeline.ts always passes an explicit `date` argument, which overrides
// that default — so this call site needed its own fix and its own guard.
//
// pipeline.ts is TypeScript, imports via the `@/` path alias (which plain
// `node --test` cannot resolve without the Next.js build), and computes the
// date inside a template-literal string executed in a SEPARATE spawned
// process — so, same as tests/lib/core-writer-await.test.mjs, it cannot be
// imported and exercised here. This reads the source and asserts the shape.
// The fix itself was verified by execution in a frozen-clock scratch child
// (see the PR description) before this guard was written.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/pipeline-local-today.test.mjs
// From the repo root:                   node --test web/tests/lib/pipeline-local-today.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "lib", "core", "pipeline.ts");
const src = readFileSync(SRC, "utf8");

// The generated child-process code lives inside the backtick template
// assigned to `code`. Isolating it keeps the assertions below from also
// matching an unrelated `new Date()` elsewhere in the (TypeScript) file.
function extractChildProcessCode() {
  const m = src.match(/const code = `([\s\S]*?)`;/);
  assert.ok(m, `${SRC}: could not find the \`const code = \`...\`;\` template — the writer snippet was restructured. Update this extractor.`);
  return m[1];
}

test("the child-process snippet still exists at the shape this test extracts", () => {
  assert.ok(extractChildProcessCode().length > 0);
});

test("the legacy UTC-day pattern is gone from the child-process snippet", () => {
  const code = extractChildProcessCode();
  assert.doesNotMatch(
    code,
    /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    `${SRC}: the child-process snippet resolves "today" with the UTC day again. ` +
      `West of Greenwich this stamps scan-history.tsv's first_seen a day ahead of the ` +
      `user's own clock (#3070) — use localToday() from lib/local-today.mjs instead.`,
  );
});

test("the date handed to appendToScanHistory comes from localToday()", () => {
  const code = extractChildProcessCode();
  assert.match(
    code,
    /const\s+date\s*=\s*localToday\(\)\s*;/,
    `${SRC}: expected \`const date = localToday();\` in the child-process snippet.`,
  );
  // The assertion above only proves `date` is ASSIGNED from localToday() — not
  // that the call site actually passes it on. A rename at the call (e.g. back
  // to an inline `new Date()...`, or a stray second variable) would leave the
  // `date` assignment unused and this bug's actual symptom would resurface.
  assert.match(
    code,
    /appendToScanHistory\(\s*offers\s*,\s*date\s*,\s*["']added["']\s*\)/,
    `${SRC}: expected appendToScanHistory(offers, date, "added") — the local-day ` +
      `value must reach the writer, not just get computed and discarded.`,
  );
});

test("localToday is imported into the spawned child from lib/local-today.mjs", () => {
  const code = extractChildProcessCode();
  assert.match(
    code,
    /import\s*{\s*localToday\s*}\s*from\s+\$\{JSON\.stringify\(localTodayUrl\)\}\s*;/,
    `${SRC}: the child process resolves imports independently of the TypeScript module's own ` +
      `cwd, so localToday must be imported via an interpolated absolute file:// URL — the same ` +
      `pattern already used for scanUrl — not a bare relative specifier that would only resolve ` +
      `by coincidence of the spawn's cwd.`,
  );
});

test("localTodayUrl is built the same way scanUrl is: an absolute file:// URL under careerOpsRoot()", () => {
  assert.match(
    src,
    /const localTodayUrl = pathToFileURL\(path\.join\(careerOpsRoot\(\),\s*["']lib["'],\s*["']local-today\.mjs["']\)\)\.href;/,
    `${SRC}: localTodayUrl must resolve lib/local-today.mjs under careerOpsRoot(), so the import ` +
      `works regardless of the checkout the web dashboard is pointed at.`,
  );
});
