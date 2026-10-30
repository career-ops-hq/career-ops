/**
 * Pure helpers for /pipeline/[id]/apply.
 * Server and node tests only. The client component receives the results.
 */
import path from "node:path";
import { pdfIndexEntryForReport, reportNumberFromCell } from "./apply/cv-selection.mjs";

const EXPERIENCE_RE = /^(?:(?:work|professional)\s+)?experience$|^(?:employment|work)\s+history$/i;
const EDUCATION_RE = /^education\b/i;

export const PORTAL_TIPS = [
  {
    portal: "Workday",
    tip: "Create an account on that company's Workday site first. The session expires, so keep the tab open while you paste.",
  },
  {
    portal: "iCIMS",
    tip: "Create an account first. The form does not keep a draft without one.",
  },
  {
    portal: "Greenhouse",
    tip: "No account. Upload the PDF, then paste the fields below.",
  },
  {
    portal: "Lever",
    tip: "No account. The form is one page.",
  },
  {
    portal: "Ashby",
    tip: "No account. The form is short.",
  },
];

function heading(line) {
  const match = /^(#{1,6})\s+(.*)$/.exec(String(line ?? "").trim());
  if (!match) return null;
  return { level: match[1].length, text: plain(match[2]) };
}

function plain(text) {
  return String(text ?? "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function plainBlock(lines) {
  const out = [];
  for (const line of lines) {
    const h = heading(line);
    const text = h ? h.text : plain(String(line).replace(/^\s*[-*]\s+/, ""));
    if (!text) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(text);
  }
  return out.join("\n").trim();
}

function jobBlocks(lines) {
  const jobs = [];
  let label = "";
  let buf = [];
  let started = false;
  const flush = () => {
    if (!started) return;
    const body = plainBlock(buf);
    const text = [label, body].filter(Boolean).join("\n");
    if (text) jobs.push({ label: label || "Role", text });
    buf = [];
  };
  for (const line of lines) {
    const h = heading(line);
    if (h && h.level === 3) {
      flush();
      label = h.text;
      started = true;
      continue;
    }
    if (h && h.level <= 2) break;
    buf.push(line);
    if (line.trim()) started = true;
  }
  flush();
  return jobs;
}

function sectionBody(cvText, test) {
  const lines = String(cvText ?? "").replace(/\r\n/g, "\n").split("\n");
  let capture = false;
  const body = [];
  for (const line of lines) {
    const h = heading(line);
    if (h && h.level === 2) {
      if (capture) break;
      capture = test(h.text);
      continue;
    }
    if (h && h.level === 1 && capture) break;
    if (capture) body.push(line);
  }
  return body;
}

/** Work history as one plain block per role, and education as one block. */
export function cvCopyFields(cvText) {
  const workLines = sectionBody(cvText, (title) => EXPERIENCE_RE.test(title));
  const educationLines = sectionBody(cvText, (title) => EDUCATION_RE.test(title));
  return {
    work: jobBlocks(workLines),
    education: plainBlock(educationLines),
  };
}

function pushItem(items, label, text) {
  const value = String(text ?? "").trim();
  if (!value) return;
  items.push({ label: String(label || "Answer").trim() || "Answer", text: value });
}

/**
 * Copy targets from parseApplicationAnswersSection().
 * The text is the answer, selection, or file path. Empty values are skipped.
 * @param {object | null} snapshot
 */
export function answerCopyItems(snapshot) {
  if (!snapshot) return [];
  const items = [];
  for (const entry of snapshot.freeText ?? []) pushItem(items, entry.question, entry.answer);
  for (const entry of snapshot.selections ?? []) pushItem(items, entry.question, entry.selection);
  for (const entry of snapshot.fieldValues ?? []) pushItem(items, entry.question || entry.field, entry.answer ?? entry.value);
  for (const entry of snapshot.files ?? []) pushItem(items, entry.field || entry.question, entry.path);
  return items;
}

/**
 * Report number for pdf-index and mark-pdf-ready.
 * The page id is a tracker row number, which is a different counter.
 * @param {string} id
 * @param {{ report?: string } | null} app
 * @param {string | null} reportFile
 * @returns {number | null}
 */
export function reportNumberFor(id, app, reportFile) {
  const fromCell = app ? reportNumberFromCell(app.report) : null;
  if (fromCell != null) return fromCell;
  if (reportFile) {
    const n = parseInt(reportFile, 10);
    if (Number.isInteger(n)) return n;
  }
  if (!app && /^\d+$/.test(String(id ?? ""))) return Number(id);
  return null;
}

/**
 * A pdf-index row whose file is under output/ and exists.
 * relativePath is workspace-relative, never an absolute home path.
 * @param {string} indexText
 * @param {number} reportNumber
 * @param {"cv" | "cover"} kind
 * @param {string} root
 * @param {(abs: string) => boolean} fileExists
 * @returns {{ relativePath: string, absolutePath: string } | null}
 */
export function indexedPdf(indexText, reportNumber, kind, root, fileExists) {
  const entry = pdfIndexEntryForReport(indexText, reportNumber, kind);
  if (!entry.found || !entry.path) return null;
  const stored = String(entry.path).trim();
  if (!stored || path.isAbsolute(stored)) return null;
  const abs = path.resolve(root, stored);
  const outputDir = path.resolve(root, "output");
  if (abs !== outputDir && !abs.startsWith(outputDir + path.sep)) return null;
  if (typeof fileExists !== "function" || !fileExists(abs)) return null;
  const relativePath = path.relative(root, abs).split(path.sep).join("/");
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return { relativePath, absolutePath: abs };
}
