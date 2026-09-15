/**
 * report-tables.mjs — GFM table parse + STAR+R / Fit helpers for ReportView.
 * Keep this Node-importable (.mjs) so tests don't need a TS loader.
 */

/**
 * @param {string} line
 * @returns {string[]}
 */
export function pipeCells(line) {
  const t = String(line ?? "").trim();
  if (!t.startsWith("|")) return [];
  const inner = t.endsWith("|") ? t.slice(1, -1) : t.slice(1);
  return inner.split("|").map((c) => c.trim());
}

/**
 * @param {string[]} header
 * @returns {boolean}
 */
export function isStarTableHeader(header) {
  const n = (header || []).map((h) => String(h).trim().toLowerCase());
  if (n.length < 6) return false;
  const hasS = n.includes("s");
  const hasT = n.includes("t");
  const hasA = n.includes("a");
  const hasR = n.includes("r");
  const hasStar = n.some((h) => /star/.test(h));
  return hasStar && hasS && hasT && hasA && hasR;
}

/**
 * Fit-column labels from Block B. Short cells only — never color a prose cell
 * that happens to contain the word "strong".
 *
 * @param {unknown} text
 * @returns {"good" | "warn" | "bad" | "muted" | null}
 */
export function fitTone(text) {
  const raw = String(text ?? "").replace(/\*+/g, "").trim();
  if (!raw || raw.length > 48) return null;
  const t = raw.toLowerCase();
  if (/^gap\b/.test(t) || /^missing\b/.test(t) || /^fail/.test(t)) return "bad";
  if (/^strong\b/.test(t) || /^exceeds\b/.test(t) || /^excellent\b/.test(t)) return "good";
  if (/^adjacent\b/.test(t) || /^partial\b/.test(t) || /^adequate\b/.test(t) || /^ok\b/.test(t)) return "warn";
  return null;
}

/**
 * Split markdown into prose chunks and pipe-table chunks.
 *
 * @param {string} md
 * @returns {{ type: "md" | "table", text: string }[]}
 */
export function splitPipeTables(md) {
  const lines = String(md ?? "").split("\n");
  /** @type {{ type: "md" | "table", text: string }[]} */
  const out = [];
  /** @type {string[]} */
  let buf = [];
  /** @type {string[]} */
  let table = [];
  const flushMd = () => {
    const text = buf.join("\n");
    if (text.trim()) out.push({ type: "md", text });
    buf = [];
  };
  const flushTable = () => {
    if (table.length) out.push({ type: "table", text: table.join("\n") });
    table = [];
  };
  const isTableLine = (l) => /^\s*\|/.test(l);
  for (const line of lines) {
    if (isTableLine(line)) {
      if (buf.length) flushMd();
      table.push(line);
    } else {
      if (table.length) flushTable();
      buf.push(line);
    }
  }
  if (table.length) flushTable();
  flushMd();
  return out;
}

/**
 * @param {string} block
 * @returns {{ header: string[], rows: string[][] } | null}
 */
export function parsePipeTable(block) {
  const lines = String(block ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  if (lines.length < 2) return null;
  const header = pipeCells(lines[0]);
  if (!header.length) return null;
  const start = /^\s*\|?\s*:?-{3,}/.test(lines[1]) ? 2 : 1;
  const rows = lines.slice(start).map(pipeCells).filter((r) => r.some((c) => c.length));
  return { header, rows };
}

/**
 * @param {string[]} header
 * @param {string[]} names
 * @returns {number}
 */
export function colIndex(header, names) {
  const n = header.map((h) => String(h).trim().toLowerCase());
  for (const name of names) {
    const want = name.toLowerCase();
    // Single-letter STAR cols must be exact: "s" must not match "STAR+R story".
    const i = n.findIndex((h) => (want.length <= 2 ? h === want : h === want || h.includes(want)));
    if (i >= 0) return i;
  }
  return -1;
}
