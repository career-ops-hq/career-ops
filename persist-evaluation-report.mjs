#!/usr/bin/env node
/**
 * persist-evaluation-report.mjs
 *
 * Write one evaluation report and one headed tracker-addition TSV.
 * Stdin is one JSON object:
 * { markdown, num, today, company, role, score, via, url, notes, reportFile }
 *
 * The web app reserves the number and merges. This script validates/captures
 * the full JD archive before writing report/TSV under the process cwd, which
 * the caller sets to the data root. It never reserves or merges.
 *
 * Success prints {"ok":true} and exits 0. Failure prints on stderr and
 * exits 1. A failed write removes only files this call created.
 */
import fs from "node:fs";
import path from "node:path";
import { isMainModule } from "./lib/is-main-module.mjs";
import { isPostingUrl, trackerTsvLine } from "./lib/tracker-addition.mjs";
import { isEvaluationArtifactOwner, prepareEvaluationArchive, validateEvaluationArchive, archiveSourceCapabilities } from "./lib/evaluation-archive.mjs";

const ISO_DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;
const NUM_RE = /^\d{3,}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCORE_RE = /^\d+\.\d\/5$/;
const TSV_BREAK = /[\t\r\n]/;

function fail(error) {
  return { ok: false, error };
}

/** tsvSafe collapses tabs. This writer refuses them instead. */
function textProblem(name, value) {
  if (typeof value !== "string") return `${name} must be a string`;
  if (TSV_BREAK.test(value)) return `${name} has a tab or newline`;
  return null;
}

/**
 * @param {string} root
 * @param {object} payload
 * @param {typeof fs} [fsImpl]
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateEvaluationArtifactPayload(root, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fail("expected one JSON object");
  }
  const { markdown, num, today, company, role, score, notes, reportFile } = payload;
  const via = payload.via == null || payload.via === "" ? null : payload.via;
  const url = payload.url == null || payload.url === "" ? "" : payload.url;

  if (typeof markdown !== "string" || markdown.length === 0) return fail("markdown is required");
  if (typeof num !== "string" || !NUM_RE.test(num)) return fail(`unusable report number "${num}"`);
  if (typeof today !== "string" || !ISO_DATE_RE.test(today)) return fail(`invalid evaluation date "${today}"`);
  if (typeof reportFile !== "string" || path.basename(reportFile) !== reportFile || reportFile.includes("..")) {
    return fail(`refusing to write report "${reportFile}"`);
  }
  for (const [name, value] of [["num", num], ["today", today], ["company", company], ["role", role], ["score", score], ["notes", notes]]) {
    const problem = textProblem(name, value);
    if (problem) return fail(problem);
  }
  if (!company || !role) return fail("company and role are required");
  if (via != null) {
    const problem = textProblem("via", via);
    if (problem) return fail(problem);
  }
  if (url !== "") {
    const problem = textProblem("url", url);
    if (problem) return fail(problem);
    if (!isPostingUrl(url)) return fail("url is not an http(s) posting URL");
  }
  if (!SCORE_RE.test(score)) return fail(`score is not an X.X/5 cell: "${score}"`);
  const scoreN = Number(score.slice(0, score.length - 2));
  if (!Number.isFinite(scoreN) || scoreN < 0 || scoreN > 5) return fail(`score is out of range: "${score}"`);

  const prefix = `${num}-`;
  const suffix = `-${today}.md`;
  if (!reportFile.startsWith(prefix) || !reportFile.endsWith(suffix)) {
    return fail("reportFile does not match the report number and date");
  }
  const slug = reportFile.slice(prefix.length, reportFile.length - suffix.length);
  if (!SLUG_RE.test(slug)) return fail(`report slug is not a single path segment: "${slug}"`);

  const reportsDir = path.join(root, "reports");
  const additionsDir = path.join(root, "batch", "tracker-additions");
  const reportPath = path.join(reportsDir, reportFile);
  const tsvPath = path.join(additionsDir, `${num}-${slug}.tsv`);
  if (path.dirname(reportPath) !== reportsDir || path.dirname(tsvPath) !== additionsDir) {
    return fail("refusing to persist outside reports/ or batch/tracker-additions/");
  }

  const tsv = trackerTsvLine({ num, today, company, role, score, reportFile, notes, via, url });
  return { ok: true, reportPath, tsvPath, reportsDir, additionsDir, markdown, tsv };
}

/** Direct callers cannot bypass archive enforcement by skipping the CLI. */
export function writeEvaluationArtifacts(root, payload, fsImpl = fs, { sourceAdapterLoader } = {}) {
  const plan = validateEvaluationArtifactPayload(root, payload);
  if (!plan.ok) return plan;
  const archived = validateEvaluationArchive(root, payload, { sourceAdapterLoader });
  if (!archived.ok) return archived;
  const { reportPath, tsvPath, reportsDir, additionsDir, markdown, tsv } = plan;
  const attempted = [];
  try {
    let dataRootUid;
    for (const dir of [root, reportsDir, path.join(root, 'batch'), additionsDir]) {
      if (fsImpl.existsSync(dir)) {
        const st = fsImpl.lstatSync(dir);
        if (dir === root) dataRootUid = st.uid;
        if (!st.isDirectory() || st.isSymbolicLink() || !isEvaluationArtifactOwner(st, dataRootUid)) {
          throw new Error('artifact directory is not a contained own-user directory');
        }
      }
    }
    fsImpl.mkdirSync(reportsDir, { recursive: true, mode: 0o700 });
    fsImpl.mkdirSync(additionsDir, { recursive: true, mode: 0o700 });
    writeNew(fsImpl, reportPath, markdown, attempted);
    writeNew(fsImpl, tsvPath, tsv, attempted);
  } catch (err) {
    const cleanupError = cleanupNew(fsImpl, attempted);
    const message = `Could not save the evaluation report: ${err.message}`;
    return fail(cleanupError ? `${message} ${cleanupError}` : message);
  }
  return { ok: true };
}

