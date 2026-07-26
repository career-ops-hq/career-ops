// Tests for pdf-render.mjs using Node's built-in test runner.
// Imports directly from pdf-render.mjs (the single source of truth) so the
// test and production code can never drift out of sync. spawnFn is a fake
// EventEmitter-based child process — no real generate-pdf.mjs/mark-pdf-
// ready.mjs subprocess is ever spawned by these tests.
//
// Run:  node --test tests/lib/pdf-render.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveRenderFormat,
  spawnGeneratePdf,
  markTrackerReady,
  cleanupPdfScratch,
  renderAndMarkPdf,
} from "../../src/lib/pdf-render.mjs";

// A fake child_process.spawn() result: stdout/stderr emit "data" once, then
// the child emits "close" (or "error" instead, for a spawn failure) on the
// next microtask — close enough to the real async timing for these tests.
function fakeChild({ stdout = "", stderr = "", exitCode = 0, spawnError = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (spawnError) {
      child.emit("error", spawnError);
      return;
    }
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", exitCode);
  });
  return child;
}

// spawnFn that dispatches based on the script path (args[0]) so a single
// fake stands in for both generate-pdf.mjs and mark-pdf-ready.mjs calls.
function makeRouterSpawn(routes) {
  const calls = [];
  const spawnFn = (execPath, args, opts) => {
    calls.push({ execPath, args, opts });
    const scriptPath = args[0];
    const route = Object.entries(routes).find(([suffix]) => scriptPath.endsWith(suffix));
    if (!route) throw new Error(`no fake route for ${scriptPath}`);
    return fakeChild(route[1]);
  };
  return { spawnFn, calls };
}

function makeScratchDir() {
  return mkdtempSync(join(tmpdir(), "co-pdfrender-"));
}

// ── resolveRenderFormat ──

