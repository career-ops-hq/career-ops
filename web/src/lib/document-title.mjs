import { firstMarkdownLinkTarget } from "./posting-url.mjs";

function clean(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text === "—" || text === "-" || text === "–") return "";
  return text;
}

function sameNumber(left, right) {
  if (left == null || right == null || left === "" || right === "") return false;
  const a = String(left).replace(/^0+(?=\d)/, "");
  const b = String(right).replace(/^0+(?=\d)/, "");
  return /^\d+$/.test(a) && a === b;
}

function kindLabel(kind) {
  if (kind === "cv") return "Tailored CV";
  if (kind === "cover") return "Cover letter";
  return "Document";
}

/**
 * @param {{ kind?: string, company?: string, role?: string, filename?: string }} doc
 * @returns {{ title: string, filename: string }}
 */
export function documentDisplayTitle(doc) {
  const label = kindLabel(doc?.kind);
  const subject = [clean(doc?.company), clean(doc?.role)].filter(Boolean).join(", ");
  return {
    title: subject ? `${label} — ${subject}` : label,
    filename: String(doc?.filename ?? ""),
  };
}

function reportFileNumber(cell) {
  const target = firstMarkdownLinkTarget(cell);
  if (!target) return null;
  const base = target.split(/[?#]/, 1)[0].split(/[\\/]/).filter(Boolean).pop() ?? "";
  const match = /^(\d+)(?:-.+)?\.md$/i.exec(base);
  return match ? match[1] : null;
}

/**
 * Company and role for a generated PDF. The report number is the one in the
 * link target's filename, not the number in the label.
 * `[5](../reports/006-globex.md)` is report 6. A row number is used only when
 * that row has no report link, because row numbers and report numbers drift apart.
 *
 * @param {Array<{ n?: string, company?: string, role?: string, report?: string }> | undefined} applications
 * @param {string | number | null | undefined} reportId
 */
export function namesForReport(applications, reportId) {
  const rows = Array.isArray(applications) ? applications : [];
  const byReport = rows.find((row) => sameNumber(reportFileNumber(row?.report), reportId));
  const row = byReport
    || rows.find((item) => reportFileNumber(item?.report) == null && sameNumber(item?.n, reportId));
  return {
    company: row?.company || "",
    role: row?.role || "",
  };
}

/**
 * @param {{ kind?: string, filename?: string, reportId?: string | null }} doc
 * @param {Array<{ n?: string, company?: string, role?: string, report?: string }> | undefined} applications
 */
export function presentDocument(doc, applications) {
  const names = namesForReport(applications, doc?.reportId);
  const display = documentDisplayTitle({
    kind: doc?.kind,
    company: names.company,
    role: names.role,
    filename: doc?.filename,
  });
  return {
    ...doc,
    company: names.company,
    role: names.role,
    title: display.title,
  };
}