function writeNew(fsImpl, filePath, content, attempted) {
  // Exclusive open proves which files this attempt owns. In particular an
  // EEXIST race must never make cleanup delete another writer's artifact.
  const fd = fsImpl.openSync(filePath, 'wx', 0o600);
  attempted.push({ filePath, existed: false });
  try { fsImpl.writeFileSync(fd, content, 'utf8'); } finally { fsImpl.closeSync(fd); }
}

/** Reserved-number orchestration: capture/check before report, TSV or merge. */
export async function persistEvaluationArtifacts(root, payload, { captureFn, fsImpl = fs, sourceAdapterLoader } = {}) {
  const valid = validateEvaluationArtifactPayload(root, payload);
  if (!valid.ok) return valid;
  const prepared = await prepareEvaluationArchive(root, payload, { captureFn, sourceAdapterLoader });
  if (!prepared.ok) return prepared;
  return writeEvaluationArtifacts(root, { ...payload, markdown: prepared.markdown }, fsImpl, { sourceAdapterLoader });
}

function cleanupNew(fsImpl, attempted) {
  const problems = [];
  for (const { filePath, existed } of attempted) {
    if (existed) continue;
    try {
      fsImpl.unlinkSync(filePath);
    } catch (err) {
      if (err?.code !== "ENOENT") problems.push(err.message);
    }
  }
  return problems.join("; ");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

const USAGE_LINES = [
  "Usage: node persist-evaluation-report.mjs < payload.json",
  "       node persist-evaluation-report.mjs --capabilities (read-only JSON)",
  "",
  "Read one JSON object on stdin and write the evaluation report plus a",
  "headed tracker-addition TSV under the process cwd (the data root).",
  "Does not reserve a report number and does not merge the tracker.",
  "",
  "  --help, -h    print this help and exit",
];

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${USAGE_LINES.join("\n")}\n`);
    return;
  }
  if (args.length === 1 && args[0] === "--capabilities") {
    process.stdout.write(`${JSON.stringify(archiveSourceCapabilities())}\n`);
    return;
  }
  if (args.length > 0) {
    process.stderr.write(`persist-evaluation-report: unrecognized argument: ${args[0]}\n${USAGE_LINES.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch {
    process.stderr.write("stdin is not one JSON object\n");
    process.exitCode = 1;
    return;
  }
  const result = await persistEvaluationArtifacts(process.cwd(), payload);
  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
