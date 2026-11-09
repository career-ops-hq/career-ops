/**
 * The Pipeline tracker rows as a CSV file, the same columns as
 * `tracker.mjs query --csv` plus the optional tracker columns the CLI index
 * does not keep. No Node imports: the pipeline table is a client component.
 */

import { firstMarkdownLinkTarget, postingHref } from "./posting-url.mjs";

/** @typedef {import("./career-ops").Application} Application */

/** @type {{ name: string, read: (row: Application) => string | number, optional?: boolean }[]} */
const COLUMNS = [
  { name: "id", read: (r) => r.n },
  { name: "date", read: (r) => r.date },
  { name: "company", read: (r) => r.company },
  { name: "role", read: (r) => r.role },
  { name: "score", read: (r) => score(r.score) },
  { name: "status", read: (r) => r.status },
  { name: "location", read: (r) => r.location, optional: true },
  { name: "via", read: (r) => r.via, optional: true },
  { name: "url", read: (r) => postingHref(r.url), optional: true },
  { name: "pdf", read: (r) => (r.pdf.includes("✅") ? "yes" : "no") },
  { name: "report", read: (r) => report(r.report) },
  { name: "notes", read: (r) => r.notes },
];

// Same rule as `tracker.mjs query --csv`: a score such as `4.2/5`, `4,2/5`, or
// `4.2 (strong fit)` becomes a number, and any other cell, such as `N/A`, stays empty.
function score(cell) {
  const m = String(cell ?? "").replace(/\*\*/g, "").trim().match(/^(\d+(?:[.,]\d+)?)(?:\/5)?(?:\s.*)?$/);
  return m ? Number(m[1].replace(",", ".")) : "";
}

function report(cell) {
  const text = String(cell ?? "").trim();
  return firstMarkdownLinkTarget(text) ?? (text === "—" || text === "-" ? "" : text);
}

// A leading `'` stops a spreadsheet from running the cell as a formula. Same
// rule as lib/tsv-formula-escape.mjs, which this package cannot import.
function field(value) {
  const text = String(value ?? "");
  const cell = /^'*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/**
 * @param {Application[]} rows - In the order the table shows them.
 * @returns {string} UTF-8 CSV text with a byte order mark, so Excel reads
 *   accented names correctly.
 */
export function trackerCsv(rows) {
  const columns = COLUMNS.filter((c) => !c.optional || rows.some((r) => String(c.read(r)) !== ""));
  const lines = [columns.map((c) => c.name).join(",")];
  for (const r of rows) lines.push(columns.map((c) => field(c.read(r))).join(","));
  return `\uFEFF${lines.join("\n")}\n`;
}

/**
 * @param {string} tab - The Pipeline tab, such as `EVALUATED`.
 * @param {Date} now
 * @returns {string}
 */
export function trackerCsvFilename(tab, now) {
  const pad = (n) => String(n).padStart(2, "0");
  return `career-ops-${tab.toLowerCase()}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
