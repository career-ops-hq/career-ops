import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  pdfRunOutcome,
  writeCvPayload,
  spawnBuildCvHtml,
  resolveConfiguredCvTemplate,
  spawnGeneratePdf,
  markTrackerReady,
  cleanupPdfScratch,
  renderAndMarkPdf,
} from "../../src/lib/pdf-render.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Model a spawned child whose output and terminal event arrive asynchronously,
 * preserving the event order the production wrapper must handle.
 */
function fakeChild({ stdout = "", stderr = "", exitCode = 0, spawnError = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (spawnError) return child.emit("error", spawnError);
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", exitCode);
  });
  return child;
}

function makeRoot(profile = null) {
  const root = mkdtempSync(join(tmpdir(), "co-pdfrender-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "templates"), { recursive: true });
  writeFileSync(join(root, "templates", "cv-template.html"), "{{NAME}}{{EXPERIENCE}}{{EDUCATION}}");
  if (profile !== null) writeFileSync(join(root, "config", "profile.yml"), profile);
  return root;
}

function paths(root, num = "7") {
  const dir = join(root, ".career-ops-web", "pdf-tmp");
  mkdirSync(dir, { recursive: true });
  return {
    payload: join(dir, `cv-web-${num}.payload.json`),
    html: join(dir, `cv-web-${num}.html`),
    finalPdf: join(root, "output", "cv-jane-acme.pdf"),
  };
}

const PAYLOAD = { page_format: "a4", candidate: { name: "Jane" }, summary: "José — <safe>" };

test("pdfRunOutcome gates every signal before backend writes", () => {
  assert.deepEqual(pdfRunOutcome({ envelope: { ok: true }, noOutputMessage: null, sawError: false, cleanExit: true, hasPaths: true }), { ok: true });
  assert.deepEqual(
    pdfRunOutcome({ envelope: { ok: false, error: "bad payload" }, noOutputMessage: null, sawError: false, cleanExit: true, hasPaths: true }),
    { ok: false, message: "This run didn't produce a tailored CV to render, so no PDF was generated — re-run it to verify. (bad payload)" },
  );
  assert.deepEqual(
    pdfRunOutcome({ envelope: { ok: false, error: "parser reason" }, noOutputMessage: "agent exited without output", sawError: false, cleanExit: true, hasPaths: true }),
    { ok: false, message: "agent exited without output" },
  );
  assert.equal(pdfRunOutcome({ envelope: { ok: true }, noOutputMessage: null, sawError: true, cleanExit: true, hasPaths: true }).ok, false);
  assert.equal(pdfRunOutcome({ envelope: { ok: true }, noOutputMessage: null, sawError: false, cleanExit: false, hasPaths: true }).ok, false);
  assert.equal(pdfRunOutcome({ envelope: { ok: true }, noOutputMessage: null, sawError: false, cleanExit: true, hasPaths: false }).ok, false);
});

test("writeCvPayload truncates stale data and preserves Unicode", () => {
  const root = makeRoot();
  const pdfPaths = paths(root);
  try {
    writeFileSync(pdfPaths.payload, "x".repeat(1000));
    const result = writeCvPayload({ pdfPaths, payload: PAYLOAD, root });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(readFileSync(pdfPaths.payload, "utf8")), PAYLOAD);
    assert.ok(readFileSync(pdfPaths.payload, "utf8").length < 1000);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writeCvPayload rejects agent-controlled photo fields and trusts profile photo only", () => {
  const root = makeRoot('candidate:\n  photo: "assets/trusted.png"\n  photo_style: circle\n');
  const pdfPaths = paths(root);
  try {
    const payload = { ...PAYLOAD, candidate: { name: "Jane", photo: "/private/secret.png", photo_style: "square", photoStyle: "rounded" } };
    assert.equal(writeCvPayload({ pdfPaths, payload, root }).ok, true);
    const saved = JSON.parse(readFileSync(pdfPaths.payload, "utf8"));
    assert.equal(saved.candidate.photo, "assets/trusted.png");
    assert.equal(saved.candidate.photo_style, "circle");
    assert.equal(saved.candidate.photoStyle, undefined);
    assert.ok(!readFileSync(pdfPaths.payload, "utf8").includes("/private/secret.png"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writeCvPayload strips all agent photo fields when profile has none", () => {
  const root = makeRoot();
  const pdfPaths = paths(root);
  try {
    const payload = { ...PAYLOAD, candidate: { name: "Jane", photo: "/private/secret.png", photo_style: "circle", photoStyle: "rounded" } };
    assert.equal(writeCvPayload({ pdfPaths, payload, root }).ok, true);
    assert.equal(JSON.parse(readFileSync(pdfPaths.payload, "utf8")).candidate.photo, undefined);
    assert.equal(JSON.parse(readFileSync(pdfPaths.payload, "utf8")).candidate.photo_style, undefined);
    assert.equal(JSON.parse(readFileSync(pdfPaths.payload, "utf8")).candidate.photoStyle, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("writeCvPayload reports an unwritable target", () => {
  const root = makeRoot();
  try {
    const pdfPaths = { payload: join(root, "missing", "x.json") };
    const result = writeCvPayload({ pdfPaths, payload: PAYLOAD, root });
    assert.equal(result.ok, false);
    assert.match(result.error, /tailored CV payload/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("spawnBuildCvHtml invokes the canonical builder and drains output", async () => {
  const calls = [];
  const spawnFn = (execPath, args, opts) => {
    calls.push({ execPath, args, opts });
    return fakeChild({ stdout: "large report", stderr: "warning", exitCode: 0 });
  };
  const result = await spawnBuildCvHtml({ spawnFn, execPath: "node", root: "/root", payload: "/tmp/in.json", html: "/tmp/out.html", template: "/root/templates/cv-template.modern.html" });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "large report");
  assert.equal(result.stderr, "warning");
  assert.deepEqual(calls[0].args, ["/root/build-cv-html.mjs", "/tmp/in.json", "/tmp/out.html", "/root/templates/cv-template.modern.html"]);
  assert.equal(calls[0].opts.cwd, "/root");
});

test("spawnBuildCvHtml converts nonzero, emitted error, and synchronous throw to failures", async () => {
  const nonzero = await spawnBuildCvHtml({ spawnFn: () => fakeChild({ exitCode: 2, stderr: "missing candidate.name" }), execPath: "node", root: "/r", payload: "p", html: "h" });
  assert.equal(nonzero.ok, false);
  assert.match(nonzero.stderr, /candidate\.name/);
  const emitted = await spawnBuildCvHtml({ spawnFn: () => fakeChild({ spawnError: new Error("ENOENT") }), execPath: "node", root: "/r", payload: "p", html: "h" });
  assert.match(emitted.stderr, /failed to start: ENOENT/);
  const thrown = await spawnBuildCvHtml({ spawnFn: () => { throw new Error("EACCES"); }, execPath: "node", root: "/r", payload: "p", html: "h" });
  assert.match(thrown.stderr, /failed to start: EACCES/);
});

test("spawnBuildCvHtml times out and terminates a hung child", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const signals = [];
  let sawTerm;
  const termSent = new Promise((resolve) => { sawTerm = resolve; });
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGTERM") sawTerm();
    return true;
  };
  const resultPromise = spawnBuildCvHtml({
    spawnFn: () => child,
    execPath: "node", root: "/r", payload: "p", html: "h", timeoutMs: 5,
  });
  await termSent;
  let resolved = false;
  void resultPromise.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false, "timeout waits for the child close event before cleanup can begin");
  child.emit("close", null);
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.match(result.stderr, /timed out after 5ms/);
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("spawnBuildCvHtml escalates a timed-out child that ignores SIGTERM", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") queueMicrotask(() => child.emit("close", null));
    return true;
  };
  const result = await spawnBuildCvHtml({
    spawnFn: () => child,
    execPath: "node", root: "/r", payload: "p", html: "h", timeoutMs: 5,
  });
  assert.equal(result.ok, false);
  assert.match(result.stderr, /timed out after 5ms/);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("spawnBuildCvHtml does not treat a signal-delivery error as child exit", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const signals = [];
  let sawTerm;
  const termSent = new Promise((resolve) => { sawTerm = resolve; });
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGTERM") {
      queueMicrotask(() => child.emit("error", new Error("kill EPERM")));
      sawTerm();
    } else {
      queueMicrotask(() => child.emit("close", null));
    }
    return signal === "SIGKILL";
  };
  const resultPromise = spawnBuildCvHtml({
    spawnFn: () => child,
    execPath: "node", root: "/r", payload: "p", html: "h", timeoutMs: 5,
  });
  await termSent;
  await Promise.resolve();
  let resolved = false;
  void resultPromise.then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false, "signal error does not release scratch cleanup");
  const result = await resultPromise;
  assert.equal(result.ok, false);
  assert.match(result.stderr, /timed out after 5ms/);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("the web payload path delegates to the canonical builder and escapes text exactly once", async () => {
  const scratch = makeRoot();
  const pdfPaths = paths(scratch);
  const payload = {
    page_format: "a4",
    candidate: { name: "Zoë <Admin>" },
    summary: "R&D shipped <safe> systems — 東京",
    competencies: ["Node & browser automation"],
    skills: [{ category: "Languages", items: ["C++", "TypeScript"] }],
  };
  try {
    assert.equal(writeCvPayload({ pdfPaths, payload, root: scratch }).ok, true);
    const webBuild = await spawnBuildCvHtml({
      spawnFn: spawn, execPath: process.execPath, root: REPO_ROOT,
      payload: pdfPaths.payload, html: pdfPaths.html,
    });
    assert.equal(webBuild.ok, true, webBuild.stderr);
    const html = readFileSync(pdfPaths.html, "utf8");
    assert.match(html, /Zoë &lt;Admin&gt;/);
    assert.match(html, /R&amp;D shipped &lt;safe&gt; systems — 東京/);
    assert.doesNotMatch(html, /&amp;lt;safe&amp;gt;/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("spawnGeneratePdf passes canonical format and allow-reorder", async () => {
  const calls = [];
  const result = await spawnGeneratePdf({
    spawnFn: (execPath, args, opts) => { calls.push({ execPath, args, opts }); return fakeChild(); },
    execPath: "node", root: "/root", html: "/tmp/x.html", finalPdf: "/tmp/x.pdf", format: "letter", reportNum: "7",
  });
  assert.deepEqual(result, { ok: true, stderr: "" });
  assert.deepEqual(calls[0].args.slice(1), ["/tmp/x.html", "/tmp/x.pdf", "--format=letter", "--report=7", "--allow-reorder"]);
});

test("spawnGeneratePdf converts nonzero, emitted error, and synchronous throw to failures", async () => {
  const nonzero = await spawnGeneratePdf({ spawnFn: () => fakeChild({ exitCode: 1, stderr: "browser failed" }), execPath: "node", root: "/r", html: "h", finalPdf: "p", format: "a4", reportNum: "7" });
  assert.deepEqual(nonzero, { ok: false, stderr: "browser failed" });
  const emitted = await spawnGeneratePdf({ spawnFn: () => fakeChild({ spawnError: new Error("ENOENT") }), execPath: "node", root: "/r", html: "h", finalPdf: "p", format: "a4", reportNum: "7" });
  assert.match(emitted.stderr, /failed to start: ENOENT/);
  const thrown = await spawnGeneratePdf({ spawnFn: () => { throw new Error("EACCES"); }, execPath: "node", root: "/r", html: "h", finalPdf: "p", format: "a4", reportNum: "7" });
  assert.match(thrown.stderr, /failed to start: EACCES/);
});

test("markTrackerReady parses structured success and error output", async () => {
  const good = await markTrackerReady({ spawnFn: () => fakeChild({ stdout: '{"changed":true}' }), execPath: "node", root: "/r", reportNum: "7" });
  assert.equal(good.ok, true);
  assert.deepEqual(good.data, { changed: true });
  const bad = await markTrackerReady({ spawnFn: () => fakeChild({ stdout: '{"error":"row missing"}', exitCode: 2 }), execPath: "node", root: "/r", reportNum: "7" });
  assert.equal(bad.ok, false);
  assert.equal(bad.data.error, "row missing");
});

test("markTrackerReady preserves garbled output and converts child start failures", async () => {
  const garbled = await markTrackerReady({ spawnFn: () => fakeChild({ stdout: "not json", stderr: "crash", exitCode: 1 }), execPath: "node", root: "/r", reportNum: "7" });
  assert.deepEqual(garbled, { ok: false, data: null, stderr: "crash" });
  const emitted = await markTrackerReady({ spawnFn: () => fakeChild({ spawnError: new Error("ENOENT") }), execPath: "node", root: "/r", reportNum: "7" });
  assert.match(emitted.stderr, /failed to start: ENOENT/);
  const thrown = await markTrackerReady({ spawnFn: () => { throw new Error("EACCES"); }, execPath: "node", root: "/r", reportNum: "7" });
  assert.match(thrown.stderr, /failed to start: EACCES/);
});

test("cleanupPdfScratch removes only the current report prefix", () => {
  const root = makeRoot();
  const dir = join(root, "scratch");
  mkdirSync(dir);
  try {
    for (const name of ["cv-web-7.payload.json", "cv-web-7.html", "cv-web-8.html"]) writeFileSync(join(dir, name), "x");
    cleanupPdfScratch(dir, "cv-web-7.");
    assert.deepEqual(readdirSync(dir), ["cv-web-8.html"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("cleanupPdfScratch logs a missing directory instead of throwing", () => {
  const root = makeRoot();
  const logged = [];
  const original = console.error;
  console.error = (message) => logged.push(message);
  try {
    assert.doesNotThrow(() => cleanupPdfScratch(join(root, "missing"), "cv-web-7."));
    assert.equal(logged.length, 1);
    assert.match(logged[0], /could not list/);
  } finally { console.error = original; rmSync(root, { recursive: true, force: true }); }
});

test("cleanupPdfScratch continues after one matching entry cannot be removed", () => {
  const root = makeRoot();
  const dir = join(root, "scratch");
  mkdirSync(dir);
  mkdirSync(join(dir, "cv-web-7.stuck"));
  writeFileSync(join(dir, "cv-web-7.html"), "x");
  const logged = [];
  const original = console.error;
  console.error = (message) => logged.push(message);
  try {
    assert.doesNotThrow(() => cleanupPdfScratch(dir, "cv-web-7."));
    assert.deepEqual(readdirSync(dir), ["cv-web-7.stuck"]);
    assert.match(logged[0], /could not remove cv-web-7\.stuck/);
  } finally { console.error = original; rmSync(root, { recursive: true, force: true }); }
});

/**
 * Route script launches to configured fake results while recording their order;
 * template resolution gets the normal fixture path when no override is supplied.
 */
function router(routes, calls) {
  return (execPath, args, opts) => {
    const script = args[0].split("/").pop();
    calls.push(script);
    const fallback = script === "cv-templates.mjs"
      ? { stdout: `${join(opts.cwd, "templates", "cv-template.html")}\n` }
      : {};
    return fakeChild(routes[script] ?? fallback);
  };
}

test("resolveConfiguredCvTemplate delegates to the canonical resolver", async () => {
  const calls = [];
  const result = await resolveConfiguredCvTemplate({
    spawnFn: (execPath, args, opts) => {
      calls.push({ execPath, args, opts });
      return fakeChild({ stdout: "/repo/templates/cv-template.modern.html\n" });
    },
    execPath: "node", root: "/repo",
  });
  assert.deepEqual(result, { ok: true, template: "/repo/templates/cv-template.modern.html", stderr: "" });
  assert.deepEqual(calls[0].args, ["/repo/cv-templates.mjs", "resolve", "cv"]);
  assert.equal(calls[0].opts.cwd, "/repo");
});

test("renderAndMarkPdf runs write → build → render → mark and cleans scratch", async () => {
  const root = makeRoot();
  const pdfPaths = paths(root);
  const calls = [];
  try {
    writeFileSync(pdfPaths.html, "stale html");
    const result = await renderAndMarkPdf({
      spawnFn: router({ "mark-pdf-ready.mjs": { stdout: '{"changed":true}' } }, calls),
      execPath: "node", root, pdfPaths, payload: PAYLOAD, format: "a4", reportNum: "7",
    });
    assert.equal(result.kind, "rendered");
    assert.deepEqual(calls, ["cv-templates.mjs", "build-cv-html.mjs", "generate-pdf.mjs", "mark-pdf-ready.mjs"]);
    assert.equal(existsSync(pdfPaths.payload), false);
    assert.equal(existsSync(pdfPaths.html), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("renderAndMarkPdf honors the profile-selected CV template", async () => {
  const root = makeRoot("cv:\n  template: modern\n");
  const pdfPaths = paths(root);
  writeFileSync(join(root, "templates", "cv-template.modern.html"), "{{NAME}}{{EXPERIENCE}}{{EDUCATION}}");
  const calls = [];
  try {
    const result = await renderAndMarkPdf({
      spawnFn: (execPath, args, opts) => {
        calls.push({ execPath, args, opts });
        if (args[0].endsWith("cv-templates.mjs")) {
          return fakeChild({ stdout: `${join(root, "templates", "cv-template.modern.html")}\n` });
        }
        return fakeChild(args[0].endsWith("mark-pdf-ready.mjs") ? { stdout: '{"changed":true}' } : {});
      },
      execPath: "node", root, pdfPaths, payload: PAYLOAD, format: "a4", reportNum: "7",
    });
    assert.equal(result.kind, "rendered");
    assert.equal(calls[1].args[3], join(root, "templates", "cv-template.modern.html"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an unknown configured CV template fails before build, render, or mark", async () => {
  const root = makeRoot("cv:\n  template: missing\n");
  const pdfPaths = paths(root);
  const calls = [];
  try {
    const result = await renderAndMarkPdf({
      spawnFn: router({ "cv-templates.mjs": { exitCode: 1, stderr: "Template not found for kind=cv name=missing" } }, calls),
      execPath: "node", root, pdfPaths, payload: PAYLOAD, format: "a4", reportNum: "7",
    });
    assert.equal(result.kind, "build-failed");
    assert.match(result.error, /configured CV template.*not found/i);
    assert.deepEqual(calls, ["cv-templates.mjs"]);
    assert.equal(existsSync(pdfPaths.payload), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("builder failure prevents render and mark, surfaces stderr, and cleans", async () => {
  const root = makeRoot();
  const pdfPaths = paths(root);
  const calls = [];
  try {
    const result = await renderAndMarkPdf({
      spawnFn: router({ "build-cv-html.mjs": { exitCode: 1, stderr: "candidate.name is required" } }, calls),
      execPath: "node", root, pdfPaths, payload: PAYLOAD, format: "a4", reportNum: "7",
    });
    assert.equal(result.kind, "build-failed");
    assert.match(result.error, /candidate\.name/);
    assert.deepEqual(calls, ["cv-templates.mjs", "build-cv-html.mjs"]);
    assert.equal(existsSync(pdfPaths.payload), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("render failure prevents mark and still cleans", async () => {
  const root = makeRoot();
  const pdfPaths = paths(root);
  const calls = [];
  try {
    writeFileSync(pdfPaths.html, "stale html");
    const result = await renderAndMarkPdf({
      spawnFn: router({ "generate-pdf.mjs": { exitCode: 1, stderr: "browser failed" } }, calls),
      execPath: "node", root, pdfPaths, payload: PAYLOAD, format: "a4", reportNum: "7",
    });
    assert.equal(result.kind, "render-failed");
    assert.match(result.error, /browser failed/);
    assert.deepEqual(calls, ["cv-templates.mjs", "build-cv-html.mjs", "generate-pdf.mjs"]);
    assert.equal(existsSync(pdfPaths.payload), false);
    assert.equal(existsSync(pdfPaths.html), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("mark failure keeps successful PDF result but returns a warning", async () => {
  const root = makeRoot();
  const pdfPaths = paths(root);
  const calls = [];
  const original = console.error;
  console.error = () => {};
  try {
    const result = await renderAndMarkPdf({
      spawnFn: router({ "mark-pdf-ready.mjs": { exitCode: 2, stdout: '{"error":"row missing"}' } }, calls),
      execPath: "node", root, pdfPaths, payload: PAYLOAD, format: "a4", reportNum: "7",
    });
    assert.equal(result.kind, "rendered");
    assert.match(result.warnings[0], /row missing/);
  } finally { console.error = original; rmSync(root, { recursive: true, force: true }); }
});
