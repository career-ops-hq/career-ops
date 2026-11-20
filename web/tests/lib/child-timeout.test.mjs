// A child that ignores SIGTERM used to leave the request open. These two
// routes now escalate to SIGKILL and answer. CAREER_OPS_CHILD_TIMEOUT_MS
// shortens the first wait so the test spends its time on the grace period.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../helpers/web-ts-alias-loader.mjs";

const codeRoot = mkdtempSync(join(tmpdir(), "co-child-timeout-code-"));
const dataRoot = mkdtempSync(join(tmpdir(), "co-child-timeout-data-"));
const ENV_KEYS = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER", "CAREER_OPS_CHILD_TIMEOUT_MS"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

before(() => {
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_DATA_DIR = "";
  process.env.CAREER_OPS_TRACKER = "";
  process.env.CAREER_OPS_CHILD_TIMEOUT_MS = "100";
});

after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(codeRoot, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });
});

const HANG = 'process.on("SIGTERM", () => {});\nsetInterval(() => {}, 1e9);\n';
const EXIT_ON_TERM = 'process.on("SIGTERM", () => { console.log(JSON.stringify({ added: 1, already: 0, found: 1, message: "Added 1." })); process.exit(0); });\nsetInterval(() => {}, 1e9);\n';
// Windows kills SIGTERM immediately, like SIGKILL, so the handler never runs
// and the grace window never elapses. The timeout message still has to show
// on every platform. The grace floor and the exit-on-signal case stay on POSIX.
const canCatchTerm = process.platform !== "win32";

test("a tracker delete that ignores SIGTERM is stopped and the next delete can run", async () => {
  writeFileSync(join(codeRoot, "tracker.mjs"), `// tracker.mjs delete --num\n${HANG}`);
  const { POST } = await import("@/app/api/tracker/delete/route.ts");
  const started = Date.now();
  const res = await POST(new Request("http://localhost/api/tracker/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ n: "4" }),
  }));
  const body = await res.json();
  const elapsed = Date.now() - started;
  assert.equal(res.status, 400);
  assert.equal(body.error, "Delete timed out after 30 seconds and was stopped.");
  assert.ok(elapsed < 8_000, `the request stayed open (${elapsed}ms)`);
  if (canCatchTerm) assert.ok(elapsed >= 1_500, `killed too soon (${elapsed}ms)`);

  writeFileSync(join(codeRoot, "tracker.mjs"), "// tracker.mjs delete --num\nprocess.exit(0);\n");
  const again = await POST(new Request("http://localhost/api/tracker/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ n: "4" }),
  }));
  assert.equal(again.status, 200, JSON.stringify(await again.json()));

  if (!canCatchTerm) return;
  writeFileSync(join(codeRoot, "tracker.mjs"), `// tracker.mjs delete --num\n${EXIT_ON_TERM}`);
  const kept = await POST(new Request("http://localhost/api/tracker/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ n: "4" }),
  }));
  const keptBody = await kept.json();
  assert.equal(kept.status, 200, JSON.stringify(keptBody));
  assert.equal(keptBody.ok, true);
});

test("a LinkedIn import that ignores SIGTERM is stopped", async () => {
  writeFileSync(join(codeRoot, "linkedin-import.mjs"), HANG);
  const { POST } = await import("@/app/api/linkedin-import/route.ts");
  const started = Date.now();
  const res = await POST(new Request("http://localhost/api/linkedin-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Engineer at Example\nhttps://example.test/jobs/1" }),
  }));
  const body = await res.json();
  const elapsed = Date.now() - started;
  assert.equal(res.status, 500);
  assert.equal(body.uncertain, true);
  assert.equal(body.message, "The import timed out after 30 seconds and was stopped. Check Pipeline before pasting again.");
  assert.ok(elapsed < 8_000, `the request stayed open (${elapsed}ms)`);
  if (canCatchTerm) assert.ok(elapsed >= 1_500, `killed too soon (${elapsed}ms)`);
  if (!canCatchTerm) return;

  writeFileSync(join(codeRoot, "linkedin-import.mjs"), EXIT_ON_TERM);
  const kept = await POST(new Request("http://localhost/api/linkedin-import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Engineer at Example\nhttps://example.test/jobs/1" }),
  }));
  const keptBody = await kept.json();
  assert.equal(kept.status, 200, JSON.stringify(keptBody));
  assert.equal(keptBody.added, 1);
  assert.equal(keptBody.message, "Added 1.");
});
