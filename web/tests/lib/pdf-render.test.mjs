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
import { StringDecoder } from "node:string_decoder";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  pdfRunOutcome,
  writeCvHtml,
  spawnGeneratePdf,
  markTrackerReady,
  cleanupPdfScratch,
  renderAndMarkPdf,
  failureReason,
} from "../../src/lib/pdf-render.mjs";

// A fake stdio stream: emits raw Buffers, or decoded strings once the code
// under test calls setEncoding() — the same contract a real child's stream
// has, so a chunk boundary inside a multibyte character can be reproduced.
function fakeStream() {
  const stream = new EventEmitter();
  let decoder = null;
  stream.setEncoding = (enc) => { decoder = new StringDecoder(enc); };
  stream.push = (buf) => { stream.emit("data", decoder ? decoder.write(buf) : buf); };
  return stream;
}

// A fake child_process.spawn() result: stdout/stderr emit "data" (once, or
// per entry of `stderrChunks`), then the child emits "close" (or "error"
// instead, for a spawn failure) on the next microtask — close enough to the
// real async timing for these tests. `writes` is a file the fake "renderer"
// creates before closing, the way generate-pdf.mjs leaves a PDF at the final
// path; a route without it stands in for a render that wrote nothing there.
//
// Each write also moves the file's mtime to a time of its own. The fake writes
// the same bytes in place, so inode and size never change between two renders,
// and on Windows two writes inside one filesystem clock tick would share an
// mtime too: `pdfFingerprint` would see no change and a replaced PDF would read
// as kept (#6668). A real render takes seconds, so its mtime always moves.
let fakeRenderMtime = 1_700_000_000;
function fakeChild({ stdout = "", stderr = "", stderrChunks = null, exitCode = 0, spawnError = null, writes = null } = {}) {
  const child = new EventEmitter();
  child.stdout = fakeStream();
  child.stderr = fakeStream();
  queueMicrotask(() => {
    if (spawnError) {
      child.emit("error", spawnError);
      return;
    }
    if (stdout) child.stdout.push(Buffer.from(stdout));
    if (stderrChunks) for (const chunk of stderrChunks) child.stderr.push(chunk);
    else if (stderr) child.stderr.push(Buffer.from(stderr));
    if (writes) {
      writeFileSync(writes, "%PDF-fake");
      fakeRenderMtime += 10;
      utimesSync(writes, fakeRenderMtime, fakeRenderMtime);
    }
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
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", coreRoot: "/root", html: "/root/x.html", finalPdf: "/root/output/x.pdf", format: "letter", reportNum: "018" });

  // Then it reports ok:true (nothing landed at the final path, so not
  // delivered) and invoked generate-pdf.mjs with the expected args
  assert.deepEqual(result, { ok: true, delivered: false, stderr: "" });
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[0], /generate-pdf\.mjs$/);
  assert.deepEqual(calls[0].args.slice(1), ["/root/x.html", "/root/output/x.pdf", "--format=letter", "--report=018", "--allow-reorder"]);
  assert.equal(calls[0].opts.cwd, "/root");
  // No console to inherit: a stale one kills the child on Windows (#3809)
  assert.equal(calls[0].opts.windowsHide, true);
  assert.equal(calls[0].opts.env.CAREER_OPS_PDF_SHARED, "1");
});

test("spawnGeneratePdf: non-zero exit -> ok:false, stderr surfaced", async () => {
  // Given generate-pdf.mjs will exit non-zero with a stderr message
  const spawnFn = () => fakeChild({ exitCode: 1, stderr: "section order guard failed" });

  // When spawning the render
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", coreRoot: "/root", html: "x.html", finalPdf: "x.pdf", format: "a4", reportNum: "1" });

  // Then it reports ok:false with that stderr
  assert.deepEqual(result, { ok: false, delivered: false, stderr: "section order guard failed" });
});

test("spawnGeneratePdf: spawn error -> ok:false, descriptive stderr", async () => {
  // Given the child process itself fails to spawn (e.g. missing binary)
  const spawnFn = () => fakeChild({ spawnError: new Error("ENOENT") });

  // When spawning the render
  const result = await spawnGeneratePdf({ spawnFn, execPath: "node", coreRoot: "/root", html: "x.html", finalPdf: "x.pdf", format: "letter", reportNum: "1" });

  // Then it reports ok:false with a descriptive message, not a raw crash
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.match(result.stderr, /PDF rendering failed to start: ENOENT/);
});

