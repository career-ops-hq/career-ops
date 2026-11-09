import { splitSections } from "./report-sections.mjs";
import { parsePipeTable } from "./report-tables.mjs";

export const COMPARE_MAX = 3;

/**
 * Application numbers from `?n=220,199,100`, distinct and in order, capped at
 * COMPARE_MAX so the columns stay readable.
 *
 * @param {string | string[] | undefined} raw
 * @returns {string[]}
 */
export function compareIds(raw) {
  const parts = (Array.isArray(raw) ? raw : [raw ?? ""]).flatMap((p) => String(p).split(","));
  const ids = [...new Set(parts.map((p) => p.trim()).filter((p) => /^\d+$/.test(p)))];
  return ids.slice(0, COMPARE_MAX);
}

/**
 * The field/value rows of the first two-column table in a report body. That
 * table is the Role Summary (remote, comp, TL;DR) in the shipped report modes.
 *
 * @param {string} body
 * @returns {{ label: string, value: string }[]}
 */
export function summaryFields(body) {
  const strip = (s) => String(s ?? "").replace(/\*\*/g, "").trim();
  const tables = splitSections(body).sections.flatMap((s) => s.content.split(/\n(?![ \t]*\|)/).map(parsePipeTable));
  const table = tables.find((t) => t?.header.length === 2);
  if (!table) return [];
  return table.rows.map(([label, value]) => ({ label: strip(label), value: strip(value) })).filter((f) => f.label);
}
