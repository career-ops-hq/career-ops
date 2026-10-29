/**
 * report-persist.mjs: persist a web evaluate run's report and tracker row.
 *
 * The evaluate agent used to hold Write and Bash so it could run
 * reserve-report-num.mjs, write reports/, write a TSV, and merge-tracker.mjs.
 * Those tools are unscoped, so a posting in its context could aim them anywhere.
 * The agent now emits the report in a <<report-md>> envelope. This module
 * reserves a number, asks persist-evaluation-report.mjs to write the report
 * and the headed addition, merges, then releases the sentinel.
 *
 * spawnFn / execPath / root are injected so tests substitute a fake child
 * process and never touch the real allocator or tracker.
 */
import path from "node:path";
import fs from "node:fs";
import { slugify } from "./pdf-paths.mjs";
import { setInboxSkip } from "./inbox-skip.mjs";
import { parseEvaluationOptions } from "./evaluation-options.mjs";

const ISO_DATE_RE = /^20\d{2}-\d{2}-\d{2}$/;
const YAML_FENCE = /##\s*Machine Summary\s*\n+```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/i;
const TITLE_RE = /^#\s+Evaluation:\s+(.+?)\s+(?:—|--|–|-)\s+(.+)$/m;

/**
 * Did this evaluate run produce a report worth persisting?
 *
 * Pure, and here rather than in the route, because it is the decision point
 * for the backend evaluate pipeline: nothing is written unless this says yes.
 *
 * @param {{envelope: object|undefined, noOutputMessage: string|null, sawError: boolean, cleanExit: boolean}} signals
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function evaluateRunOutcome({ envelope, noOutputMessage, sawError, cleanExit }) {
  if (noOutputMessage) return { ok: false, message: noOutputMessage };
  if (envelope?.ok !== true || !cleanExit || sawError) {
    const why = envelope && envelope.ok === false ? ` (${envelope.error})` : "";
    return {
      ok: false,
      message: `This evaluation didn't produce a report to save, so it isn't in your tracker — re-run it to verify.${why}`,
    };
  }
  return { ok: true };
}

/**
 * Read a YAML scalar from a Machine Summary fence. Quoted or bare; `null` / `~`
 * / empty → null. Does not parse nested maps — company/role/score/via are
 * top-level scalars in batch/batch-prompt.md.
 *
 * @param {string} block
 * @param {string} key
 * @returns {string|null}
 */
export function yamlScalar(block, key) {
  const m = String(block ?? "").match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  if (!m) return null;
  let v = m[1].trim();
  if (!v || v === "null" || v === "~") return null;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.trim() || null;
}

/**
 * Score as the tracker writes it (`X.X/5`). Null unless the value is a finite
 * number in 0..5. A trailing `/5` does not skip that range check.
 * @param {string|null} raw
 * @returns {string|null}
 */
export function formatScore(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d+(?:\.\d+)?)(?:\/5)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0 || n > 5) return null;
  return `${n.toFixed(1)}/5`;
}

/**
 * Company, role, score, via from the report. Machine Summary wins; the
 * `# Evaluation: Company — Role` title is the fallback for company/role.
 *
 * @param {string} markdown
 * @returns {{ok: true, company: string, role: string, score: string, via: string|null} | {ok: false, error: string}}
 */
const TSV_BREAK = /[\t\r\n]/;

/** Model-derived tracker cells cannot carry TSV control characters. */
function tsvUnsafe(value) {
  return typeof value === "string" && TSV_BREAK.test(value);
}

export function parseReportMeta(markdown) {
  const fence = String(markdown ?? "").match(YAML_FENCE)?.[1] ?? "";
  const title = String(markdown ?? "").match(TITLE_RE);
  const company = yamlScalar(fence, "company") || title?.[1]?.trim() || null;
  const role = yamlScalar(fence, "role") || title?.[2]?.trim() || null;
  const score = formatScore(yamlScalar(fence, "score"));
  const via = yamlScalar(fence, "via");
  if (!company || !role) {
    return { ok: false, error: "The report's Machine Summary is missing company or role, so the tracker row cannot be built." };
  }
  if (!score) {
    return { ok: false, error: "The report's Machine Summary is missing a numeric score, so the tracker row cannot be built." };
  }
  for (const [field, value] of [["company", company], ["role", role], ["score", score], ["via", via]]) {
    if (tsvUnsafe(value)) {
      return { ok: false, error: `The report's Machine Summary has a tab or newline in ${field}, so the tracker row cannot be built.` };
    }
  }
  return { ok: true, company, role, score, via };
}