test("spawnGeneratePdf: delivered is the PDF landing at the final path, not the exit code", async () => {
  // Given a final path with and without a previous PDF, and renders that do
  // or do not write there (#6377): a warn-only overflow exits 0 and leaves the
  // path as it was, a delivered render always puts a new file there.
  const dir = makeScratchDir();
  const finalPdf = join(dir, "x.pdf");
  const run = (route) => spawnGeneratePdf({ spawnFn: () => fakeChild(route), execPath: "node", coreRoot: "/root", html: join(dir, "x.html"), finalPdf, format: "letter", reportNum: "1" });
  try {
    // When the render writes the PDF where none was
    assert.equal((await run({ exitCode: 0, writes: finalPdf })).delivered, true, "a new PDF is delivered");
    // When a later render exits 0 and keeps the previous PDF in place
    assert.equal((await run({ exitCode: 0 })).delivered, false, "a kept previous PDF is not this render's");
    // When the render replaces the previous PDF
    assert.equal((await run({ exitCode: 0, writes: finalPdf })).delivered, true, "a replaced PDF is delivered");
    // When the render fails after writing (a non-zero exit never delivers)
    assert.equal((await run({ exitCode: 1, writes: finalPdf })).delivered, false, "a failed exit is never delivered");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── markTrackerReady ──

test("markTrackerReady: clean exit with JSON stdout -> ok:true, data parsed", async () => {
  // Given mark-pdf-ready.mjs succeeds and prints a --json payload
  const stdout = JSON.stringify({ changed: true, num: 5, company: "Acme" });
  const calls = [];
  const spawnFn = (execPath, args, opts) => { calls.push({ execPath, args, opts }); return fakeChild({ exitCode: 0, stdout }); };

  // When marking the tracker ready
  const result = await markTrackerReady({ spawnFn, execPath: "node", coreRoot: "/root", reportNum: "5" });

  // Then it reports ok:true with the parsed payload
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.deepEqual(result.data, { changed: true, num: 5, company: "Acme" });
  // and launched without a console to inherit (#3809)
  assert.equal(calls[0].opts.windowsHide, true);
});

test("markTrackerReady: failure exit with parseable --json error -> data.error available", async () => {
  // Given mark-pdf-ready.mjs fails but still prints a structured --json error
  const stdout = JSON.stringify({ error: "No tracker row links report #5", code: "not-found" });
  const spawnFn = () => fakeChild({ exitCode: 2, stdout });

  // When marking the tracker ready
  const result = await markTrackerReady({ spawnFn, execPath: "node", coreRoot: "/root", reportNum: "5" });

  // Then it reports ok:false with the specific error available for callers to surface
  assert.equal(result.ok, false);
  assert.equal(result.code, 2);
  assert.equal(result.data?.error, "No tracker row links report #5");
});

test("markTrackerReady: failure exit with no/garbled stdout -> data:null, raw stderr kept", async () => {
  // Given mark-pdf-ready.mjs crashes before printing any JSON
  const spawnFn = () => fakeChild({ exitCode: 1, stderr: "unexpected crash" });

  // When marking the tracker ready
  const result = await markTrackerReady({ spawnFn, execPath: "node", coreRoot: "/root", reportNum: "5" });

  // Then it reports ok:false with data:null, falling back to the raw stderr
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.equal(result.stderr, "unexpected crash");
});

test("markTrackerReady: spawn error -> ok:false, descriptive stderr", async () => {
  // Given the child process itself fails to spawn
  const spawnFn = () => fakeChild({ spawnError: new Error("EACCES") });

  // When marking the tracker ready
  const result = await markTrackerReady({ spawnFn, execPath: "node", coreRoot: "/root", reportNum: "5" });

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
  mkdirSync(join(dir, "output"), { recursive: true });
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
    "generate-pdf.mjs": { exitCode: 0, writes: pdfPaths.finalPdf },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "a4", reportNum: "1" });

    // Then it reports rendered with no warnings, and scratch is cleaned up
    assert.deepEqual(result, { kind: "rendered", warnings: [] });
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("cv-web-1.")), []);
    assert.equal(readFileSync(join(dir, "output", "cv-jane-acme-2026-07-26.html"), "utf8"), "<html></html>", "the CV Studio's source HTML is kept beside the PDF");
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
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "3" });

    // Then it reports render-failed with the render's stderr, never calls mark-pdf-ready, and still cleans scratch
    assert.deepEqual(result, { kind: "render-failed", error: "Refusing to write the PDF outside the project directory" });
    assert.equal(calls.length, 1);
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("cv-web-3.")), []);
    assert.deepEqual(readdirSync(join(dir, "output")), [], "a failed render keeps no HTML");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: generate-pdf.mjs exits 0 over a warn-only page budget -> render-failed, nothing kept or marked", async () => {
  // Given generate-pdf.mjs exits 0 but kept the render as a sibling draft
  // because it ran over the page budget (#6377): it names the draft on stderr
  // and wrote nothing to the final path, so there is no PDF to deliver.
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "6");
  writeFileSync(pdfPaths.html, "<html></html>");
  // A second overflow takes the next free name, so the error must name the
  // draft this render wrote, not the ".overflow.pdf" pattern.
  const draftPath = pdfPaths.finalPdf.replace(/\.pdf$/, ".overflow-2.pdf");
  const stderr = [
    "⚠️  CV is 2 pages; the allowed maximum is 1 page. Trim lower-priority bullets, older roles, secondary projects, or the competencies strip, then regenerate. Overflow is warning-only by default; use --strict-pages to reject it.",
    `⚠️  Overflow draft: ${draftPath} (nothing was written to the output path). Trim and rerun to write ${pdfPaths.finalPdf}.`,
  ].join("\n");
  const { spawnFn, calls } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0, stderr },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    // When rendering
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "6" });

    // Then it is reported like a failed render. The route shows only the first
    // 200 characters of the error, so the page counts and "no PDF was written"
    // must fit there, ahead of any advice. mark-pdf-ready is never invoked, and
    // no HTML is kept beside a PDF that does not exist
    assert.equal(result.kind, "render-failed");
    assert.match(result.error, /^CV is 2 pages; the allowed maximum is 1 page\./);
    assert.match(result.error, /No PDF was written/);
    assert.ok(result.error.includes("cv-jane-acme-2026-07-26.overflow-2.pdf"), `error must name the draft this render wrote, got: ${result.error}`);
    assert.ok(!result.error.includes(dir), "the error names the file, not the full path");
    assert.ok(result.error.length <= 200, `error must survive the route's 200-char cut, got ${result.error.length}`);
    assert.equal(calls.length, 1, "mark-pdf-ready.mjs must not run for a PDF that was never written");
    assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("cv-web-6.")), []);
    assert.deepEqual(readdirSync(join(dir, "output")), [], "an overflow draft keeps no HTML");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: a warn-only overflow over an existing PDF leaves it in place and is still not delivered", async () => {
  // Given a previous good PDF at the final path, and a render that ran over
  // the budget: generate-pdf.mjs keeps the previous PDF byte for byte and
  // writes the draft beside it. The old file still being there must not read
  // as "this render delivered a PDF".
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "8");
  writeFileSync(pdfPaths.html, "<html></html>");
  writeFileSync(pdfPaths.finalPdf, "PREVIOUS GOOD PDF");
  const stderr = [
    "⚠️  CV is 2 pages; the allowed maximum is 1 page. Trim lower-priority bullets, older roles, secondary projects, or the competencies strip, then regenerate. Overflow is warning-only by default; use --strict-pages to reject it.",
    `⚠️  Overflow draft: ${pdfPaths.finalPdf.replace(/\.pdf$/, ".overflow.pdf")} (the existing PDF at the output path was left unchanged). Trim and rerun to write ${pdfPaths.finalPdf}.`,
  ].join("\n");
  const { spawnFn, calls } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0, stderr },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "8" });

    assert.equal(result.kind, "render-failed");
    assert.match(result.error, /^CV is 2 pages; the allowed maximum is 1 page\. No PDF was written/);
    assert.ok(result.error.includes("cv-jane-acme-2026-07-26.overflow.pdf"), result.error);
    assert.equal(calls.length, 1, "mark-pdf-ready.mjs must not run");
    assert.equal(readFileSync(pdfPaths.finalPdf, "utf8"), "PREVIOUS GOOD PDF", "the previous PDF is untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: a stderr chunk boundary inside a multibyte character still yields the overflow error with the draft named intact", async () => {
  // Given the overflow warning arrives in two chunks, split inside a
  // multibyte character of the draft's own name (the warnings also open with
  // the multibyte ⚠️, so any boundary can land this way). Decoding each chunk
  // on its own would turn the split bytes into U+FFFD and misname the draft;
  // delivery is decided from the file either way.
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "9");
  writeFileSync(pdfPaths.html, "<html></html>");
  const draftPath = join(dir, "output", "cv-josé-acme-2026-07-26.overflow.pdf");
  const text = [
    "⚠️  CV is 2 pages; the allowed maximum is 1 page. Trim lower-priority bullets, older roles, secondary projects, or the competencies strip, then regenerate. Overflow is warning-only by default; use --strict-pages to reject it.",
    `⚠️  Overflow draft: ${draftPath} (nothing was written to the output path). Trim and rerun to write ${pdfPaths.finalPdf}.`,
  ].join("\n");
  const bytes = Buffer.from(text);
  const accent = bytes.indexOf(Buffer.from("é"));
  const cut = accent + 1; // between the two bytes of é
  assert.ok(accent > 0 && cut < bytes.length);
  const { spawnFn, calls } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0, stderrChunks: [bytes.subarray(0, cut), bytes.subarray(cut)] },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "9" });

    assert.equal(result.kind, "render-failed");
    assert.ok(result.error.includes("cv-josé-acme-2026-07-26.overflow.pdf"), `draft name broken across the chunk boundary: ${result.error}`);
    assert.ok(!result.error.includes("�"), "no replacement character in the error");
    assert.equal(calls.length, 1, "mark-pdf-ready.mjs must not run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: a ' (' inside a directory on the draft's path does not truncate the draft's name", async () => {
  // Given a data root like "Job (2026)": the draft line reads
  // "Overflow draft: /…/Job (2026)/output/cv….overflow.pdf (nothing was …",
  // and a capture that stopped at the first " (" would name the directory.
  const dir = join(makeScratchDir(), "Job (2026)");
  mkdirSync(join(dir, "output"), { recursive: true });
  const pdfPaths = makePdfPaths(dir, "11");
  writeFileSync(pdfPaths.html, "<html></html>");
  const draftPath = pdfPaths.finalPdf.replace(/\.pdf$/, ".overflow.pdf");
  const stderr = `⚠️  CV is 2 pages; the allowed maximum is 1 page. Trim it.\n⚠️  Overflow draft: ${draftPath} (nothing was written to the output path). Trim and rerun to write ${pdfPaths.finalPdf}.`;
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0, stderr },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: "{}" },
  });
  try {
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "11" });

    assert.equal(result.kind, "render-failed");
    assert.ok(result.error.includes("the over-budget draft is cv-jane-acme-2026-07-26.overflow.pdf"), result.error);
  } finally {
    rmSync(join(dir, ".."), { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: exit 0 with no PDF and nothing on stderr -> render-failed that says so, not a guessed page budget", async () => {
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "10");
  writeFileSync(pdfPaths.html, "<html></html>");
  const { spawnFn, calls } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0, stderr: "" },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "10" });

    assert.equal(result.kind, "render-failed");
    assert.match(result.error, /reported success but wrote nothing to cv-jane-acme-2026-07-26\.pdf/);
    assert.equal(calls.length, 1, "mark-pdf-ready.mjs must not run");
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
    "generate-pdf.mjs": { exitCode: 0, writes: pdfPaths.finalPdf },
    "mark-pdf-ready.mjs": { exitCode: 2, stdout: JSON.stringify({ error: "No tracker row links report #4", code: "not-found" }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "4" });

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
    "generate-pdf.mjs": { exitCode: 0, writes: pdfPaths.finalPdf },
    "mark-pdf-ready.mjs": { exitCode: 1, stderr: "unexpected crash" },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "5" });

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

