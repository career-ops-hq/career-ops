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
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  pdfRunOutcome,
  writeCvHtml,
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
    writeFileSync(join(dir, "cv-web-7.payload.json"), "{}"); // a backend/generate-pdf.mjs leftover
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
  const parent = makeScratchDir();
  const dir = join(parent, "does-not-exist");
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
    // The mkdtemp parent is real even though the child isn't — without this the
    // suite leaves a co-pdfrender-* directory behind on every run.
    rmSync(parent, { recursive: true, force: true });
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
    finalPdf: join(dir, "output", `cv-jane-acme-2026-07-26.pdf`),
  };
}

test("renderAndMarkPdf: happy path -> rendered with no warnings, scratch cleaned up", async () => {
  // Given both scripts succeeding
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "1");
  writeFileSync(pdfPaths.html, "<html></html>");
  const { spawnFn, calls } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0 },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, format: "a4", reportNum: "1" });

    // Then it reports rendered with no warnings, and scratch is cleaned up
    assert.deepEqual(result, { kind: "rendered", warnings: [] });
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("cv-web-1.")), []);
    // ...and the format actually reached generate-pdf.mjs. The argv was only
    // inspected on the failure path, so a hardcoded or defaulted format would pass
    // while every US/Canada CV rendered on the wrong page size.
    const renderCall = calls.find((c) => c.args.some((a) => String(a).includes("generate-pdf.mjs")));
    assert.ok(renderCall, "generate-pdf.mjs was never spawned");
    assert.ok(renderCall.args.includes("--format=a4"), `expected --format=a4, got ${renderCall.args.join(" ")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: generate-pdf.mjs fails -> render-failed, mark-pdf-ready never invoked, scratch still cleaned up", async () => {
  // Given generate-pdf.mjs exits non-zero
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "3");
  writeFileSync(pdfPaths.html, "<html></html>");
  const { spawnFn, calls } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 1, stderr: "Refusing to write the PDF outside the project directory" },
    "mark-pdf-ready.mjs": { exitCode: 0 },
  });
  try {
    // When rendering
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, format: "letter", reportNum: "3" });

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
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0 },
    "mark-pdf-ready.mjs": { exitCode: 2, stdout: JSON.stringify({ error: "No tracker row links report #4", code: "not-found" }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, format: "letter", reportNum: "4" });

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
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0 },
    "mark-pdf-ready.mjs": { exitCode: 1, stderr: "unexpected crash" },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", root: "/root", pdfPaths, format: "letter", reportNum: "5" });

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

// ── writeCvHtml (#2185) ──
//
// The agent no longer writes the tailored CV — it emits it through the
// <<cv-html>> envelope and the backend persists it here. These cases guard the
// handover: the bytes must land verbatim, and a failed write must be reported
// rather than swallowed — a silent failure would render a stale or missing file.

test("writeCvHtml: writes the html verbatim", () => {
  // Given a tailored document with characters a re-encode would mangle
  const dir = makeScratchDir();
  const html = '<!DOCTYPE html>\n<html><head><style>a>b{content:"<<"}</style></head><body>José — 5 &lt; 10</body></html>';
  const paths = { html: join(dir, "cv-web-018.html"), finalPdf: join(dir, "out.pdf") };
  try {
    // When persisting the parsed envelope
    const result = writeCvHtml({ pdfPaths: paths, html });

    // Then the file lands byte-exact. The page format is NOT written here — it
    // goes straight to renderAndMarkPdf, so there is no sidecar to keep in sync.
    assert.equal(result.ok, true);
    assert.equal(readFileSync(paths.html, "utf8"), html);
    assert.deepEqual(readdirSync(dir), ["cv-web-018.html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeCvHtml: an unwritable target reports failure instead of continuing", () => {
  // Given an html path whose parent directory does not exist
  const dir = makeScratchDir();
  const paths = {
    html: join(dir, "no-such-dir", "cv.html"),
    finalPdf: join(dir, "out.pdf"),
  };
  try {
    // When persisting
    const result = writeCvHtml({ pdfPaths: paths, html: "<html></html>" });

    // Then it fails fast and says why — the caller must not go on to render
    assert.equal(result.ok, false);
    assert.match(result.error, /cv\.html/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeCvHtml: an error carrying no path still names a file", () => {
  // Given a write that fails with a non-fs error — no `.path` property (e.g. an
  // oversized-content RangeError). Without the fallback the user is told the CV
  // could not be saved to "undefined".
  const dir = makeScratchDir();
  const paths = { html: join(dir, "cv.html"), finalPdf: join(dir, "out.pdf") };
  try {
    // When persisting a value writeFileSync refuses to serialize
    const result = writeCvHtml({ pdfPaths: paths, html: { not: "a string" } });

    // Then it fails naming the intended file rather than `undefined`
    assert.equal(result.ok, false);
    assert.ok(!result.error.includes("undefined"), `error names no file: ${result.error}`);
    assert.match(result.error, /cv\.html/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── pdfRunOutcome (#2185) ──
//
// The honesty gate. It decides both whether anything is written and whether the
// run is reported as success, so it must never call a run good on thin evidence.

const OK_ENVELOPE = { ok: true, html: "<html></html>", format: "a4", warnings: [] };
const GOOD = { envelope: OK_ENVELOPE, noOutputMessage: null, sawError: false, cleanExit: true, hasPaths: true };

test("pdfRunOutcome: a clean run with a parsed envelope is the only success", () => {
  // Given every signal healthy
  // Then the run proceeds to write and render
  assert.deepEqual(pdfRunOutcome(GOOD), { ok: true });
});

test("pdfRunOutcome: each degraded signal on its own blocks the render", () => {
  // Given one thing wrong at a time — no single failure may be shrugged off
  const degraded = {
    "unparsed envelope": { envelope: { ok: false, error: "never closed" } },
    "missing envelope": { envelope: undefined },
    "dirty exit": { cleanExit: false },
    "stderr error": { sawError: true },
    "no scratch paths": { hasPaths: false },
  };
  for (const [label, override] of Object.entries(degraded)) {
    // When deciding the outcome
    const outcome = pdfRunOutcome({ ...GOOD, ...override });

    // Then it fails with a message, never silently
    assert.equal(outcome.ok, false, `${label} must block the render`);
    assert.ok(outcome.message.length > 0, `${label} must explain itself`);
  }
});

test("pdfRunOutcome: the parser's reason is surfaced, not swallowed", () => {
  // Given the envelope failed for a specific, actionable reason
  const outcome = pdfRunOutcome({ ...GOOD, envelope: { ok: false, error: "the envelope was never closed" } });

  // Then that reason reaches the user — "never closed" and "no envelope at all"
  // are different bugs and the difference is what tells them what to do
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /never closed/);
});

test("pdfRunOutcome: the route's no-output verdict wins over the generic message", () => {
  // Given the caller already decided the CLI produced nothing usable. That is a
  // transport question, so the route owns the wording and passes it in — this
  // module must not carry a second copy of those strings.
  const outcome = pdfRunOutcome({
    ...GOOD,
    envelope: undefined,
    noOutputMessage: "The CLI produced no output — is it installed and authenticated?",
  });

  // Then that message is surfaced verbatim, not replaced by "didn't produce a CV",
  // because "nothing ran" and "ran but fell short" need different advice
  assert.equal(outcome.ok, false);
  assert.match(outcome.message, /installed and authenticated/);
});

test("pdfRunOutcome: a no-output verdict outranks an otherwise healthy envelope", () => {
  // Given contradictory signals — a parsed envelope but the route saw no output
  const outcome = pdfRunOutcome({ ...GOOD, noOutputMessage: "nothing came back" });

  // Then it fails closed rather than rendering on the strength of the envelope
  assert.equal(outcome.ok, false);
  assert.equal(outcome.message, "nothing came back");
});

test("writeCvHtml: a shorter re-render leaves no trailing bytes", () => {
  // Given the same report rendered twice, the second CV shorter than the first.
  // route.ts clears no stale scratch file because this function is documented to
  // rewrite the HTML before any render — a claim that rests entirely on
  // writeFileSync truncating. Switch to an append flag, or to a write-then-rename
  // helper, and every other test here stays green while the renderer reads the tail
  // of a previous run's CV.
  const dir = makeScratchDir();
  const paths = { html: join(dir, "cv-web-018.html"), finalPdf: join(dir, "out.pdf") };
  const long = `<!DOCTYPE html><html><body>${"X".repeat(4000)}</body></html>`;
  const short = "<!DOCTYPE html><html><body>short</body></html>";
  try {
    // When the long document is written and then the short one to the same path
    assert.equal(writeCvHtml({ pdfPaths: paths, html: long }).ok, true);
    assert.equal(writeCvHtml({ pdfPaths: paths, html: short }).ok, true);

    // Then the file is exactly the short document, with nothing left over
    const onDisk = readFileSync(paths.html, "utf8");
    assert.equal(onDisk, short);
    assert.ok(!onDisk.includes("XXXX"), "trailing bytes from the earlier write survived");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
