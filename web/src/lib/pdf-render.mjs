/**
 * pdf-render.mjs — render a tailored CV to PDF and mark the tracker (#2172).
 *
 * Plain .mjs (same pattern as pdf-paths.mjs / clean-chips.mjs) so this can be
 * unit-tested with `node --test`, no TypeScript build step. `spawnFn`,
 * `execPath`, and `root` are injected rather than importing node:child_process
 * or career-ops.ts directly, keeping this module free of TypeScript
 * dependencies and letting tests substitute a fake child process.
 *
 * Runs generate-pdf.mjs and mark-pdf-ready.mjs as plain Node child processes
 * — no agent CLI or its sandbox involved — so a browser launch never depends
 * on an interactive sandbox-escalation approval nobody is present to grant in
 * a headless/web-triggered run. The tracker is marked ✅ only after a
 * CONFIRMED successful render, never optimistically.
 */
import fs from "node:fs";
import path from "node:path";

/**
 * Read the agent-written format sidecar. `ok: false` means the sidecar is
 * missing or unparseable — the caller should warn rather than silently trust
 * the "letter" default, since that can ship a European CV in the wrong page
 * size with no signal.
 * @param {string} metaPath
 * @returns {{format: "letter" | "a4", ok: boolean}}
 */
export function resolveRenderFormat(metaPath) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.format === "a4" || meta.format === "letter") {
      return { format: meta.format, ok: true };
    }
    return { format: "letter", ok: false };
  } catch {
    return { format: "letter", ok: false };
  }
}

/**
 * Spawn generate-pdf.mjs as a plain child process and resolve once it exits.
 * @param {{spawnFn: Function, execPath: string, root: string, html: string, finalPdf: string, format: "letter"|"a4", reportNum: string}} args
 * @returns {Promise<{ok: boolean, stderr: string}>}
 */
export function spawnGeneratePdf({ spawnFn, execPath, root, html, finalPdf, format, reportNum }) {
  return new Promise((resolve) => {
    const child = spawnFn(
      execPath,
      // --allow-reorder: a real cv.md's section order can legitimately diverge
      // from the template's fixed markup order, so this guard would otherwise
      // hard-fail every web-triggered render — same bypass a human already
      // applies manually via the CLI when this diverges.
      [path.join(root, "generate-pdf.mjs"), html, finalPdf, `--format=${format}`, `--report=${reportNum}`, "--allow-reorder"],
      { cwd: root },
    );
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ ok: code === 0, stderr: stderr.trim() }));
    child.on("error", (e) => resolve({ ok: false, stderr: `PDF rendering failed to start: ${e.message}` }));
  });
}

/**
 * Spawn mark-pdf-ready.mjs (--json) and resolve once it exits, parsing its
 * JSON stdout when present (mark-pdf-ready.mjs prints a JSON payload even on
 * a failure exit when --json is passed) so a caller can surface the specific
 * reason (not-found / ambiguous / lock-timeout / ...) rather than raw stderr.
 * @param {{spawnFn: Function, execPath: string, root: string, reportNum: string}} args
 * @returns {Promise<{ok: boolean, data: object | null, stderr: string}>}
 */
export function markTrackerReady({ spawnFn, execPath, root, reportNum }) {
  return new Promise((resolve) => {
    const child = spawnFn(execPath, [path.join(root, "mark-pdf-ready.mjs"), reportNum, "--json"], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      let data = null;
      try { data = JSON.parse(stdout); } catch { /* not JSON, or exited before printing any */ }
      resolve({ ok: code === 0, data, stderr: stderr.trim() });
    });
    child.on("error", (e) => resolve({ ok: false, data: null, stderr: `mark-pdf-ready.mjs failed to start: ${e.message}` }));
  });
}

/**
 * Glob-clean every scratch file for this run (not just the two known
 * filenames — the agent may legitimately create its own intermediate files
 * en route, e.g. build-cv-html.mjs's JSON payload). Logs rather than
 * silently swallowing failures, so a systemic permissions issue doesn't grow
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
 * @property {"render-failed"} kind
 * @property {string} error
 */
/**
 * @typedef {Object} RenderedResult
 * @property {"rendered"} kind
 * @property {string[]} warnings - Non-fatal issues to surface to the user (missing format sidecar, tracker not marked).
 */
/** @typedef {RenderFailedResult | RenderedResult} RenderResult */

/**
 * Render the tailored HTML to a PDF, then mark the tracker's PDF column
 * ready — only after the render is CONFIRMED successful, never
 * optimistically. Always cleans up scratch files, whether the render
 * succeeds or fails.
 * @param {{spawnFn: Function, execPath: string, root: string, pdfPaths: {html: string, meta: string, finalPdf: string}, reportNum: string}} args
 * @returns {Promise<RenderResult>}
 */
export async function renderAndMarkPdf({ spawnFn, execPath, root, pdfPaths, reportNum }) {
  const { format, ok: formatOk } = resolveRenderFormat(pdfPaths.meta);
  const warnings = [];
  if (!formatOk) {
    warnings.push(`No valid page-format file found at ${pdfPaths.meta} — defaulted to letter. Check the rendered PDF's format.`);
  }

  const render = await spawnGeneratePdf({ spawnFn, execPath, root, html: pdfPaths.html, finalPdf: pdfPaths.finalPdf, format, reportNum });
  cleanupPdfScratch(path.dirname(pdfPaths.html), `cv-web-${reportNum}.`);

  if (!render.ok) {
    return { kind: "render-failed", error: render.stderr || "PDF rendering failed." };
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
