/**
 * pdf-render.mjs — render a tailored CV to PDF and mark the tracker (#2172).
 *
 * Plain .mjs (same pattern as pdf-paths.mjs / clean-chips.mjs) so this can be
 * unit-tested with `node --test`, no TypeScript build step. `spawnFn`,
 * `execPath`, and `root` are injected rather than importing node:child_process
 * or career-ops.ts directly, keeping this module free of TypeScript
 * dependencies and letting tests substitute a fake child process.
 *
 * Runs build-cv-html.mjs, generate-pdf.mjs, and mark-pdf-ready.mjs as plain Node child processes
 * — no agent CLI or its sandbox involved — so a browser launch never depends
 * on an interactive sandbox-escalation approval nobody is present to grant in
 * a headless/web-triggered run. The tracker is marked ✅ only after a
 * CONFIRMED successful render, never optimistically.
 */
import fs from "node:fs";
import path from "node:path";
import * as yaml from "js-yaml";
import { pdfScratchPrefix } from "./pdf-paths.mjs";

export const DEFAULT_PDF_CHILD_TIMEOUT_MS = 120_000;
const PDF_CHILD_KILL_GRACE_MS = 1_000;

/**
 * @typedef {Object} PdfRunSignals
 * @property {object|undefined} envelope - parseCvEnvelope's result for this run.
 * @property {string|null} noOutputMessage - The route's verdict on "did the CLI
 *   produce any output at all", or null when it did. That question is about the
 *   transport, not this module, so the route owns the wording and passes it in
 *   rather than both places carrying the same two strings.
 * @property {boolean} sawError - Anything error-shaped on stderr.
 * @property {boolean} cleanExit - Exit code 0 (not killed, not non-zero).
 * @property {boolean} hasPaths - The backend resolved its scratch/final paths.
 */

/**
 * Did this pdf run produce a CV worth rendering?
 *
 * Pure, and here rather than in the route, because it is the decision point for
 * the backend pdf pipeline this module implements: nothing is written, rendered or
 * marked unless this says yes, and the route is a transport layer the repo leaves
 * untested by design.
 *
 * The envelope's own error is preferred over the generic message: "never closed"
 * and "emitted no envelope" are different bugs and the user can act on the
 * difference.
 *
 * @param {PdfRunSignals} signals
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function pdfRunOutcome({ envelope, noOutputMessage, sawError, cleanExit, hasPaths }) {
  // A CLI that produced nothing at all is a different failure from one that ran
  // and fell short — usually "not installed" or "not authenticated".
  if (noOutputMessage) return { ok: false, message: noOutputMessage };
  if (envelope?.ok !== true || !cleanExit || sawError || !hasPaths) {
    const why = envelope && envelope.ok === false ? ` (${envelope.error})` : "";
    return {
      ok: false,
      message: `This run didn't produce a tailored CV to render, so no PDF was generated — re-run it to verify.${why}`,
    };
  }
  return { ok: true };
}

/**
 * Persist the parsed payload that build-cv-html.mjs will consume.
 *
 * The agent emits the canonical JSON object inline and the backend saves it
 * here. page_format remains part of that payload, while the already-normalized
 * in-memory value is also passed to generate-pdf.mjs.
 *
 * The scratch directory is created by resolvePdfPaths earlier in the same
 * request, so this deliberately does not mkdir — a missing directory here means
 * something is wrong upstream and should surface, not be papered over.
 *
 * candidate.photo is special: the deterministic builder dereferences local
 * paths, so trusting an agent-controlled value here would turn an untrusted job
 * posting into a backend file-read capability. Source photo settings only from
 * the user's local profile and discard whatever the agent emitted.
 *
 * @param {{pdfPaths: {payload: string}, payload: Record<string, unknown>, root: string}} args
 * @returns {{ok: true} | {ok: false, error: string}} Never throws: the caller
 *   routes the failure through the same honesty gate as every other pdf failure.
 */
