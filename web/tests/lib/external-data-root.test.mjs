// An external data folder has to be the one Evaluate, PDF render, the PDF
// index, and CV studio read. A folder that is not there has to be one sentence,
// not a stack.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import "../helpers/web-ts-alias-loader.mjs";
import { dataFolderMissingMessage } from "../../src/lib/core/data-root.mjs";
import { renderAndMarkPdf } from "../../src/lib/pdf-render.mjs";

const REPO = path.resolve(import.meta.dirname, "../../..");

function savedCareerOpsEnv() {
  const saved = new Map();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CAREER_OPS_")) saved.set(key, process.env[key]);
  }
  return saved;
}

function restoreCareerOpsEnv(saved) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("CAREER_OPS_")) delete process.env[key];
  }
  for (const [key, value] of saved) process.env[key] = value;
}

test("dataFolderMissingMessage names the path, both env vars, and onboard-write", () => {
  const message = dataFolderMissingMessage("/tmp/career-ops-fixture");
  assert.equal(message.includes("\n"), false);
  assert.match(message, /Career-Ops data folder not found at \/tmp\/career-ops-fixture/);
  assert.match(message, /CAREER_OPS_ROOT/);
  assert.match(message, /CAREER_OPS_DATA_DIR/);
  assert.match(message, /node onboard-write\.mjs/);
  assert.doesNotMatch(message, /at Module|at async|\.mjs:\d+/);
});