/**
 * Filename slug for a report. `?` (unknown end employer, #1596) becomes
 * `confidential` or `confidential-{agency}`. Empty after slugify → `company`.
 * @param {string} company
 * @param {string|null} via
 * @returns {string}
 */
export function reportSlug(company, via) {
  if (company === "?") {
    const agency = via ? slugify(via) : "";
    return agency ? `confidential-${agency}` : "confidential";
  }
  return slugify(company) || "company";
}

/**
 * Labels for the required-plus-notes prefix. Same spelling and order as
 * `TSV_ADDITION_HEADER` in tracker-parse.mjs. merge-tracker resolves a headed
 * addition by name, so a cell with no label is dropped and a cell under the
 * wrong label is stored as that column.
 *
 * The file bytes are written by persist-evaluation-report.mjs, which builds
 * the same row from lib/tracker-addition.mjs. This copy stays here because
 * the Next bundle cannot import that file. The parity test locks them.
 */
const ADDITION_LABELS = ["num", "date", "company", "role", "status", "score", "pdf", "report", "notes"];

/**
 * Header row plus one data row. `via` and `url` are appended only when set,
 * in that order, so the URL stays under `url` and the agency stays under `via`.
 * The via cell is the agency name. The headed parser strips a `via=` prefix
 * if one is present. An empty URL is omitted, not written as a blank cell.
 *
 * @param {{num: string, today: string, company: string, role: string, score: string, reportFile: string, notes: string, via: string|null, url: string}} row
 * @returns {string}
 */
export function trackerTsvLine({ num, today, company, role, score, reportFile, notes, via, url }) {
  const labels = [...ADDITION_LABELS];
  const fields = [
    num, today, company, role, "Evaluated", score, "❌",
    `[${num}](reports/${reportFile})`, notes,
  ];
  if (via) {
    labels.push("via");
    fields.push(via);
  }
  if (url) {
    labels.push("url");
    fields.push(url);
  }
  return `${labels.join("\t")}\n${fields.join("\t")}\n`;
}

