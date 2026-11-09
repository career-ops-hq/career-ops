/**
 * pdf-render.mjs — render a tailored CV to PDF and mark the tracker (#2172).
 *
 * Plain .mjs (same pattern as pdf-paths.mjs / clean-chips.mjs) so this can be
 * unit-tested with `node --test`, no TypeScript build step. `spawnFn`,
 * `execPath`, and `coreRoot` (the code checkout — the scripts live there, not in the data root) are injected rather than importing node:child_process
 * or career-ops.ts directly, keeping this module free of TypeScript
 * dependencies and letting tests substitute a fake child process.
 *
 * Runs build-cv-html.mjs, generate-pdf.mjs and mark-pdf-ready.mjs as plain Node
 * child processes
 * — no agent CLI or its sandbox involved — so a browser launch never depends
 * on an interactive sandbox-escalation approval nobody is present to grant in
 * a headless/web-triggered run. The tracker is marked ✅ only after a
 * CONFIRMED successful render, never optimistically.
 */
import fs from "node:fs";
import path from "node:path";
import { pdfScratchPrefix } from "./pdf-paths.mjs";
import { PAGE_FORMATS } from "./page-formats.mjs";

/**
 * Upper bound for each PDF child; a hung browser must not hold the run open
 * forever. The render gets the browser's budget; the builder and the tracker
 * mark are plain file work that finishes in well under a second. Together
 * (plus kill grace) they stay inside the ~200s route.ts leaves after the
 * agent's 600s, so a slow run ends with our message, not maxDuration's cutoff.
 */
export const DEFAULT_PDF_CHILD_TIMEOUT_MS = 120_000;
export const QUICK_PDF_CHILD_TIMEOUT_MS = 30_000;
const PDF_CHILD_KILL_GRACE_MS = 1_000;

/**
 * @typedef {Object} PdfRunSignals
 * @property {object|undefined} envelope - parseCvEnvelope's result for this run.
 * @property {string|null} noOutputMessage - The route's verdict on "did the CLI
 *   produce any output at all", or null when it did. That question is about the
 *   transport, not this module, so the route owns the wording and passes it in
 *   rather than both places carrying the same two strings.
 * @property {boolean} sawError - An authoritative structured-stream error (the
 *   CLI's own JSONL `error` event) — never a stderr keyword match, which must
 *   not override a clean exit (#1974).
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
 * Persist the CV payload the agent emitted through its <<cv-payload>> envelope
 * (#2185), for build-cv-html.mjs to read.
 *
 * The payload is written as-is. build-cv-html.mjs validates it and owns every
 * trust decision about its contents, including candidate.photo (#5094), so the
 * web path applies exactly the policy the CLI path does rather than a second one.
 *
 * The scratch directory is created by resolvePdfPaths earlier in the same
 * request, so this deliberately does not mkdir — a missing directory here means
 * something is wrong upstream and should surface, not be papered over.
 *
 * @param {{pdfPaths: {payload: string}, payload: Record<string, unknown>}} args
 * @returns {{ok: true} | {ok: false, error: string}} Never throws: the caller
 *   routes the failure through the same honesty gate as every other pdf failure.
 */
