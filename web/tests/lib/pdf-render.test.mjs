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
  // Given a sidecar file with a valid "letter" format
  const dir = makeScratchDir();
  try {
    const meta = join(dir, "cv-web-1.meta.json");
    writeFileSync(meta, JSON.stringify({ format: "letter" }));

    // When resolving the render format
    // Then it returns that format, ok:true
    assert.deepEqual(resolveRenderFormat(meta), { format: "letter", ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRenderFormat: valid a4 sidecar", () => {
  // Given a sidecar file with a valid "a4" format
  const dir = makeScratchDir();
  try {
    const meta = join(dir, "cv-web-1.meta.json");
    writeFileSync(meta, JSON.stringify({ format: "a4" }));

    // When resolving the render format
    // Then it returns that format, ok:true
    assert.deepEqual(resolveRenderFormat(meta), { format: "a4", ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRenderFormat: missing file -> defaults to letter, ok:false", () => {
  // Given no sidecar file was ever written
  const dir = makeScratchDir();
  try {
    // When resolving the render format
    // Then it defaults to letter and reports ok:false (caller should warn)
    assert.deepEqual(resolveRenderFormat(join(dir, "does-not-exist.json")), { format: "letter", ok: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRenderFormat: malformed JSON -> defaults to letter, ok:false", () => {
  // Given a sidecar file that isn't valid JSON
  const dir = makeScratchDir();
  try {
    const meta = join(dir, "cv-web-1.meta.json");
    writeFileSync(meta, "{not json");

    // When resolving the render format
    // Then it defaults to letter and reports ok:false
    assert.deepEqual(resolveRenderFormat(meta), { format: "letter", ok: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveRenderFormat: valid JSON but invalid format value -> defaults to letter, ok:false", () => {
  // Given a sidecar file with valid JSON but a format value that isn't letter/a4
  const dir = makeScratchDir();
  try {
    const meta = join(dir, "cv-web-1.meta.json");
    writeFileSync(meta, JSON.stringify({ format: "legal" }));

    // When resolving the render format
    // Then it defaults to letter and reports ok:false
    assert.deepEqual(resolveRenderFormat(meta), { format: "letter", ok: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── spawnGeneratePdf ──

test("spawnGeneratePdf: clean exit -> ok:true, invokes generate-pdf.mjs with --allow-reorder", async () => {
  // Given generate-pdf.mjs will exit cleanly
  const calls = [];
  const spawnFn = (execPath, args, opts) => { calls.push({ execPath, args, opts }); return fakeChild({ exitCode: 0 }); };

  // When spawning the render
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", root: "/root", html: "/root/x.html", finalPdf: "/root/output/x.pdf", format: "letter", reportNum: "018" });

  // Then it reports ok:true and invoked generate-pdf.mjs with the expected args
  assert.deepEqual(result, { ok: true, stderr: "" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[0], /generate-pdf\.mjs$/);
  assert.deepEqual(calls[0].args.slice(1), ["/root/x.html", "/root/output/x.pdf", "--format=letter", "--report=018", "--allow-reorder"]);
  assert.equal(calls[0].opts.cwd, "/root");
});

test("spawnGeneratePdf: non-zero exit -> ok:false, stderr surfaced", async () => {
  // Given generate-pdf.mjs will exit non-zero with a stderr message
  const spawnFn = () => fakeChild({ exitCode: 1, stderr: "section order guard failed" });

  // When spawning the render
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", root: "/root", html: "x.html", finalPdf: "x.pdf", format: "a4", reportNum: "1" });

  // Then it reports ok:false with that stderr
  assert.deepEqual(result, { ok: false, stderr: "section order guard failed" });
});

test("spawnGeneratePdf: spawn error -> ok:false, descriptive stderr", async () => {
  // Given the child process itself fails to spawn (e.g. missing binary)
  const spawnFn = () => fakeChild({ spawnError: new Error("ENOENT") });

  // When spawning the render
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", root: "/root", html: "x.html", finalPdf: "x.pdf", format: "letter", reportNum: "1" });

  // Then it reports ok:false with a descriptive message, not a raw crash
  assert.equal(result.ok, false);
  assert.match(result.stderr, /PDF rendering failed to start: ENOENT/);
});

// ── markTrackerReady ──

test("markTrackerReady: clean exit with JSON stdout -> ok:true, data parsed", async () => {
  // Given mark-pdf-ready.mjs succeeds and prints a --json payload
  const stdout = JSON.stringify({ changed: true, num: 5, company: "Acme" });
  const spawnFn = () => fakeChild({ exitCode: 0, stdout });

  // When marking the tracker ready
  const result = await markTrackerReady({ spawnFn, execPath: "node", root: "/root", reportNum: "5" });

  // Then it reports ok:true with the parsed payload
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { changed: true, num: 5, company: "Acme" });
});

test("markTrackerReady: failure exit with parseable --json error -> data.error available", async () => {
  // Given mark-pdf-ready.mjs fails but still prints a structured --json error
  const stdout = JSON.stringify({ error: "No tracker row links report #5", code: "not-found" });
  const spawnFn = () => fakeChild({ exitCode: 2, stdout });

  // When marking the tracker ready
  const result = await markTrackerReady({ spawnFn, execPath: "node", root: "/root", reportNum: "5" });

  // Then it reports ok:false with the specific error available for callers to surface
  assert.equal(result.ok, false);
  assert.equal(result.data?.error, "No tracker row links report #5");
});

test("markTrackerReady: failure exit with no/garbled stdout -> data:null, raw stderr kept", async () => {
  // Given mark-pdf-ready.mjs crashes before printing any JSON
  const spawnFn = () => fakeChild({ exitCode: 1, stderr: "unexpected crash" });

  // When marking the tracker ready
  const result = await markTrackerReady({ spawnFn, execPath: "node", root: "/root", reportNum: "5" });

  // Then it reports ok:false with data:null, falling back to the raw stderr
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.equal(result.stderr, "unexpected crash");
});

test("markTrackerReady: spawn error -> ok:false, descriptive stderr", async () => {
  // Given the child process itself fails to spawn
  const spawnFn = () => fakeChild({ spawnError: new Error("EACCES") });

  // When marking the tracker ready
  const result = await markTrackerReady({ spawnFn, execPath: "node", root: "/root", reportNum: "5" });

  // Then it reports ok:false with a descriptive message
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
  // Given the scratch directory itself doesn't exist
  const dir = join(makeScratchDir(), "does-not-exist");
  const originalError = console.error;
  const logged = [];
  console.error = (msg) => logged.push(msg);
  try {
    // When cleaning up
    // Then it logs the failure instead of throwing, so a caller can't crash on cleanup
    assert.doesNotThrow(() => cleanupPdfScratch(dir, "cv-web-1."));
    assert.equal(logged.length, 1);
    assert.match(logged[0], /pdf scratch cleanup: could not list/);
  } finally {
    console.error = originalError;
  }
});

test("cleanupPdfScratch: a single file's removal failure logs but does not throw or stop cleanup", () => {
  // Given one prefixed entry that can't be removed as a plain file (a
  // subdirectory, which fs.rmSync without `recursive` refuses) alongside a
  // normal prefixed file that CAN be removed
  const dir = makeScratchDir();
  const originalError = console.error;
  const logged = [];
  console.error = (msg) => logged.push(msg);
  try {
    mkdirSync(join(dir, "cv-web-3.stuck-dir"));
    writeFileSync(join(dir, "cv-web-3.html"), "x");

    // When cleaning up report #3's scratch files
    assert.doesNotThrow(() => cleanupPdfScratch(dir, "cv-web-3."));

    // Then the failure is logged, the removable file is still gone, and the
    // unremovable directory is left behind rather than crashing the caller
    assert.equal(logged.length, 1);
    assert.match(logged[0], /pdf scratch cleanup: could not remove cv-web-3\.stuck-dir/);
    assert.deepEqual(readdirSync(dir), ["cv-web-3.stuck-dir"]);
  } finally {
    console.error = originalError;
    rmSync(dir, { recursive: true, force: true });
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

test("renderAndMarkPdf: render succeeds but mark-pdf-ready fails with a parseable error -> rendered with a specific warning", async () => {
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

test("renderAndMarkPdf: render succeeds but mark-pdf-ready fails with no parseable stdout -> rendered with the generic fallback warning", async () => {
  // Given generate-pdf.mjs succeeds but mark-pdf-ready.mjs crashes before printing any JSON
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "5");
  writeFileSync(pdfPaths.html, "<html></html>");
  writeFileSync(pdfPaths.meta, JSON.stringify({ format: "letter" }));
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0 },
    "mark-pdf-ready.mjs": { exitCode: 1, stderr: "unexpected crash" },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, reportNum: "5" });

    // Then the PDF is still reported rendered, with the generic fallback
    // warning (no mark.data.error to quote) rather than the crash text
    assert.equal(result.kind, "rendered");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /tracker's PDF column wasn't updated automatically/);
    assert.match(result.warnings[0], /node mark-pdf-ready\.mjs 5/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
