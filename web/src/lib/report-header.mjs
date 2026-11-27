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
 * SILENTLY (see the `continue` in readReport). That is why this map has to
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
  datum: "Date", // de, nl
  tarih: "Date", // tr
  tanggal: "Date", // id
  дата: "Date", // ru, ua
  // URL — identical in every mode
  url: "URL",
  // Archetype
  archetype: "Archetype",
  arquetipo: "Archetype", // es
  "arquétipo": "Archetype", // pt
  archetyp: "Archetype", // pl, de
  archetipo: "Archetype", // it
  arketip: "Archetype", // tr
  arketipe: "Archetype", // id
  arketype: "Archetype", // da
  архетип: "Archetype", // ru, ua
  // Score
  score: "Score",
  балл: "Score", // ru
  бал: "Score", // ua
  puan: "Score", // tr
  punteggio: "Score", // it
  // Legitimacy
  legitimacy: "Legitimacy",
  legitimidad: "Legitimacy", // es, legacy reports
  "легітимність": "Legitimacy", // ua
  "meşruiyet": "Legitimacy", // tr
  // PDF — identical in every mode
  pdf: "PDF",
  "evaluation scope": "Evaluation scope",
};

const DECISION_LABELS = {
  decision: "Decision",
  القرار: "Decision",
  beslutning: "Decision",
  entscheidung: "Decision",
  decisión: "Decision",
  décision: "Decision",
  निर्णय: "Decision",
  keputusan: "Decision",
  decisione: "Decision",
  決定: "Decision",
  결정: "Decision",
  beslissing: "Decision",
  decyzja: "Decision",
  decisão: "Decision",
  решение: "Decision",
  karar: "Decision",
  рішення: "Decision",
  "quyết định": "Decision",
  决定: "Decision",
};

function lookup(key) {
  if (Object.hasOwn(DECISION_LABELS, key)) return DECISION_LABELS[key];
  if (Object.hasOwn(FIELD_KEYS, key)) return FIELD_KEYS[key];
  return undefined;
}

function fieldName(raw) {
  const trimmed = raw.trim();
  // A Turkish report written in capitals (`**MEŞRUİYET:**`) lowercases its
  // dotted İ to `i` plus a combining dot under the default locale, which no key
  // matches. The Turkish-aware fallback only runs when the plain lookup misses,
  // so English labels keep the default rules (`TITLE` stays `title`, not `tıtle`).
  return lookup(trimmed.toLowerCase()) ?? lookup(trimmed.toLocaleLowerCase("tr"));
}

function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function readReport(md) {
  const normalized = normalizeNewlines(md);
  const lines = normalized.split("\n");
  let cut = lines.findIndex((l, i) => i > 0 && (/^\s*-{3,}\s*$/.test(l) || /^##\s/.test(l)));
  if (cut === -1) {
    // No section break. Keep a leading title and **Field:** lines as the
    // header, and leave the rest of the file in the body. A hard stop at
    // line 10 dropped the opening of a report that has neither rule.
    cut = 0;
    while (cut < lines.length) {
      const line = lines[cut];
      if (line.trim() === "" || /^#\s+/.test(line) || /^\s*\*\*.+?:\*\*/.test(line)) {
        cut += 1;
        continue;
      }
      break;
    }
  }

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
      // The prefix needs its delimiter (`Evaluation:`, `Evaluation :`,
      // `Evaluation — `), or `# Evaluation Engineer` would lose half its title.
      title = h[1].replace(/^Evalua[tc]i[oó]n(?:\s*:|\s+(?:—|–|--?)(?=\s))\s*/i, "").trim();
      continue;
    }
    const m = l.match(/^\s*\*\*(.+?):\*\*\s*(.*)$/);
    if (!m) continue;
    const label = fieldName(m[1]);
    const value = m[2].trim();
    if (!label || !value) continue;
    if (label === "Legitimacy") legitimacy = value;
    fields.push({ label, value });
  }

  return { title, fields, legitimacy, body: body || normalized };
}

/** Same parser under the name the label tests import. */
export const parseReport = readReport;