function spawnScript({ spawnFn, execPath, root, script, args = [], input = null }) {
  return new Promise((resolve) => {
    // windowsHide: see api/doctor/route.ts — a stale inherited console kills
    // every child with 0xC0000142 on Windows; never inherit one.
    const child = spawnFn(execPath, [path.join(root, script), ...args], { cwd: root, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on("error", (e) => resolve({ ok: false, stdout: "", stderr: `${script} failed to start: ${e.message}` }));
    if (input != null) {
      child.stdin?.write(input);
      child.stdin?.end();
    }
  });
}

/**
 * Reserve a report number, write the report + TSV, merge the tracker, release
 * the sentinel. Never throws: the caller routes `{ok:false}` through the same
 * honesty gate as every other evaluate failure.
 *
 * @param {{spawnFn: Function, execPath: string, root: string, markdown: string, url: string, today: string, postedAt?: string, evaluationSections?: string[]}} args
 * @returns {Promise<{ok: true, num: string, reportFile: string, warnings: string[]} | {ok: false, error: string}>}
 */
export async function persistEvaluation({ spawnFn, execPath, root, markdown, url, today, postedAt, evaluationSections = undefined }) {
  const evaluation = parseEvaluationOptions(evaluationSections);
  if (!evaluation.ok) return { ok: false, error: evaluation.error };
  if (!evaluation.full) {
    // Scope is user-selected request data, never a model-inferred claim.
    const scope = evaluation.sections.join(", ") || "fit score only";
    // Only normalize the report header; matching text in the archived JD is data.
    const bodyStart = markdown.search(/^##\s|^---\s*$/m);
    const cut = bodyStart < 0 ? markdown.length : bodyStart;
    const header = markdown.slice(0, cut)
      .replace(/^\*\*Evaluation scope:\*\*[^\n]*\n?/gmi, "")
      .replace(/^(# .+)$/m, `$1\n\n**Evaluation scope:** Focused — ${scope}.`);
    markdown = header + markdown.slice(cut);
  }
  if (!ISO_DATE_RE.test(String(today ?? ""))) {
    return { ok: false, error: `Invalid evaluation date "${today}" — expected YYYY-MM-DD.` };
  }
  const meta = parseReportMeta(markdown);
  if (!meta.ok) return meta;

  const reserved = await spawnScript({
    spawnFn, execPath, root, script: "reserve-report-num.mjs",
  });
  if (!reserved.ok) {
    return { ok: false, error: `Could not reserve a report number: ${reserved.stderr || "reserve-report-num.mjs failed"}.` };
  }
  const num = reserved.stdout.trim();
  if (!/^\d{3,}$/.test(num)) {
    return { ok: false, error: `reserve-report-num.mjs returned an unusable number: "${num}".` };
  }

  const release = () => spawnScript({
    spawnFn, execPath, root, script: "reserve-report-num.mjs", args: ["--release", num],
  });

  // One release. A failed --release is not success: the sentinel would stay
  // held and the next evaluate could not take a number. When the save also
  // failed, both errors come back. When only the release failed, say the
  // report was saved.
  let released = false;
  const finish = async (error) => {
    if (!released) {
      released = true;
      const releasedResult = await release();
      if (!releasedResult.ok) {
        const releaseError = `The report reservation ${num} was not released: ${releasedResult.stderr || "reserve-report-num.mjs --release failed"}.`;
        if (error) return { ok: false, error: `${error} ${releaseError}` };
        return { ok: false, error: `The report was saved but the sentinel was not released. ${releaseError}` };
      }
    }
    if (error) return { ok: false, error };
    return null;
  };

  // A tab or newline in the URL would split the tracker row. Refuse before
  // any write, and release the number. Do not blank the URL and continue.
  if (tsvUnsafe(String(url ?? ""))) {
    return finish("The posting URL has a tab or newline, so the tracker row cannot be built.");
  }

  const slug = reportSlug(meta.company, meta.via);
  const reportFile = `${num}-${slug}-${today}.md`;
  // The backend owns the path. A slug of `..` cannot happen (slugify strips
  // non-alphanumerics) but a report written outside reports/ would be the
  // original hole this module exists to close — refuse rather than join.
  if (path.basename(reportFile) !== reportFile || reportFile.includes("..")) {
    return finish(`Refusing to write report "${reportFile}" — the filename is not a single path segment.`);
  }

  const reportsDir = path.join(root, "reports");
  const additionsDir = path.join(root, "batch", "tracker-additions");
  const reportPath = path.join(reportsDir, reportFile);
  const tsvPath = path.join(additionsDir, `${num}-${slug}.tsv`);
  if (path.dirname(reportPath) !== reportsDir || path.dirname(tsvPath) !== additionsDir) {
    return finish("Refusing to persist outside reports/ or batch/tracker-additions/.");
  }

  const postingUrl = /^https?:\/\//i.test(String(url ?? "")) ? String(url) : "";
  const notes = (ISO_DATE_RE.test(String(postedAt ?? "")) ? `; posted: ${postedAt}` : "")
    + (!evaluation.full ? `; Focused evaluation: ${evaluation.sections.join(", ") || "fit score only"}` : "");

  const written = await spawnScript({
    spawnFn, execPath, root,
    script: "persist-evaluation-report.mjs",
    input: JSON.stringify({
      markdown,
      num,
      today,
      company: meta.company,
      role: meta.role,
      score: meta.score,
      via: meta.via,
      url: postingUrl,
      notes,
      reportFile,
    }),
  });
  if (!written.ok) {
    return finish(written.stderr || "Could not save the evaluation report: persist-evaluation-report.mjs failed.");
  }

  const merged = await spawnScript({
    spawnFn, execPath, root, script: "merge-tracker.mjs",
  });
  if (!merged.ok) {
    return finish(`The report was saved but merge-tracker.mjs failed: ${merged.stderr || "non-zero exit"}.`);
  }
  const held = await finish(null);
  if (held) return held;
  const warnings = [];
  if (merged.stderr) warnings.push(merged.stderr);
  // Complete the discovery only after the report and tracker row were saved.
  // A direct URL evaluation may have no inbox entry. Failure here must not
  // turn a saved evaluation into a failed one; readInbox also reconciles
  // against the tracker, so an old checkbox cannot resurrect the posting.
  const pipelinePath = path.join(root, "data", "pipeline.md");
  if (postingUrl && fs.existsSync(pipelinePath)) {
    try {
      const completed = await setInboxSkip(pipelinePath, postingUrl, true, {
        lockModule: path.join(root, "pipeline-lock.mjs"),
      });
      if (!completed.ok && !["unmatched", "not-found"].includes(completed.error)) {
        warnings.push("Evaluation saved, but the inbox checkbox could not be updated.");
      }
    } catch {
      warnings.push("Evaluation saved, but the inbox checkbox could not be updated.");
    }
  }
  return { ok: true, num, reportFile, warnings };
}