export function writeCvPayload({ pdfPaths, payload }) {
  try {
    fs.writeFileSync(pdfPaths.payload, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (err) {
    // err.path when the platform gives it: a non-fs throw (an oversized-content
    // RangeError, a bad argument type) carries none, and "could not save to
    // undefined" tells the user nothing.
    return { ok: false, error: `Could not save the tailored CV payload to ${err.path ?? pdfPaths.payload}: ${err.message}` };
  }
}

/**
 * Run one bounded child process and normalize spawn, exit and timeout failures.
 *
 * A timed-out child is sent SIGTERM, then SIGKILL after a short grace, and the
 * promise settles only on `close`: the caller deletes the scratch files next,
 * and must not do that while the child may still be writing them.
 *
 * Output is decoded on the stream, not per chunk: a chunk boundary inside a
 * multibyte character (the renderer's warnings open with ⚠️) would otherwise
 * leave U+FFFD in the text an error message is built from.
 *
 * @param {{spawnFn: Function, execPath: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv, startError: string, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, code: number | null, stdout: string, stderr: string}>}
 */
function spawnResult({ spawnFn, execPath, args, cwd, env, startError, timeoutMs = DEFAULT_PDF_CHILD_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId;
    let killTimeoutId;
    let timeoutResult;
    /** Settle once and cancel the outstanding timers. */
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      resolve(result);
    };
    let child;
    try {
      // windowsHide: see api/doctor/route.ts — a stale inherited console
      // kills every child with 0xC0000142 on Windows; never inherit one.
      child = spawnFn(execPath, args, { cwd, windowsHide: true, ...(env ? { env } : {}) });
    } catch (e) {
      finish({ ok: false, code: null, stdout: "", stderr: `${startError}: ${e.message}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => finish(timeoutResult ?? { ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on("error", (e) => {
      // A ChildProcess emits error when signal delivery fails as well as when
      // spawn fails. Once timed out, only close proves it is safe for the
      // caller to clean scratch files, so keep the SIGKILL escalation armed.
      if (timeoutResult) return;
      finish({ ok: false, code: null, stdout: "", stderr: `${startError}: ${e.message}` });
    });
    timeoutId = setTimeout(() => {
      timeoutResult = { ok: false, code: null, stdout: "", stderr: `${startError}: timed out after ${timeoutMs}ms` };
      try { child.kill?.("SIGTERM"); } catch { /* escalate below */ }
      if (settled) return;
      killTimeoutId = setTimeout(() => {
        try { child.kill?.("SIGKILL"); } catch { /* close still owns settlement */ }
      }, Math.min(PDF_CHILD_KILL_GRACE_MS, timeoutMs));
    }, timeoutMs);
  });
}

/**
 * Spawn build-cv-html.mjs, the one HTML writer for both the CLI and the web.
 *
 * `pageFormat` is the sheet the builder laid the body out for, read from its JSON
 * report, or null when the report carries no recognised size. The builder owns
 * that decision (profile, payload, `auto` by country — lib/page-format.mjs), so
 * the renderer is handed its answer instead of reaching one of its own.
 * @param {{spawnFn: Function, execPath: string, coreRoot: string, payload: string, html: string, template?: string, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, stderr: string, pageFormat: "a4"|"letter"|null}>}
 */
export function spawnBuildCvHtml({ spawnFn, execPath, coreRoot, payload, html, template, timeoutMs }) {
  return spawnResult({
    spawnFn,
    execPath,
    // path.resolve, not join: an absolute template (a data-root template, or
    // another drive on Windows) must stay itself rather than be glued under coreRoot.
    args: [path.join(coreRoot, "build-cv-html.mjs"), payload, html, ...(template ? [path.resolve(coreRoot, template)] : [])],
    cwd: coreRoot,
    startError: "CV builder failed to start",
    timeoutMs: timeoutMs ?? QUICK_PDF_CHILD_TIMEOUT_MS,
  }).then(({ ok, stdout, stderr }) => {
    let report = null;
    try { report = JSON.parse(stdout); } catch { /* no report: generate-pdf.mjs resolves the size itself */ }
    const pageFormat = PAGE_FORMATS.has(report?.page_format) ? report.page_format : null;
    return { ok, stderr, pageFormat };
  });
}

/**
 * The stderr line generate-pdf.mjs prints when a render ran over a warn-only
 * page budget and went to a sibling draft instead of the output path (#6377).
 * Used only to NAME the draft in the error shown to the user; whether a PDF was
 * delivered is decided from the file itself (see spawnGeneratePdf), never from
 * this text, so a wording change or a decoding hiccup cannot mark a rejected
 * render as ready. The capture ends at the draft's own suffix, not at the
 * first " (", which a directory on the way can contain.
 */
export const OVERFLOW_DRAFT_RE = /Overflow draft: (.*?\.overflow(?:-\d+)?\.pdf) \(/m;

/**
 * Identity of the file at `file` as the renderer leaves it, or null when there
 * is none. writeFileAtomic writes a temp file and renames it into place, so a
 * delivered PDF always has a new inode and mtime; a render that kept the
 * previous PDF (or wrote nothing) leaves this unchanged.
 * @param {string} file
 * @returns {string | null}
 */
export function pdfFingerprint(file) {
  try {
    const s = fs.statSync(file);
    return `${s.ino}:${s.mtimeMs}:${s.size}`;
  } catch {
    return null;
  }
}

/**
 * Spawn generate-pdf.mjs as a plain child process and resolve once it exits.
 *
 * `ok` is the exit code. `delivered` is whether this render left a PDF at
 * `finalPdf`: a render over a warn-only page budget exits 0 but writes nothing
 * there (the PDF went to a sibling .overflow.pdf draft, #6377), so `ok` alone
 * would keep an HTML beside, and mark the tracker ready for, a file that was
 * never written. Delivery is judged from the file: a PDF that landed during
 * this render has a new identity, one that was kept or never written has the
 * old one (or none). Every caller reads `delivered`, so the judgement lives
 * here and not in one of them.
 *
 * A null `format` omits --format, leaving the size to generate-pdf.mjs's own
 * profile-then-default resolution (the web path never passes null: see
 * renderAndMarkPdf).
 * @param {{spawnFn: Function, execPath: string, coreRoot: string, html: string, finalPdf: string, format: "letter"|"a4"|null, reportNum: string, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, delivered: boolean, stderr: string}>}
 */
export function spawnGeneratePdf({ spawnFn, execPath, coreRoot, html, finalPdf, format, reportNum, timeoutMs }) {
  const before = pdfFingerprint(finalPdf);
  return spawnResult({
    spawnFn,
    execPath,
    // --allow-reorder: a real cv.md's section order can legitimately diverge
    // from the template's fixed markup order, so this guard would otherwise
    // hard-fail every web-triggered render — same bypass a human already
    // applies manually via the CLI when this diverges.
    args: [path.join(coreRoot, "generate-pdf.mjs"), html, finalPdf, ...(format ? [`--format=${format}`] : []), `--report=${reportNum}`, "--allow-reorder"],
    cwd: coreRoot,
    env: { ...process.env, CAREER_OPS_PDF_SHARED: "1" },
    startError: "PDF rendering failed to start",
    timeoutMs,
  }).then(({ ok, stderr }) => {
    const after = pdfFingerprint(finalPdf);
    const landed = after !== null && after !== before;
    return { ok, delivered: ok && landed, stderr };
  });
}

/**
 * The error to show for a render that delivered no PDF at `finalPdf`, kept
 * short enough to survive the run route's 200-character cut.
 *
 * For a failed exit that is the renderer's own stderr. For a clean exit that
 * wrote nothing, the full stderr opens with the page-budget warning, which
 * alone runs past 200 characters and reads as advice to keep going; the line
 * saying no PDF was written would never reach the user. So this leads with the
 * page counts and the outcome, and names the draft this render wrote (the
 * first free name: .overflow.pdf, then .overflow-2.pdf, ...), not the pattern,
 * so the user does not open an older draft.
 * @param {{ok: boolean, stderr: string}} render
 * @param {string} finalPdf
 * @returns {string}
 */
export function undeliveredRenderError(render, finalPdf) {
  if (!render.ok) return failureReason(render.stderr);
  const budgetLine = /CV is \d+ pages?; the allowed maximum is \d+ pages?\./.exec(render.stderr)?.[0] ?? null;
  const draftPath = OVERFLOW_DRAFT_RE.exec(render.stderr)?.[1];
  const draftName = draftPath ? path.basename(draftPath) : null;
  if (!budgetLine && !draftName) {
    // Exit 0, no PDF, and nothing on stderr to explain it: say exactly that
    // rather than guess at a page budget.
    return `PDF rendering reported success but wrote nothing to ${path.basename(finalPdf)}.`;
  }
  const budget = budgetLine ?? "The CV is over its page budget.";
  const named = draftName ? `${budget} No PDF was written; the over-budget draft is ${draftName}. Trim the CV and render again.` : null;
  return named && named.length <= 200
    ? named
    : `${budget} No PDF was written: the over-budget render was kept as an .overflow.pdf draft beside it. Trim the CV and render again.`;
}

/**
 * Spawn mark-pdf-ready.mjs (--json) and resolve once it exits, parsing its
 * JSON stdout when present (mark-pdf-ready.mjs prints a JSON payload even on
 * a failure exit when --json is passed) so a caller can surface the specific
 * reason (not-found / ambiguous / lock-timeout / ...) rather than raw stderr.
 * `code` is the exit code, or null when the child never started or timed out.
 * @param {{spawnFn: Function, execPath: string, coreRoot: string, reportNum: string, timeoutMs?: number}} args
 * @returns {Promise<{ok: boolean, code: number | null, data: {error?: string} | null, stderr: string}>}
 */
export function markTrackerReady({ spawnFn, execPath, coreRoot, reportNum, timeoutMs }) {
  return spawnResult({
    spawnFn,
    execPath,
    args: [path.join(coreRoot, "mark-pdf-ready.mjs"), reportNum, "--json"],
    cwd: coreRoot,
    startError: "mark-pdf-ready.mjs failed to start",
    timeoutMs: timeoutMs ?? QUICK_PDF_CHILD_TIMEOUT_MS,
  }).then(({ ok, code, stdout, stderr }) => {
    let data = null;
    try { data = JSON.parse(stdout); } catch { /* not JSON, or exited before printing any */ }
    return { ok, code, data, stderr };
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
 * Keep the rendered HTML beside its PDF. The CV Studio edits that HTML, and
 * the scratch copy is deleted right after the render.
 * @param {{html: string, finalPdf: string}} pdfPaths
 * @param {string[]} warnings
 */
export function keepTailoredHtml(pdfPaths, warnings) {
  try {
    fs.copyFileSync(pdfPaths.html, pdfPaths.finalPdf.replace(/\.pdf$/i, ".html"));
  } catch (err) {
    warnings.push(`PDF rendered, but its HTML was not kept for the CV Studio: ${err.message}`);
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
 * @property {string[]} warnings - Non-fatal issues to surface to the user (e.g. a builder or renderer advisory, or a tracker row that was not marked).
 */
/** @typedef {RenderFailedResult | RenderedResult} RenderResult */

/**
 * The reason a failed render died, without the advisories printed before it.
 * Keeps every line from the first `❌` on, since some failures put their detail
 * (e.g. the locked-section Expected/Found values) on the lines after it.
 * generate-pdf.mjs writes `⚠️` warnings (voice check, page budget) ahead of the
 * `❌` line that names the actual failure, and the caller caps the message
 * length, so passing raw stderr hid the cause behind a harmless warning. Every
 * line from the first `❌` onward is kept: a locked-section mismatch prints its
 * Expected/Found values on the lines after the header.
 * @param {string} stderr
 * @returns {string}
 */
export function failureReason(stderr) {
  const lines = (stderr || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => l.startsWith("❌"));
  const picked = start >= 0 ? lines.slice(start) : lines;
  return picked.length > 0 ? picked.join("\n") : "PDF rendering failed.";
}

/**
 * Collect a successful child's stderr as warnings, one per non-blank line.
 * @param {string} stderr
 * @param {string[]} warnings
 */
function pushStderrWarnings(stderr, warnings) {
  for (const line of stderr.split("\n")) {
    const text = line.trim();
    if (text) warnings.push(text);
  }
}

/**
 * Save the tailored payload, build its HTML with build-cv-html.mjs (the same
 * builder the CLI uses), render that HTML to a PDF, then mark the tracker's PDF
 * column ready — only after the render is CONFIRMED successful, never
 * optimistically. Always cleans up scratch files, whether any step succeeds or
 * fails.
 *
 * `template` is the path resolveCvTemplate() returned for this run, made
 * absolute by the route, so the web renders the template cv.template selects, as
 * the CLI does. The sheet is the one the builder reports, so the body and the
 * paper match.
 * @param {{spawnFn: Function, execPath: string, coreRoot: string, pdfPaths: {payload: string, html: string, finalPdf: string}, payload: Record<string, unknown>, template?: string, reportNum: string}} args
 * @returns {Promise<RenderResult>}
 */
export async function renderAndMarkPdf({ spawnFn, execPath, coreRoot, pdfPaths, payload, template, reportNum }) {
  const warnings = [];
  try {
    const written = writeCvPayload({ pdfPaths, payload });
    if (!written.ok) return { kind: "build-failed", error: written.error };

    const build = await spawnBuildCvHtml({ spawnFn, execPath, coreRoot, payload: pdfPaths.payload, html: pdfPaths.html, template });
    if (!build.ok) return { kind: "build-failed", error: build.stderr || "CV HTML build failed." };
    // Without the builder's sheet, generate-pdf.mjs would resolve its own from
    // fewer inputs (no payload country), and the body and the paper could
    // disagree (#4405). Fail closed rather than print a mismatched CV.
    if (!build.pageFormat) return { kind: "build-failed", error: "The CV builder did not report the page size it laid out, so no PDF was rendered." };
    // The builder's warnings name payload sections the chosen template has no
    // slot for (#5908): content the user wrote that this PDF will not show.
    pushStderrWarnings(build.stderr, warnings);

    // A render over a warn-only page budget exits 0 but writes nothing to the
    // final path (#6377): there is then no PDF to keep an HTML beside or to mark
    // ready, and "done" would point the user at a file that was never written,
    // so it is reported the way a strict overflow is. spawnGeneratePdf judges
    // delivery from the file itself.
    const render = await spawnGeneratePdf({ spawnFn, execPath, coreRoot, html: pdfPaths.html, finalPdf: pdfPaths.finalPdf, format: build.pageFormat, reportNum });
    if (!render.delivered) {
      return { kind: "render-failed", error: undeliveredRenderError(render, pdfPaths.finalPdf) };
    }
    keepTailoredHtml(pdfPaths, warnings);
    // A render that exits 0 can still have written advisories to stderr, and
    // they matter to whoever asked for this PDF: the CV fact check's advisory
    // phrases, the portal-length warnings. Dropping them would mean an
    // unsupported claim the fact gate flagged reached nobody on the web path.
    pushStderrWarnings(render.stderr, warnings);
  } finally {
    cleanupPdfScratch(path.dirname(pdfPaths.html), pdfScratchPrefix(reportNum));
  }

  // The PDF is the real deliverable and it already rendered successfully — a
  // tracker-sync miss (e.g. the row was edited away mid-flight) doesn't fail
  // the whole job, but it must still be visible to whoever is watching this
  // run, not just a server-side log nobody sees.
  const mark = await markTrackerReady({ spawnFn, execPath, coreRoot, reportNum });
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
