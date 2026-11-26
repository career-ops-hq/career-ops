// "Add to pipeline" for a pasted URL on the home page (issue #7812): records
// the posting through the core's captureJd() (capture-jd.mjs, #7272) and does
// nothing else — no evaluation worker, no commit, no push.
//
// Driven for real: the route handler is imported under the @/ loader, the code
// root is this checkout (so the real capture-jd.mjs writes), and the data root
// is a temp directory.
//
// Run (from web/, as `npm test` does):  node --test tests/lib/pipeline-capture-route.test.mjs

import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "../helpers/web-ts-alias-loader.mjs";
import { captureWriterResult, MAX_CAPTURE_TEXT_BYTES, parseCaptureRequest } from "../../src/lib/core/capture-request.mjs";

const WEB = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const CODE_ROOT = dirname(WEB);
const dataRoot = mkdtempSync(join(tmpdir(), "co-capture-route-data-"));
const ENV_KEYS = ["CAREER_OPS_CODE_ROOT", "CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_TRACKER"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let POST;

before(async () => {
  process.env.CAREER_OPS_CODE_ROOT = CODE_ROOT;
  process.env.CAREER_OPS_ROOT = dataRoot;
  process.env.CAREER_OPS_DATA_DIR = "";
  process.env.CAREER_OPS_TRACKER = "";
  ({ POST } = await import("../../src/app/api/pipeline/capture/route.ts"));
});

after(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dataRoot, { recursive: true, force: true });
});

function post(body) {
  return POST(new Request("http://127.0.0.1/api/pipeline/capture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

const pipeline = () => readFileSync(join(dataRoot, "data", "pipeline.md"), "utf8");
const jds = () => (existsSync(join(dataRoot, "jds")) ? readdirSync(join(dataRoot, "jds")) : []);

test("a URL alone becomes one Pending row and nothing else", async () => {
  const res = await post({ url: "https://jobs.ashbyhq.com/acme/1111" });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.ok, true);
  assert.equal(data.appended, true);
  assert.equal(data.hasText, false);
  assert.match(pipeline(), /- \[ \] https:\/\/jobs\.ashbyhq\.com\/acme\/1111 .*note: url only/);
  assert.deepEqual(jds(), [], "no JD text, no capture file");
});

test("JD text is archived under jds/ beside the row", async () => {
  const res = await post({ url: "https://jobs.ashbyhq.com/acme/2222", text: "Senior Engineer\nBuild things.", company: "Acme", role: "Senior Engineer" });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data));
  assert.equal(data.hasText, true);
  const files = jds();
  assert.equal(files.length, 1);
  assert.match(readFileSync(join(dataRoot, "jds", files[0]), "utf8"), /Build things\./);
  assert.match(pipeline(), /https:\/\/jobs\.ashbyhq\.com\/acme\/2222 \| Acme \| Senior Engineer/);
});

test("the same URL twice writes nothing the second time", async () => {
  const before = pipeline();
  const res = await post({ url: "https://jobs.ashbyhq.com/acme/1111" });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.duplicate, true);
  assert.equal(data.appended, false);
  assert.equal(pipeline(), before);
});

test("a URL the core refuses is a 400 and writes nothing", async () => {
  const before = pipeline();
  for (const url of ["https://user:pw@example.com/job", "ftp://example.com/job", "https://example.com/a b"]) {
    const res = await post({ url });
    assert.equal(res.status, 400, url);
    assert.equal((await res.json()).ok, false);
  }
  assert.equal(pipeline(), before);
});

test("malformed bodies are a 400", async () => {
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ url: "https://example.com/j", text: 42 })).status, 400);
});

test("commit, push and dataRoot in the body never reach captureJd()", () => {
  const parsed = parseCaptureRequest({ url: "https://example.com/j", commit: true, push: true, dataRoot: "/etc", evaluate: true });
  assert.deepEqual(parsed, { input: { url: "https://example.com/j" } });
  const src = readFileSync(join(WEB, "src", "lib", "core", "capture.ts"), "utf8");
  assert.match(src, /captureJd\(\{ url, text, company, role \}\)/, "the child forwards exactly these four fields");
  assert.doesNotMatch(src, /\b(commit|push|evaluate|dataRoot)\s*:/, "no git or evaluation flag is ever set");
});