const cliStub = `export const resolveCliOrFallback = () => ({ spec: { id: "claude", streamArgs: () => ["--print"], args: () => ["--print"], parseEvent: () => null }, binPath: "/fixture/never-run" });
export const cliSubstitutionNotice = () => null;
export const cliUnavailableError = () => ({ error: "Fixture CLI unavailable" });`;
const spawnStub = `export function spawnHeadlessCli() { throw new Error("No AI process may start in a data-root test"); }`;
const nextServerStub = `export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers || {});
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
  }
}`;
register(`data:text/javascript,${encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    const stubs = ${JSON.stringify({ "@/lib/clis": cliStub, "@/lib/spawn-cli.mjs": spawnStub, "next/server": nextServerStub })};
    if (Object.hasOwn(stubs, specifier)) return { url: "data:text/javascript," + encodeURIComponent(stubs[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const { POST } = await import("../../src/app/api/run/route.ts");
const { GET } = await import("../../src/app/api/cv-studio/[n]/route.ts");
const { resolvePdfIndexPath } = await import("../../src/lib/core/pdf-index.ts");

function evaluateRequest() {
  return new Request("http://fixture.invalid/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "evaluate", cliId: "claude", input: "https://jobs.example.test/role-1" }),
  });
}

test("Evaluate returns one line when the data folder is missing", async () => {
  const saved = savedCareerOpsEnv();
  const missing = path.join(os.tmpdir(), "career-ops-missing-data-root");
  fs.rmSync(missing, { recursive: true, force: true });
  process.env.CAREER_OPS_ROOT = missing;
  process.env.CAREER_OPS_CODE_ROOT = REPO;
  delete process.env.CAREER_OPS_DATA_DIR;
  try {
    const response = await POST(evaluateRequest());
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: dataFolderMissingMessage(missing) });
    assert.equal(String(body.error).includes("\n"), false);
  } finally {
    restoreCareerOpsEnv(saved);
  }
});

test("Evaluate reads cv.md from CAREER_OPS_DATA_DIR", async () => {
  const saved = savedCareerOpsEnv();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-external-data-"));
  fs.writeFileSync(path.join(dataRoot, "cv.md"), "# Jane Doe\n\nAnalyst at Example Co.\n");
  fs.mkdirSync(path.join(dataRoot, "config"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "config", "profile.yml"), "candidate:\n  full_name: Jane Doe\n");
  delete process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_DATA_DIR = dataRoot;
  process.env.CAREER_OPS_CODE_ROOT = REPO;
  try {
    const response = await POST(evaluateRequest());
    const body = await response.json();
    const error = typeof body.error === "string" ? body.error : JSON.stringify(body);
    assert.equal(response.status, 500, error);
    assert.equal(error, "No AI process may start in a data-root test");
    assert.doesNotMatch(error, /data folder not found/);
    assert.doesNotMatch(error, /Add your CV first/);
    assert.doesNotMatch(error, /career-ops checkout is incomplete/);
    assert.equal(error.includes("\n"), false);
  } finally {
    restoreCareerOpsEnv(saved);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("CV studio returns the same missing-folder sentence", async () => {
  const saved = savedCareerOpsEnv();
  const missing = path.join(os.tmpdir(), "career-ops-missing-studio-root");
  fs.rmSync(missing, { recursive: true, force: true });
  process.env.CAREER_OPS_ROOT = missing;
  process.env.CAREER_OPS_CODE_ROOT = REPO;
  delete process.env.CAREER_OPS_DATA_DIR;
  try {
    const response = await GET(new Request("http://fixture.invalid/api/cv-studio/1"), { params: Promise.resolve({ n: "1" }) });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: dataFolderMissingMessage(missing) });
  } finally {
    restoreCareerOpsEnv(saved);
  }
});

test("PDF render refuses a missing data folder without starting a renderer", async () => {
  const missing = path.join(os.tmpdir(), "career-ops-missing-pdf-root");
  fs.rmSync(missing, { recursive: true, force: true });
  let spawned = false;
  const result = await renderAndMarkPdf({
    spawnFn: () => { spawned = true; throw new Error("renderer started"); },
    execPath: process.execPath,
    coreRoot: REPO,
    dataRoot: missing,
    pdfPaths: { html: path.join(missing, "cv.html"), finalPdf: path.join(missing, "cv.pdf") },
    format: "letter",
    reportNum: "1",
  });
  assert.equal(spawned, false);
  assert.deepEqual(result, { kind: "render-failed", error: dataFolderMissingMessage(missing) });
});

test("PDF render pins the child to the external data folder", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-pdf-pin-"));
  const calls = [];
  const { EventEmitter } = await import("node:events");
  const spawnFn = (_exec, args, opts) => {
    calls.push({ args, opts });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    queueMicrotask(() => {
      if (String(args[0]).endsWith("generate-pdf.mjs")) fs.writeFileSync(args[2], "%PDF-1.4\n");
      child.emit("close", 0);
    });
    return child;
  };
  try {
    const html = path.join(dataRoot, "cv.html");
    const finalPdf = path.join(dataRoot, "cv.pdf");
    fs.writeFileSync(html, "<html></html>");
    const result = await renderAndMarkPdf({
      spawnFn,
      execPath: process.execPath,
      coreRoot: REPO,
      dataRoot,
      pdfPaths: { html, finalPdf },
      format: "letter",
      reportNum: "4",
    });
    assert.equal(result.kind, "rendered");
    assert.ok(calls.length >= 1);
    for (const call of calls) {
      assert.equal(call.opts.env.CAREER_OPS_ROOT, dataRoot);
      assert.equal(call.opts.cwd, REPO);
    }
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test("pdf-index uses the external data folder and stays quiet when it is missing", async () => {
  const saved = savedCareerOpsEnv();
  const missing = path.join(os.tmpdir(), "career-ops-missing-index-root");
  fs.rmSync(missing, { recursive: true, force: true });
  process.env.CAREER_OPS_ROOT = missing;
  process.env.CAREER_OPS_CODE_ROOT = REPO;
  delete process.env.CAREER_OPS_DATA_DIR;
  delete process.env.CAREER_OPS_TRACKER;
  delete process.env.CAREER_OPS_PDF_INDEX;
  try {
    assert.equal(await resolvePdfIndexPath(), null);
  } finally {
    restoreCareerOpsEnv(saved);
  }

  const again = savedCareerOpsEnv();
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-index-root-"));
  fs.mkdirSync(path.join(dataRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "data", "applications.md"), "# Applications\n");
  delete process.env.CAREER_OPS_ROOT;
  process.env.CAREER_OPS_DATA_DIR = dataRoot;
  process.env.CAREER_OPS_CODE_ROOT = REPO;
  delete process.env.CAREER_OPS_TRACKER;
  delete process.env.CAREER_OPS_PDF_INDEX;
  try {
    const indexPath = await resolvePdfIndexPath();
    assert.equal(indexPath, path.join(fs.realpathSync(dataRoot), "data", "pdf-index.tsv"));
  } finally {
    restoreCareerOpsEnv(again);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});
