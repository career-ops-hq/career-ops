// The web inbox's Skip runs the core's lib/inbox-skip.mjs (#5269), the module
// the dashboard's Inbox `x` and `u` keys run through inbox-skip.mjs, so
// pipeline.md has one writer under one lock. These cases hold the web to that:
//
// - web/src/lib/core/inbox-skip.mjs is the core's lib/inbox-skip.mjs, byte for
//   byte (Turbopack cannot import the core, so the web carries a copy, and a
//   copy is one writer only while it cannot differ);
// - setInboxSkip writes under the lock it loads from the checkout;
// - /api/inbox/skip answers as it did before the move.
//
// inbox-skip.test.mjs (unchanged) still covers the rule and the round trip.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/inbox-skip-core.test.mjs

import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";

// The core CI installs root dependencies only, without Next. Stub just its
// response adapter (as gated-run-log.test.mjs does) and run the real handler.
const frameworkAdapter = `data:text/javascript,${encodeURIComponent("export const NextResponse = { json: (body, init) => Response.json(body, init) };")}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return { url: ${JSON.stringify(frameworkAdapter)}, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..");
const CORE_RULE = path.join(ROOT, "lib", "inbox-skip.mjs");
const WEB_RULE = path.join(ROOT, "web", "src", "lib", "core", "inbox-skip.mjs");

const web = await import(pathToFileURL(path.join(HERE, "..", "..", "src", "lib", "inbox-skip.mjs")).href);
const webUrl = await import(pathToFileURL(path.join(HERE, "..", "..", "src", "lib", "posting-url.mjs")).href);

const BETA = "https://jobs.lever.co/beta/2";
const PENDING = `## Pending\n\n- [ ] ${BETA} | Beta | Platform Engineer | NYC\n`;
const SKIPPED = `## Pending\n\n- [x] ${BETA} | Beta | Platform Engineer | NYC\n`;

const temps = [];
function tempDir(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

test("the web copy of the Skip rule is byte-for-byte the core's", () => {
  const core = fs.readFileSync(CORE_RULE);
  const mirror = fs.readFileSync(WEB_RULE);
  if (core.equals(mirror)) return;
  const coreLines = core.toString("utf8").split("\n");
  const webLines = mirror.toString("utf8").split("\n");
  const at = coreLines.findIndex((line, index) => line !== webLines[index]);
  const line = at === -1 ? Math.min(coreLines.length, webLines.length) : at;
  assert.fail(
    `web/src/lib/core/inbox-skip.mjs has drifted from lib/inbox-skip.mjs at line ${line + 1}:\n`
      + `  core: ${JSON.stringify(coreLines[line])}\n  web:  ${JSON.stringify(webLines[line])}\n`
      + "Edit lib/inbox-skip.mjs, then copy it over the web file.",
  );
});

test("the rule's postingUrl accepts exactly what the web's postingUrl accepts", async () => {
  const core = await import(pathToFileURL(CORE_RULE).href);
  const inputs = [
    BETA, `  ${BETA}  `, "http://example.com/a", "HTTPS://Example.com/A",
    "../data/applications.md", "/etc/passwd", "file:///etc/passwd", "javascript:alert(1)",
    "data:text/plain,hi", `${BETA}\n- [x] https://evil.example`, "https://user:pass@example.com/job",
    "https://", "", null, undefined, 42, `https://example.com/${"a".repeat(2100)}`,
  ];
  for (const input of inputs) {
    assert.equal(core.postingUrl(input), webUrl.postingUrl(input), JSON.stringify(input));
  }
});

test("setInboxSkip writes under the lock it loads from the checkout", async () => {
  // A stand-in lock module records each call, then runs the write.
  const checkout = tempDir("inbox-skip-checkout-");
  const calls = path.join(checkout, "calls.json");
  fs.writeFileSync(path.join(checkout, "pipeline-lock.mjs"), [
    'import fs from "node:fs";',
    "export async function withPipelineLock(file, run, options) {",
    `  fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify({ file, options }));`,
    "  return run();",
    "}",
  ].join("\n"));
  const file = path.join(tempDir("inbox-skip-data-"), "pipeline.md");
  fs.writeFileSync(file, PENDING);

  const result = await web.setInboxSkip(file, `  ${BETA}  `, true, { lockModule: path.join(checkout, "pipeline-lock.mjs") });

  assert.equal(result.ok, true);
  assert.equal(result.changed, 1);
  assert.equal(fs.readFileSync(file, "utf8"), SKIPPED);
  assert.deepEqual(JSON.parse(fs.readFileSync(calls, "utf8")), { file, options: { timeoutMs: 5_000, retryMs: 50 } });
});

test("a lock timeout from the checkout's lock is reported as busy, and nothing is written", async () => {
  const checkout = tempDir("inbox-skip-busy-");
  fs.writeFileSync(path.join(checkout, "pipeline-lock.mjs"), [
    "export async function withPipelineLock() {",
    '  throw Object.assign(new Error("held"), { name: "LockTimeoutError" });',
    "}",
  ].join("\n"));
  const file = path.join(tempDir("inbox-skip-data-"), "pipeline.md");
  fs.writeFileSync(file, PENDING);

  const result = await web.setInboxSkip(file, BETA, true, { lockModule: path.join(checkout, "pipeline-lock.mjs") });

  assert.deepEqual(result, { ok: false, error: "busy" });
  assert.equal(fs.readFileSync(file, "utf8"), PENDING);
});

// ---------------------------------------------------------------------------
// /api/inbox/skip: the same answers as before the write moved to the core.
// ---------------------------------------------------------------------------

async function withRoots(codeRoot, dataRoot, fn) {
  const keys = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.CAREER_OPS_CODE_ROOT = codeRoot;
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_DATA_DIR = "";
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

async function post(body) {
  const { POST } = await import("@/app/api/inbox/skip/route.ts");
  const res = await POST(new Request("http://localhost/api/inbox/skip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

test("/api/inbox/skip skips, undoes and refuses as before, with the checkout's lock", async () => {
  const data = tempDir("inbox-skip-route-");
  fs.mkdirSync(path.join(data, "data"));
  const file = path.join(data, "data", "pipeline.md");
  fs.writeFileSync(file, PENDING);

  await withRoots(ROOT, data, async () => {
    assert.deepEqual(await post({ url: BETA }), { status: 200, body: { ok: true, done: true, matched: 1, changed: 1 } });
    assert.equal(fs.readFileSync(file, "utf8"), SKIPPED);
    assert.deepEqual(await post({ url: BETA, done: true }), { status: 200, body: { ok: true, done: true, matched: 1, changed: 0 } });
    assert.deepEqual(await post({ url: BETA, done: false }), { status: 200, body: { ok: true, done: false, matched: 1, changed: 1 } });
    assert.equal(fs.readFileSync(file, "utf8"), PENDING);
    assert.deepEqual(await post({ url: "https://nobody.example/jobs/9" }), {
      status: 404, body: { error: "no pipeline row for that URL", code: "unmatched" },
    });
    assert.deepEqual(await post({ url: "file:///etc/passwd" }), {
      status: 400, body: { error: "url must be an http(s) posting URL", code: "invalid-url" },
    });
    assert.deepEqual(await post({ url: BETA, done: "yes" }), { status: 400, body: { error: "done must be a boolean" } });
  });
  assert.equal(fs.readdirSync(path.join(data, "data")).join(","), "pipeline.md", "a temp file or lock was left behind");
});