test("JD text over the server's ceiling is refused before any write", () => {
  const parsed = parseCaptureRequest({ url: "https://example.com/j", text: "x".repeat(MAX_CAPTURE_TEXT_BYTES + 1) });
  assert.ok("error" in parsed);
});

test("a child that dies before answering is a failure, not a silent success", () => {
  const result = captureWriterResult("", "Error [ERR_MODULE_NOT_FOUND]: nope\nNode.js v22.0.0", { code: 1, signal: null });
  assert.equal(result.ok, false);
  assert.match(result.error, /capture writer failed \(exit code 1\): Error \[ERR_MODULE_NOT_FOUND\]/);
});

test("the home page's Add to pipeline never starts a worker", () => {
  const src = readFileSync(join(WEB, "src", "components", "quick-evaluate.tsx"), "utf8");
  const body = src.slice(src.indexOf("async function capture()"), src.indexOf("return (", src.indexOf("async function capture()")));
  assert.ok(body.length > 0, "capture() exists");
  assert.match(body, /fetch\("\/api\/pipeline\/capture"/);
  assert.doesNotMatch(body, /startJob/);
  assert.match(src, /No evaluation, no tokens/, "the button says what it does not do");
});

test("JD text within its decoded limit is not refused for its JSON escaping", async () => {
  // Each \u0001 is one decoded byte but six on the wire (`\u0001`): 450 KB of
  // text arrives as a ~2.6 MiB body, past a cap counted on raw text alone.
  const text = `Role\n${"\u0001".repeat(450 * 1024)}\nend`;
  assert.ok(Buffer.byteLength(JSON.stringify(text)) > MAX_CAPTURE_TEXT_BYTES + 64 * 1024);
  const res = await post({ url: "https://jobs.ashbyhq.com/acme/3333", text });
  const data = await res.json();
  assert.equal(res.status, 200, JSON.stringify(data).slice(0, 300));
  assert.equal(data.hasText, true);
});

test("JD text over its decoded limit gets the 'too long' answer, not a generic bad request", async () => {
  const res = await post({ url: "https://jobs.ashbyhq.com/acme/4444", text: "x".repeat(MAX_CAPTURE_TEXT_BYTES + 1) });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /too long/);
});

test("a child that exits before reading a large JD fails the capture without crashing the server", async () => {
  // EPIPE on child.stdin is a stream error, not a child error: with no
  // listener on the pipe it is an uncaught exception in the web process.
  const standIn = mkdtempSync(join(tmpdir(), "co-capture-dead-child-"));
  writeFileSync(join(standIn, "capture-jd.mjs"), "process.exit(3);\nexport async function captureJd() {}\n");
  const saved = process.env.CAREER_OPS_CODE_ROOT;
  process.env.CAREER_OPS_CODE_ROOT = standIn;
  try {
    const { capturePosting } = await import("../../src/lib/core/capture.ts");
    for (let i = 0; i < 3; i++) {
      const result = await capturePosting({ url: "https://example.com/job", text: "x".repeat(MAX_CAPTURE_TEXT_BYTES) });
      assert.equal(result.ok, false);
      assert.match(result.error, /capture writer failed/);
    }
  } finally {
    process.env.CAREER_OPS_CODE_ROOT = saved;
    rmSync(standIn, { recursive: true, force: true });
  }
});

test("the home form is read-only while a capture is in flight", () => {
  const src = readFileSync(join(WEB, "src", "components", "quick-evaluate.tsx"), "utf8");
  // Both inputs: a successful capture clears them, which would otherwise erase
  // a posting typed while the request was pending.
  assert.equal(src.split("readOnly={capturing}").length - 1, 2);
  assert.match(src, /e\.key === "Enter" && !capturing/);
});
