/**
 * report-persist.mjs — persist a web evaluate run's report + tracker row.
 *
 * The evaluate agent used to hold Write + Bash so it could run
 * reserve-report-num.mjs, write reports/, write a TSV, and merge-tracker.mjs.
 * Those tools are unscoped, so a posting in its context could aim them anywhere.
 * The agent now emits the report in a <<report-md>> envelope; this module (a
 * plain Node process, no CLI sandbox) is the only writer — same split #2185
 * used for pdf.
 *
 * spawnFn / execPath / root are injected so tests substitute a fake child
 * process and never touch the real allocator or tracker.
 */
import fs from "node:fs";
import path from "node:path";

/** Lowercase, non-alphanumeric runs -> single hyphen, trimmed. Same rule as pdf-paths.mjs. */
function slugify(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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
 * Score as the tracker writes it (`X.X/5`). Null if the value is not a number.
 * @param {string|null} raw
 * @returns {string|null}
 */
export function formatScore(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d+(?:\.\d+)?\/5$/.test(s)) return s.includes(".") ? s : `${s.slice(0, -2)}.0/5`;
  const n = Number(s);
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
 * One tracker-additions TSV line (tab-separated, trailing newline). Always 10
 * fields with the posting URL last — empty when there is none, never "N/A".
 * A tagged `via={Agency}` extra sits between notes and URL when present.
 *
 * @param {{num: string, today: string, company: string, role: string, score: string, reportFile: string, notes: string, via: string|null, url: string}} row
 * @returns {string}
 */
export function trackerTsvLine({ num, today, company, role, score, reportFile, notes, via, url }) {
  const fields = [
    num, today, company, role, "Evaluated", score, "❌",
    `[${num}](reports/${reportFile})`, notes,
  ];
  if (via) fields.push(`via=${via}`);
  fields.push(url);
  return `${fields.join("\t")}\n`;
}

function spawnScript({ spawnFn, execPath, root, script, args = [] }) {
  return new Promise((resolve) => {
    const child = spawnFn(execPath, [path.join(root, script), ...args], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => { stdout += d.toString(); });
    child.stderr?.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on("error", (e) => resolve({ ok: false, stdout: "", stderr: `${script} failed to start: ${e.message}` }));
  });
}

/**
 * Reserve a report number, write the report + TSV, merge the tracker, release
 * the sentinel. Never throws: the caller routes `{ok:false}` through the same
 * honesty gate as every other evaluate failure.
 *
 * @param {{spawnFn: Function, execPath: string, root: string, markdown: string, url: string, today: string, postedAt?: string}} args
 * @returns {Promise<{ok: true, num: string, reportFile: string, warnings: string[]} | {ok: false, error: string}>}
 */
export async function persistEvaluation({ spawnFn, execPath, root, markdown, url, today, postedAt }) {
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

  const slug = reportSlug(meta.company, meta.via);
  const reportFile = `${num}-${slug}-${today}.md`;
  // The backend owns the path. A slug of `..` cannot happen (slugify strips
  // non-alphanumerics) but a report written outside reports/ would be the
  // original hole this module exists to close — refuse rather than join.
  if (path.basename(reportFile) !== reportFile || reportFile.includes("..")) {
    await release();
    return { ok: false, error: `Refusing to write report "${reportFile}" — the filename is not a single path segment.` };
  }

  const reportsDir = path.join(root, "reports");
  const additionsDir = path.join(root, "batch", "tracker-additions");
  const reportPath = path.join(reportsDir, reportFile);
  const tsvPath = path.join(additionsDir, `${num}-${slug}.tsv`);
  if (path.dirname(reportPath) !== reportsDir || path.dirname(tsvPath) !== additionsDir) {
    await release();
    return { ok: false, error: "Refusing to persist outside reports/ or batch/tracker-additions/." };
  }

  const postingUrl = /^https?:\/\//i.test(String(url ?? "")) ? String(url) : "";
  const notes = ISO_DATE_RE.test(String(postedAt ?? "")) ? `; posted: ${postedAt}` : "";

  try {
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.mkdirSync(additionsDir, { recursive: true });
    fs.writeFileSync(reportPath, markdown, "utf8");
    fs.writeFileSync(tsvPath, trackerTsvLine({
      num, today, company: meta.company, role: meta.role, score: meta.score,
      reportFile, notes, via: meta.via, url: postingUrl,
    }), "utf8");
  } catch (err) {
    await release();
    return { ok: false, error: `Could not save the evaluation report: ${err.message}` };
  }

  const merged = await spawnScript({
    spawnFn, execPath, root, script: "merge-tracker.mjs",
  });
  await release();
  if (!merged.ok) {
    return { ok: false, error: `The report was saved but merge-tracker.mjs failed: ${merged.stderr || "non-zero exit"}.` };
  }
  const warnings = [];
  if (merged.stderr) warnings.push(merged.stderr);
  return { ok: true, num, reportFile, warnings };
}