test("renderAndMarkPdf: successful render with stderr -> that stderr is surfaced as warnings", async () => {
  // Given generate-pdf.mjs exits cleanly but wrote advisories to stderr — the
  // page-budget overflow and the CV fact check both warn on that channel
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "6");
  writeFileSync(pdfPaths.html, "<html></html>");
  const stderr = [
    "\u26a0\ufe0f  CV is 3 pages; the allowed maximum is 2 pages.",
    "\u26a0\ufe0f  CV fact check warning: cv-web-6.html",
    "  - advisory phrase: world-class",
  ].join("\n");
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0, stderr, writes: pdfPaths.finalPdf },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "6" });

    // Then the PDF is reported rendered and every stderr line reaches the caller,
    // one warning per line, rather than being collected and dropped
    assert.equal(result.kind, "rendered");
    assert.equal(result.warnings.length, 3);
    assert.match(result.warnings[0], /CV is 3 pages/);
    assert.match(result.warnings[1], /fact check warning/);
    assert.match(result.warnings[2], /advisory phrase: world-class/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderAndMarkPdf: successful render with empty stderr -> no warnings invented", async () => {
  // Given generate-pdf.mjs exits cleanly having written nothing to stderr
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "7");
  writeFileSync(pdfPaths.html, "<html></html>");
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 0, stderr: "", writes: pdfPaths.finalPdf },
    "mark-pdf-ready.mjs": { exitCode: 0, stdout: JSON.stringify({ changed: true }) },
  });
  try {
    // When rendering and marking
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "7" });

    // Then a clean run still reports zero warnings — blank lines must not
    // become empty warnings the user has to read past
    assert.deepEqual(result, { kind: "rendered", warnings: [] });
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

