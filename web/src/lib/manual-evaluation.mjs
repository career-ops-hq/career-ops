import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SOURCE_FILES = [
  "modes/_shared.md",
  "modes/oferta.md",
  "cv.md",
  "config/profile.yml",
  "modes/_profile.md",
];
const OPTIONAL_SOURCE_FILES = ["modes/_custom.md"];
const ALLOWED_KEYS = ["company", "role", "location", "compensation", "score", "recommendation", "trackerNote", "reportMarkdown", "verdictReason"];

export function loadManualEvaluationSources(root) {
  const sources = {};
  for (const relative of SOURCE_FILES) {
    const value = fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
    if (!value.trim()) throw new Error(`Manual evaluation source ${relative} is empty.`);
    sources[relative] = value;
  }
  for (const relative of OPTIONAL_SOURCE_FILES) {
    try {
      const value = fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
      if (value.trim()) sources[relative] = value;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return sources;
}

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const heading = (letter) => new RegExp(`^##\\s+(?:Block\\s+)?${letter}(?:\\)|\\.|:|\\s+(?:—|–|-{1,2}))`, "mi");

export function validateManualEvaluationContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Manual evaluation output must be one JSON object." };
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !ALLOWED_KEYS.includes(key));
  if (unknown.length) return { ok: false, error: `Manual evaluation contains unexpected field "${unknown[0]}".` };
  const missing = ALLOWED_KEYS.filter((key) => !(key in value));
  if (missing.length) return { ok: false, error: `Manual evaluation is missing required field "${missing[0]}".` };
  for (const key of ["company", "role", "trackerNote", "reportMarkdown", "verdictReason"]) {
    if (!nonEmpty(value[key])) return { ok: false, error: `Manual evaluation field "${key}" is empty.` };
  }
  if (typeof value.location !== "string" || typeof value.compensation !== "string") return { ok: false, error: "Manual evaluation location and compensation must be strings." };
  if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 5) return { ok: false, error: "Manual evaluation score must be a number from 0 to 5." };
  if (!new Set(["Apply", "Consider", "Skip"]).has(value.recommendation)) return { ok: false, error: "Manual evaluation recommendation must be Apply, Consider, or Skip." };
  if (value.trackerNote.length > 300 || /[\t\r\n]/.test(value.trackerNote)) return { ok: false, error: "Manual evaluation trackerNote must be one line of 300 characters or fewer." };
  if (value.verdictReason.length > 160 || /[\t\r\n]/.test(value.verdictReason)) return { ok: false, error: "Manual evaluation verdictReason must be one concise line." };
  const report = value.reportMarkdown;
  if (report.length < 800) return { ok: false, error: "Manual evaluation report is incomplete." };
  if (/{{[^}]+}}/.test(report)) return { ok: false, error: "Manual evaluation report contains unresolved placeholders." };
  if (!/^##\s+Machine Summary\s*$/mi.test(report)) return { ok: false, error: "Manual evaluation report is missing Machine Summary." };
  for (const letter of ["A", "B", "C", "D", "E", "F", "G"]) {
    if (!heading(letter).test(report)) return { ok: false, error: `Manual evaluation report is missing Block ${letter}.` };
  }
  return { ok: true, content: value };
}

export function parseManualEvaluationJson(text) {
  let value;
  try { value = JSON.parse(String(text || "").trim()); }
  catch { return { ok: false, error: "Codex did not return valid structured manual-evaluation JSON." }; }
  return validateManualEvaluationContent(value);
}

export function slugifyManualCompany(value) {
  return String(value || "company").toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "company";
}

const cleanTsv = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();

export function persistManualEvaluation({ root, today, job, content, runNode = defaultRunNode }) {
  const reserved = runNode(root, "reserve-report-num.mjs", []);
  const reportNum = String(reserved).match(/\b\d{3,}\b/)?.[0];
  if (!reportNum) throw new Error("Career-Ops could not reserve a report number.");
  const slug = slugifyManualCompany(content.company);
  const reportRelative = `reports/${reportNum}-${slug}-${today}.md`;
  const reportPath = path.join(root, ...reportRelative.split("/"));
  const additionsDir = path.join(root, "batch", "tracker-additions");
  const additionPath = path.join(additionsDir, `${reportNum}-${slug}.tsv`);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.mkdirSync(additionsDir, { recursive: true });
  const report = content.reportMarkdown.endsWith("\n") ? content.reportMarkdown : `${content.reportMarkdown}\n`;
  try {
    fs.writeFileSync(reportPath, report, { encoding: "utf8", flag: "wx" });
    const noteParts = [content.trackerNote];
    if (job.postedAt) noteParts.push(`POSTED:${job.postedAt}`);
    const row = [reportNum, today, content.company, content.role, "Evaluated", `${content.score}/5`, "❌", `[${reportNum}](${reportRelative})`, noteParts.join(" | "), job.url || ""]
      .map(cleanTsv).join("\t") + "\n";
    fs.writeFileSync(additionPath, row, { encoding: "utf8", flag: "wx" });
    runNode(root, "merge-tracker.mjs", []);
    if (!fs.existsSync(reportPath)) throw new Error("Career-Ops report persistence could not be verified.");
    const tracker = fs.readFileSync(path.join(root, "data", "applications.md"), "utf8");
    if (!tracker.includes(`[${reportNum}](${reportRelative})`)) throw new Error("Career-Ops tracker persistence could not be verified.");
    return { reportNum, reportPath, reportRelative };
  } finally {
    try { runNode(root, "reserve-report-num.mjs", ["--release", reportNum]); } catch { /* reservation GC remains the fallback */ }
  }
}

function defaultRunNode(root, script, args) {
  return execFileSync(process.execPath, [path.join(root, script), ...args], { cwd: root, encoding: "utf8", windowsHide: true });
}

