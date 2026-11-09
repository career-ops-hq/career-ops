#!/usr/bin/env node
/**
 * persist-evaluation-report.mjs
 *
 * Write one evaluation report and one headed tracker-addition TSV, or attach
 * a new report version to an existing targetApplication under the tracker lock.
 * Stdin is one JSON object:
 * { markdown, num, today, company, role, score, via, url, notes, reportFile }
 *
 * The caller reserves the report number. Untargeted reports are merged by
 * the caller; targeted saves update only the existing row's evaluation cells.
 * Files are written under the process cwd, which the caller sets to the data root.
 *
 * Success prints {"ok":true} and exits 0. Failure prints on stderr and
 * exits 1. A failed write removes only files this call created.
 */
import fs from "node:fs";
import path from "node:path";
import { isMainModule } from "./lib/is-main-module.mjs";
import { isPostingUrl, trackerTsvLine } from "./lib/tracker-addition.mjs";
import { resolveTrackerPath } from "./path-resolver.mjs";
import { openTrackerTransaction, writeFileAtomic } from "./tracker-utils.mjs";
import { attachEvaluationToRow } from "./lib/evaluation-target.mjs";

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
 * @param {Pick<typeof fs, "mkdirSync"|"existsSync"|"writeFileSync"|"unlinkSync">} [fsImpl]
 * @param {{reportOnly?: boolean}} [options]
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function writeEvaluationArtifacts(root, payload, fsImpl = fs, { reportOnly = false } = {}) {
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
  const attempted = [];
  try {
    fsImpl.mkdirSync(reportsDir, { recursive: true });
    if (!reportOnly) fsImpl.mkdirSync(additionsDir, { recursive: true });
    writeNew(fsImpl, reportPath, markdown, attempted);
    if (!reportOnly) writeNew(fsImpl, tsvPath, tsv, attempted);
  } catch (err) {
    const cleanupError = cleanupNew(fsImpl, attempted);
    const message = `Could not save the evaluation report: ${err.message}`;
    return fail(cleanupError ? `${message} ${cleanupError}` : message);
  }
  return { ok: true };
}

/** Save a new report version onto one existing application under the tracker lock. */
export async function writeTargetedEvaluation(root, payload) {
  const transaction = await openTrackerTransaction(resolveTrackerPath(root));
  let reportPath;
  try {
    const before = transaction.read();
    // Validate the target before creating any report or addition.
    const prospectivePath = path.join(root, 'reports', String(payload.reportFile ?? ''));
    const after = attachEvaluationToRow(before, {
      target: payload.targetApplication, url: payload.url, score: payload.score,
      reportPath: prospectivePath, trackerPath: transaction.path, reportNum: payload.num,
    });
    if (fs.existsSync(prospectivePath)) return fail('A report already occupies this version; the previous report was kept.');
    const written = writeEvaluationArtifacts(root, payload, fs, { reportOnly: true });
    if (!written.ok) return written;
    reportPath = prospectivePath;
    writeFileAtomic(`${transaction.path}.bak`, before);
    transaction.replace(after);
    reportPath = undefined; // Markdown is committed; never remove its report.
    return { ok: true };
  } catch (error) {
    if (reportPath) fs.unlinkSync(reportPath);
    return fail(error.message);
  } finally {
    transaction.close();
  }
}

function writeNew(fsImpl, filePath, content, attempted) {
  const existed = fsImpl.existsSync(filePath);
  attempted.push({ filePath, existed });
  fsImpl.writeFileSync(filePath, content, "utf8");
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
  "",
  "Read one JSON object on stdin and write the evaluation report plus a",
  "headed tracker-addition TSV under the process cwd (the data root).",
  "With targetApplication, attach a new report to that job instead of adding a TSV.",
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
  const result = payload?.targetApplication
    ? await writeTargetedEvaluation(process.cwd(), payload)
    : writeEvaluationArtifacts(process.cwd(), payload);
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