test("failureReason: keeps the failing line, drops the advisories printed before it", () => {
  // Given stderr where a voice-check warning precedes the real failure
  const stderr = [
    "\u26a0\ufe0f  Voice check warning for cv-web-423.html: an en dash. The build continues.",
    "\u274c PDF generation failed: Fact check failed for cv-web-423.html: non-metric facts absent from sources: employer=X",
  ].join("\n");

  // Then only the failure line is reported
  assert.equal(
    failureReason(stderr),
    "\u274c PDF generation failed: Fact check failed for cv-web-423.html: non-metric facts absent from sources: employer=X",
  );
});

test("failureReason: keeps the detail lines that follow the failure header", () => {
  const stderr = [
    "⚠️  Voice check warning for cv-web-423.html: an en dash. The build continues.",
    "❌ PDF generation failed: Locked section 'education' was modified during tailoring.",
    "Expected (normalized): bs computer science",
    "Found (normalized): phd computer science",
  ].join("\n");

  assert.equal(
    failureReason(stderr),
    [
      "❌ PDF generation failed: Locked section 'education' was modified during tailoring.",
      "Expected (normalized): bs computer science",
      "Found (normalized): phd computer science",
    ].join("\n"),
  );
});

test("renderAndMarkPdf: a failed render with advisories before the failure surfaces only the failure", async () => {
  // Reverting the caller to `error: render.stderr` must fail this test, which the
  // direct failureReason tests above cannot catch.
  const dir = makeScratchDir();
  const pdfPaths = makePdfPaths(dir, "423");
  writeFileSync(pdfPaths.html, "<html></html>");
  const failure = "❌ PDF generation failed: Fact check failed for cv-web-423.html: non-metric facts absent from sources: employer=X";
  const stderr = [
    "⚠️  Voice check warning for cv-web-423.html: an en dash. The build continues.",
    failure,
  ].join("\n");
  const { spawnFn } = makeRouterSpawn({
    "generate-pdf.mjs": { exitCode: 1, stderr },
    "mark-pdf-ready.mjs": { exitCode: 0 },
  });
  try {
    const result = await renderAndMarkPdf({ spawnFn, execPath: "node", coreRoot: "/root", pdfPaths, format: "letter", reportNum: "423" });
    assert.deepEqual(result, { kind: "render-failed", error: failure });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failureReason: no failure marker -> whole stderr; empty -> generic message", () => {
  assert.equal(failureReason("boom"), "boom");
  assert.equal(failureReason(""), "PDF rendering failed.");
});

