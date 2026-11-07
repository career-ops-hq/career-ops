import { reportNumberFromCell } from "./apply/cv-selection.mjs";

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

/**
 * Company and role for a generated PDF. Prefer the tracker row whose report
 * cell points at this report. A row number is used only when that row has
 * no report link, because row numbers and report numbers drift apart.
 *
 * @param {Array<{ n?: string, company?: string, role?: string, report?: string }> | undefined} applications
 * @param {string | number | null | undefined} reportId
 */
export function namesForReport(applications, reportId) {
  const rows = Array.isArray(applications) ? applications : [];
  const byReport = rows.find((row) => sameNumber(reportNumberFromCell(row?.report), reportId));
  const row = byReport
    || rows.find((item) => reportNumberFromCell(item?.report) == null && sameNumber(item?.n, reportId));
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