export function writeCvPayload({ pdfPaths, payload, root }) {
  try {
    const candidate = payload.candidate && typeof payload.candidate === "object" && !Array.isArray(payload.candidate)
      ? { ...payload.candidate }
      : payload.candidate;
    if (candidate && typeof candidate === "object") {
      delete candidate.photo;
      delete candidate.photo_style;
      delete candidate.photoStyle;
      try {
        const profile = yaml.load(fs.readFileSync(path.join(root, "config", "profile.yml"), "utf8"));
        const trusted = profile?.candidate;
        if (trusted?.photo) candidate.photo = trusted.photo;
        if (trusted?.photo_style) candidate.photo_style = trusted.photo_style;
      } catch (err) {
        if (err?.code !== "ENOENT") throw new Error(`Could not read trusted photo settings from config/profile.yml: ${err.message}`);
      }
    }
    const normalized = { ...payload, candidate };
    fs.writeFileSync(pdfPaths.payload, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (err) {
    // err.path when the platform gives it: a non-fs throw (an oversized-content
    // RangeError, a bad argument type) carries none, and "could not save to
    // undefined" tells the user nothing.
    return { ok: false, error: `Could not save the tailored CV payload to ${err.path ?? pdfPaths.payload}: ${err.message}` };
  }
}

/**
 * Spawn build-cv-html.mjs, the sole HTML writer for CLI and web paths.
 * @param {{spawnFn: Function, execPath: string, root: string, payload: string, html: string, template?: string, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, stdout?: string, stderr: string}>}
 */
export function spawnBuildCvHtml({ spawnFn, execPath, root, payload, html, template, timeoutMs }) {
  return spawnResult({
    spawnFn,
    execPath,
    args: [path.join(root, "build-cv-html.mjs"), payload, html, ...(template ? [template] : [])],
    cwd: root,
    startError: "CV builder failed to start",
    timeoutMs,
  });
}

/**
 * Resolve the profile-selected template through the repository's canonical CLI.
 * @param {{spawnFn: Function, execPath: string, root: string, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, template: string, stderr: string}>}
 */
export function resolveConfiguredCvTemplate({ spawnFn, execPath, root, timeoutMs }) {
  return spawnResult({
    spawnFn,
    execPath,
    args: [path.join(root, "cv-templates.mjs"), "resolve", "cv"],
    cwd: root,
    startError: "CV template resolver failed to start",
    timeoutMs,
  }).then(({ ok, stdout = "", stderr }) => {
    const template = stdout.trim();
    return {
      ok: ok && Boolean(template),
      template,
      stderr: stderr || (!template
        ? "CV template resolver returned no path."
        : ok ? "" : "CV template resolution failed."),
    };
  });
}

/**
 * Run one bounded child process and normalize spawn, exit, and timeout failures.
 * @param {{spawnFn: Function, execPath: string, args: string[], cwd: string, startError: string, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, stdout?: string, stderr: string}>}
 */
function spawnResult({ spawnFn, execPath, args, cwd, startError, timeoutMs = DEFAULT_PDF_CHILD_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId;
    let killTimeoutId;
    let timeoutResult;
    /** Settle the child-process result once and cancel its outstanding timers. */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      resolve(result);
    };
    let child;
    try {
      child = spawnFn(execPath, args, { cwd });
    } catch (e) {
      finish({ ok: false, stderr: `${startError}: ${e.message}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => finish(timeoutResult ?? { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on("error", (e) => {
      // A ChildProcess can emit error when signal delivery fails as well as
      // when spawn fails. Once timed out, only close proves it is safe for the
      // caller to clean scratch files; keep the SIGKILL escalation armed.
      if (timeoutResult) return;
      finish({ ok: false, stderr: `${startError}: ${e.message}` });
    });
    timeoutId = setTimeout(() => {
      timeoutResult = { ok: false, stderr: `${startError}: timed out after ${timeoutMs}ms` };
      try { child.kill?.("SIGTERM"); } catch { /* escalate below */ }
      if (settled) return;
      killTimeoutId = setTimeout(() => {
        try { child.kill?.("SIGKILL"); } catch { /* close still owns settlement */ }
      }, Math.min(PDF_CHILD_KILL_GRACE_MS, timeoutMs));
    }, timeoutMs);
  });
}

/**
 * Spawn generate-pdf.mjs as a plain child process and resolve once it exits.
 * @param {{spawnFn: Function, execPath: string, root: string, html: string, finalPdf: string, format: "letter"|"a4", reportNum: string}} args
 * @returns {Promise<{ok: boolean, stderr: string}>}
 */
export function spawnGeneratePdf({ spawnFn, execPath, root, html, finalPdf, format, reportNum, timeoutMs }) {
  return spawnResult({
    spawnFn,
    execPath,
      // --allow-reorder: a real cv.md's section order can legitimately diverge
      // from the template's fixed markup order, so this guard would otherwise
      // hard-fail every web-triggered render — same bypass a human already
      // applies manually via the CLI when this diverges.
    args: [path.join(root, "generate-pdf.mjs"), html, finalPdf, `--format=${format}`, `--report=${reportNum}`, "--allow-reorder"],
    cwd: root,
    startError: "PDF rendering failed to start",
    timeoutMs,
  }).then(({ ok, stderr }) => ({ ok, stderr }));
}

/**
 * Spawn mark-pdf-ready.mjs (--json) and resolve once it exits, parsing its
 * JSON stdout when present (mark-pdf-ready.mjs prints a JSON payload even on
 * a failure exit when --json is passed) so a caller can surface the specific
 * reason (not-found / ambiguous / lock-timeout / ...) rather than raw stderr.
 * @param {{spawnFn: Function, execPath: string, root: string, reportNum: string}} args
 * @returns {Promise<{ok: boolean, data: object | null, stderr: string}>}
 */
export function markTrackerReady({ spawnFn, execPath, root, reportNum, timeoutMs }) {
  return spawnResult({
    spawnFn,
    execPath,
    args: [path.join(root, "mark-pdf-ready.mjs"), reportNum, "--json"],
    cwd: root,
    startError: "mark-pdf-ready.mjs failed to start",
    timeoutMs,
  }).then(({ ok, stdout = "", stderr }) => {
    let data = null;
    try { data = JSON.parse(stdout); } catch { /* not JSON, or exited before printing any */ }
    return { ok, data, stderr };
  });
}

/**
 * Glob-clean every scratch file for this run rather than the one known filename.
 * The agent is not told these paths, and on Claude Code holds no write tool — but
 * the BACKEND writes here and generate-pdf.mjs may leave its own intermediates, so
 * matching the run's prefix stays the right sweep. Logs rather than silently
 * swallowing failures, so a systemic permissions problem doesn't grow
 * `.career-ops-web/pdf-tmp/` forever with no trace anywhere.
 * @param {string} scratchDir
 * @param {string} prefix
 * @returns {void}
 */
export function cleanupPdfScratch(scratchDir, prefix) {
  let entries;
  try {
    entries = fs.readdirSync(scratchDir);
  } catch (err) {
    console.error(`pdf scratch cleanup: could not list ${scratchDir}: ${err.message}`);
    return;
  }
  for (const f of entries) {
    if (!f.startsWith(prefix)) continue;
    try {
      fs.rmSync(path.join(scratchDir, f), { force: true });
    } catch (err) {
      console.error(`pdf scratch cleanup: could not remove ${f}: ${err.message}`);
    }
  }
}

/**
 * @typedef {Object} RenderFailedResult
 * @property {"build-failed"|"render-failed"} kind
 * @property {string} error
 */
/**
 * @typedef {Object} RenderedResult
 * @property {"rendered"} kind
 * @property {string[]} warnings - Non-fatal issues to surface to the user (e.g. a tracker row that was not marked).
 */
/** @typedef {RenderFailedResult | RenderedResult} RenderResult */

/**
 * Persist the tailored payload, build HTML deterministically, render it to a
 * PDF, then mark the tracker's PDF column
 * ready — only after the render is CONFIRMED successful, never
 * optimistically. Always cleans up scratch files, whether the render
 * succeeds or fails.
 *
 * @param {{spawnFn: Function, execPath: string, root: string, pdfPaths: {payload: string, html: string, finalPdf: string}, payload: Record<string, unknown>, format: "letter"|"a4", reportNum: string}} args
 * @returns {Promise<RenderResult>}
 */
export async function renderAndMarkPdf({ spawnFn, execPath, root, pdfPaths, payload, format, reportNum }) {
  const warnings = [];
  try {
    const written = writeCvPayload({ pdfPaths, payload, root });
    if (!written.ok) return { kind: "build-failed", error: written.error };

    const resolved = await resolveConfiguredCvTemplate({ spawnFn, execPath, root });
    if (!resolved.ok) {
      return { kind: "build-failed", error: `Could not resolve the configured CV template: ${resolved.stderr}` };
    }

    const build = await spawnBuildCvHtml({
      spawnFn,
      execPath,
      root,
      payload: pdfPaths.payload,
      html: pdfPaths.html,
      template: resolved.template,
    });
    if (!build.ok) {
      return { kind: "build-failed", error: build.stderr || "CV HTML build failed." };
    }

    const render = await spawnGeneratePdf({ spawnFn, execPath, root, html: pdfPaths.html, finalPdf: pdfPaths.finalPdf, format, reportNum });
    if (!render.ok) {
      return { kind: "render-failed", error: render.stderr || "PDF rendering failed." };
    }
  } finally {
    cleanupPdfScratch(path.dirname(pdfPaths.html), pdfScratchPrefix(reportNum));
  }

  // The PDF is the real deliverable and it already rendered successfully — a
  // tracker-sync miss (e.g. the row was edited away mid-flight) doesn't fail
  // the whole job, but it must still be visible to whoever is watching this
  // run, not just a server-side log nobody sees.
  const mark = await markTrackerReady({ spawnFn, execPath, root, reportNum });
  if (!mark.ok) {
    console.error(`mark-pdf-ready.mjs failed for report #${reportNum}: ${mark.data?.error ?? mark.stderr}`);
    warnings.push(
      mark.data?.error
        ? `PDF rendered, but the tracker wasn't updated: ${mark.data.error}`
        : `PDF rendered, but the tracker's PDF column wasn't updated automatically — run \`node mark-pdf-ready.mjs ${reportNum}\` manually.`,
    );
  }

  return { kind: "rendered", warnings };
}