test("resolveRenderFormat: valid letter sidecar", () => {
  const dir = makeScratchDir();
  try {
    const meta = join(dir, "cv-web-1.meta.json");
    writeFileSync(meta, JSON.stringify({ format: "letter" }));
    assert.deepEqual(resolveRenderFormat(meta), { format: "letter", ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRenderFormat: valid a4 sidecar", () => {
  const dir = makeScratchDir();
  try {
    const meta = join(dir, "cv-web-1.meta.json");
    writeFileSync(meta, JSON.stringify({ format: "a4" }));
    assert.deepEqual(resolveRenderFormat(meta), { format: "a4", ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRenderFormat: missing file -> defaults to letter, ok:false", () => {
  const dir = makeScratchDir();
  try {
    assert.deepEqual(resolveRenderFormat(join(dir, "does-not-exist.json")), { format: "letter", ok: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRenderFormat: malformed JSON -> defaults to letter, ok:false", () => {
  const dir = makeScratchDir();
  try {
    const meta = join(dir, "cv-web-1.meta.json");
    writeFileSync(meta, "{not json");
    assert.deepEqual(resolveRenderFormat(meta), { format: "letter", ok: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRenderFormat: valid JSON but invalid format value -> defaults to letter, ok:false", () => {
  const dir = makeScratchDir();
  try {
    const meta = join(dir, "cv-web-1.meta.json");
    writeFileSync(meta, JSON.stringify({ format: "legal" }));
    assert.deepEqual(resolveRenderFormat(meta), { format: "letter", ok: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── spawnGeneratePdf ──

test("spawnGeneratePdf: clean exit -> ok:true, invokes generate-pdf.mjs with --allow-reorder", async () => {
  const calls = [];
  const spawnFn = (execPath, args, opts) => { calls.push({ execPath, args, opts }); return fakeChild({ exitCode: 0 }); };
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", root: "/root", html: "/root/x.html", finalPdf: "/root/output/x.pdf", format: "letter", reportNum: "018" });
  assert.deepEqual(result, { ok: true, stderr: "" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[0], /generate-pdf\.mjs$/);
  assert.deepEqual(calls[0].args.slice(1), ["/root/x.html", "/root/output/x.pdf", "--format=letter", "--report=018", "--allow-reorder"]);
  assert.equal(calls[0].opts.cwd, "/root");
});

test("spawnGeneratePdf: non-zero exit -> ok:false, stderr surfaced", async () => {
  const spawnFn = () => fakeChild({ exitCode: 1, stderr: "section order guard failed" });
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", root: "/root", html: "x.html", finalPdf: "x.pdf", format: "a4", reportNum: "1" });
  assert.deepEqual(result, { ok: false, stderr: "section order guard failed" });
});

test("spawnGeneratePdf: spawn error -> ok:false, descriptive stderr", async () => {
  const spawnFn = () => fakeChild({ spawnError: new Error("ENOENT") });
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", root: "/root", html: "x.html", finalPdf: "x.pdf", format: "letter", reportNum: "1" });
  assert.equal(result.ok, false);
  assert.match(result.stderr, /PDF rendering failed to start: ENOENT/);
});

// ── markTrackerReady ──

test("markTrackerReady: clean exit with JSON stdout -> ok:true, data parsed", async () => {
  const stdout = JSON.stringify({ changed: true, num: 5, company: "Acme" });
  const spawnFn = () => fakeChild({ exitCode: 0, stdout });
  const result = await markTrackerReady({ spawnFn, execPath: "node", root: "/root", reportNum: "5" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { changed: true, num: 5, company: "Acme" });
});

test("markTrackerReady: failure exit with parseable --json error -> data.error available", async () => {
  const stdout = JSON.stringify({ error: "No tracker row links report #5", code: "not-found" });
  const spawnFn = () => fakeChild({ exitCode: 2, stdout });
  const result = await markTrackerReady({ spawnFn, execPath: "node", root: "/root", reportNum: "5" });
  assert.equal(result.ok, false);
  assert.equal(result.data?.error, "No tracker row links report #5");
});

test("markTrackerReady: failure exit with no/garbled stdout -> data:null, raw stderr kept", async () => {
  const spawnFn = () => fakeChild({ exitCode: 1, stderr: "unexpected crash" });
  const result = await markTrackerReady({ spawnFn, execPath: "node", root: "/root", reportNum: "5" });
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.equal(result.stderr, "unexpected crash");
});

test("markTrackerReady: spawn error -> ok:false, descriptive stderr", async () => {
  const spawnFn = () => fakeChild({ spawnError: new Error("EACCES") });
  const result = await markTrackerReady({ spawnFn, execPath: "node", root: "/root", reportNum: "5" });
  assert.equal(result.ok, false);
  assert.match(result.stderr, /mark-pdf-ready\.mjs failed to start: EACCES/);
});

// ── cleanupPdfScratch ──

test("cleanupPdfScratch: removes only files matching the prefix", () => {
  // Given a scratch dir with this run's files and an unrelated run's files
  const dir = makeScratchDir();
  try {
    writeFileSync(join(dir, "cv-web-7.html"), "x");
    writeFileSync(join(dir, "cv-web-7.meta.json"), "{}");
    writeFileSync(join(dir, "cv-web-7.payload.json"), "{}"); // agent-created intermediate
    writeFileSync(join(dir, "cv-web-99.html"), "unrelated run");

    // When cleaning up report #7's scratch files
    cleanupPdfScratch(dir, "cv-web-7.");

    // Then only the #7-prefixed files are gone
    assert.deepEqual(readdirSync(dir).sort(), ["cv-web-99.html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cleanupPdfScratch: missing directory logs but does not throw", () => {
  const dir = join(makeScratchDir(), "does-not-exist");
  const originalError = console.error;
  const logged = [];
  console.error = (msg) => logged.push(msg);
  try {
    assert.doesNotThrow(() => cleanupPdfScratch(dir, "cv-web-1."));
    assert.equal(logged.length, 1);
    assert.match(logged[0], /pdf scratch cleanup: could not list/);
  } finally {
    console.error = originalError;
  }
});

// ── renderAndMarkPdf ──

function makePdfPaths(dir, reportNum) {
  return {
    html: join(dir, `cv-web-${reportNum}.html`),
    meta: join(dir, `cv-web-${reportNum}.meta.json`),
    finalPdf: join(dir, "output", `cv-jane-acme-2026-07-26.pdf`),
  };
}

test("renderAndMarkPdf: happy path -> rendered with no warnings, scratch cleaned up", async () => {
  // Given a valid format sidecar and both scripts succeeding
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "1");
  writeFileSync(pdfPaths.html, "<html></html>");
  writeFileSync(pdfPaths.meta, JSON.stringify({ format: "letter" }));
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0 },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, reportNum: "1" });

    // Then it reports rendered with no warnings, and scratch is cleaned up
    assert.deepEqual(result, { kind: "rendered", warnings: [] });
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("cv-web-1.")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: missing format sidecar -> still renders, carries a warning", async () => {
  // Given NO format sidecar was written, but both scripts still succeed
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "2");
  writeFileSync(pdfPaths.html, "<html></html>");
  const { spawnFn, calls } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0 },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, reportNum: "2" });

    // Then it still renders (using the letter default) but surfaces a warning,
    // and the render itself was actually invoked with the defaulted format
    assert.equal(result.kind, "rendered");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /No valid page-format file found/);
    assert.ok(calls[0].args.includes("--format=letter"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: generate-pdf.mjs fails -> render-failed, mark-pdf-ready never invoked, scratch still cleaned up", async () => {
  // Given generate-pdf.mjs exits non-zero
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "3");
  writeFileSync(pdfPaths.html, "<html></html>");
  writeFileSync(pdfPaths.meta, JSON.stringify({ format: "letter" }));
  const { spawnFn, calls } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 1, stderr: "Refusing to write the PDF outside the project directory" },
    "mark-pdf-ready.mjs": { exitCode: 0 },
  });
  try {
    // When rendering
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, reportNum: "3" });

    // Then it reports render-failed with the render's stderr, never calls mark-pdf-ready, and still cleans scratch
    assert.deepEqual(result, { kind: "render-failed", error: "Refusing to write the PDF outside the project directory" });
    assert.equal(calls.length, 1);
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("cv-web-3.")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: render succeeds but mark-pdf-ready fails -> rendered with a specific warning", async () => {
  // Given generate-pdf.mjs succeeds but mark-pdf-ready.mjs fails with a --json error
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "4");
  writeFileSync(pdfPaths.html, "<html></html>");
  writeFileSync(pdfPaths.meta, JSON.stringify({ format: "a4" }));
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0 },
    "mark-pdf-ready.mjs": { exitCode: 2, stdout: JSON.stringify({ error: "No tracker row links report #4", code: "not-found" }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, reportNum: "4" });

    // Then the PDF is still reported rendered, but the warning carries mark-pdf-ready's specific error
    assert.equal(result.kind, "rendered");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /No tracker row links report #4/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
