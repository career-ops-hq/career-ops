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
// The source-shape checks pin the local-date call inside the generated child
// snippet. The integration check below imports the real module through the
// test alias loader and exercises that child against a separate data root.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/pipeline-local-today.test.mjs
// From the repo root:                   node --test web/tests/lib/pipeline-local-today.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path, { dirname, join } from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

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

test("localTodayUrl is built beside the scan script in the code root", () => {
  assert.match(
    src,
    /const localTodayUrl = pathToFileURL\(path\.join\(path\.dirname\(scanScript\),\s*["']lib["'],\s*["']local-today\.mjs["']\)\)\.href;/,
    `${SRC}: localTodayUrl must resolve lib/local-today.mjs beside scan.mjs in the code root, ` +
      `not under the independently configured data root.`,
  );
});

test("a separate data root receives both writes and writer failures use non-2xx responses", async t => {
  const dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-data-root-")));
  const codeRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const missingCodeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-route-code-")));
  const brokenCodeRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-child-code-")));
  fs.writeFileSync(
    path.join(brokenCodeRoot, "scan.mjs"),
    "export async function appendToPipeline() {}\nexport async function appendToScanHistory() {}\n",
  );
  const saved = {
    CAREER_OPS_ROOT: process.env.CAREER_OPS_ROOT,
    CAREER_OPS_CODE_ROOT: process.env.CAREER_OPS_CODE_ROOT,
  };
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
    fs.rmSync(missingCodeRoot, { recursive: true, force: true });
    fs.rmSync(brokenCodeRoot, { recursive: true, force: true });
  });

  const { addOffersToPipeline } = await import("@/lib/core/pipeline");
  const result = await addOffersToPipeline([{
    url: "https://jobs.example.com/platform-engineer",
    company: "Exemplo",
    title: "Platform Engineer",
    location: "Lisboa, Portugal",
    source: "teste",
  }]);

  assert.equal(result.added, 1);
  assert.equal(result.error, undefined);
  assert.match(fs.readFileSync(path.join(dataRoot, "data", "pipeline.md"), "utf8"), /https:\/\/jobs\.example\.com\/platform-engineer/);
  assert.match(fs.readFileSync(path.join(dataRoot, "data", "scan-history.tsv"), "utf8"), /https:\/\/jobs\.example\.com\/platform-engineer/);

  process.env.CAREER_OPS_CODE_ROOT = missingCodeRoot;
  const { POST } = await import("@/app/api/explore/add/route");
  const response = await POST(new Request("http://localhost/api/explore/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offers: [{ url: "https://jobs.example.com/unwritable" }] }),
  }));
  const body = await response.json();

  assert.equal(response.status, 500);
  assert.equal(body.added, 0);
  assert.match(body.error, /não inclui o módulo/i);

  process.env.CAREER_OPS_CODE_ROOT = brokenCodeRoot;
  const childFailure = await POST(new Request("http://localhost/api/explore/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offers: [{ url: "https://jobs.example.com/child-failure" }] }),
  }));
  const childFailureBody = await childFailure.json();

  assert.equal(childFailure.status, 500);
  assert.equal(childFailureBody.added, 0);
  assert.match(childFailureBody.error, /local-today|ERR_MODULE_NOT_FOUND|Cannot find module/i);
});
