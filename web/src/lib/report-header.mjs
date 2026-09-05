/**
 * Report header parsing: the `**Label:** value` block above the first section.
 *
 * Plain .mjs, no `@/` alias, so `node --test` can import it with no build step
 * — the same reason tracker-table.mjs and cv-selection.mjs live this way. It
 * was inside format.ts, which imports through the alias, so the label map that
 * decides whether a user sees their Archetype had no test at all.
 *
 * Untyped on purpose: the ReportMeta shape is declared once at the TS boundary
 * in format.ts, the way career-ops.ts declares Application over this same
 * pattern. Two declarations of one shape is how they drift.
 */

/**
 * Report header labels, mapped to the canonical field the UI renders.
 *
 * The lookup is exact on the lowercased label, so an unlisted form is dropped
 * SILENTLY (see the `continue` in parseReport). That is why this map has to
 * carry every form actually in circulation rather than the ones we remember:
 * a Russian user's report was losing Archetype, Score and Date, and a
 * Portuguese one Archetype and Date, with no error anywhere. `arquetipo` was
 * listed and `arquétipo` was not, which is the whole failure in one accent.
 *
 * Every non-English form below is dictated by a localized oferta.md in this
 * repo, named in the comment. None is a translation we invented: inventing one
 * would add a key no report ever carries while the real one keeps being lost.
 *
 * The list stops growing here. The i18n re-sync (#3669) freezes report header
 * labels as literal English in every localized mode, the way zh and zh-TW
 * already do, so new markets need no entry. What stays is the rescue path for
 * reports ALREADY generated under the old modes, which no upstream rule reaches.
 */
const FIELD_KEYS = {
  // Date
  date: "Date",
  fecha: "Date", // es
  data: "Date", // pl, pt
  dato: "Date", // da
  дата: "Date", // ru, ua
  // URL — identical in every mode
  url: "URL",
  // Archetype
  archetype: "Archetype",
  arquetipo: "Archetype", // es
  "arquétipo": "Archetype", // pt
  archetyp: "Archetype", // pl
  arketype: "Archetype", // da
  архетип: "Archetype", // ru, ua
  // Score
  score: "Score",
  балл: "Score", // ru
  бал: "Score", // ua
  // Legitimacy
  legitimacy: "Legitimacy",
  legitimidad: "Legitimacy", // es, legacy reports
  "легітимність": "Legitimacy", // ua
  // PDF — identical in every mode
  pdf: "PDF",
};

/**
 * Tolerant report parser (per maintainer: adapt the render, don't migrate the
 * old data). Extracts the bold key/value header fields (Date/URL/Archetype/
 * Score/Legitimacy/PDF) when present and returns the body without the header
 * block. Degrades gracefully on legacy reports that lack some fields.
 */
export function parseReport(md) {
  const lines = md.split("\n");
  // Header runs until the first `---` or the first `## ` section.
  let cut = lines.findIndex((l, i) => i > 0 && (/^\s*-{3,}\s*$/.test(l) || /^##\s/.test(l)));
  if (cut === -1) cut = Math.min(lines.length, 10);

  const headerLines = lines.slice(0, cut);
  let bodyStart = cut;
  if (/^\s*-{3,}\s*$/.test(lines[cut] ?? "")) bodyStart = cut + 1;
  const body = lines.slice(bodyStart).join("\n").trim();

  let title = null;
  let legitimacy = null;
  const fields = [];

  for (const l of headerLines) {
    const h = l.match(/^#\s+(.+)/);
    if (h) {
      title = h[1].replace(/^Evaluat?i[oó]n:?\s*/i, "").trim();
      continue;
    }
    const m = l.match(/^\s*\*\*(.+?):\*\*\s*(.*)$/);
    if (!m) continue;
    const label = FIELD_KEYS[m[1].trim().toLowerCase()];
    const value = m[2].trim();
    if (!label || !value) continue;
    if (label === "Legitimacy") legitimacy = value;
    fields.push({ label, value });
  }

  return { title, fields, legitimacy, body: body || md };
}
