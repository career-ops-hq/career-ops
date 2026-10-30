/**
 * report-sections.mjs — splitting a report body into its author-lettered
 * sections, and cleaning those headings for display.
 *
 * Plain .mjs (same pattern as clean-chips.mjs) so test-report-sections.mjs can
 * import it directly under Node, and so the two places that used to hard-code
 * the author-letter range can no longer drift apart: they were written as
 * `[A-G]` in report-view.tsx, which silently mis-handled `## H) Draft
 * Application Answers` — the heading rendered with its letter still attached
 * while every other section rendered clean, and splitSections reported
 * `letter: null` for it (#2324).
 *
 * The range is now any single letter. The `)` / `.` / `:` delimiter is what
 * keeps this from eating ordinary prose ("A Recommendation Was Requested"),
 * not the narrowness of the range — so widening it costs no safety, and a
 * block added past H is handled the day the core writes it.
 */

/**
 * Strips the prefix for display. A BARE letter needs a real delimiter, never a
 * bare space, or ordinary prose loses its first word ("A Recommendation Was
 * Requested" → "Recommendation Was Requested").
 *
 * After `Block` the whitespace form is allowed, because the word itself is the
 * disambiguator: "## Block A — Role Summary" (oferta.md:47) is unmistakably a
 * lettered heading. HEADING_LETTER below already reads that grammar as section
 * A, so leaving the prefix in the rendered heading made this file classify a
 * heading one way and display it another (CodeRabbit review).
 *
 * The separator is a RUN of dashes, not one character: modes/ja/kyujin.md and
 * modes/hi/naukri.md write the ASCII "## Block A -- Role Summary", which left a
 * stray "- " on every block of every report those modes produce.
 */
const HEADING_PREFIX = /^\s*(?:Block\s+([A-Z])(?:[).:]\s*|\s+(?:[—–-]+\s*)?)|([A-Z])[).:]\s*)/i;

/**
 * Reads the letter. A bare letter needs a delimiter, exactly like the display
 * form above — otherwise "A Recommendation Was Requested" is read as section A
 * and ReportView expands ordinary prose as if it were Block A.
 *
 * The whitespace form is kept for the spelled-out grammar only: oferta.md
 * writes "## Block A — Role Summary", where nothing follows the letter but a
 * space. Requiring a delimiter there would lose the F verdict callout and the
 * A/B expansion on those reports.
 */
const HEADING_LETTER = /^(?:Block\s+([A-Z])(?:[).:]|\s)|([A-Z])[).:])/i;

/**
 * @typedef {{ heading: string, letter: string | null, content: string }} Section
 */

/**
 * Display form of a section heading: author-letter prefix and the trailing
 * "(lead)" / "(verdict)" marker removed. Falls back to the original when
 * stripping would leave nothing.
 * @param {string} h
 * @returns {string}
 */
import { isStarTableHeader, parsePipeTable } from "./report-tables.mjs";

export function cleanHeading(h) {
  const stripped = h
    .replace(HEADING_PREFIX, "")
    .replace(/\s*\((?:lead|verdict)\)\s*$/i, "")
    .trim();
  return stripped || h.trim();
}

/**
 * The author letter of a heading, uppercased, or null when it carries none.
 * @param {string} heading
 * @returns {string | null}
 */
export function authorLetter(heading) {
  const match = heading.match(HEADING_LETTER);
  return (match?.[1] ?? match?.[2])?.toUpperCase() ?? null;
}

/**
 * Whether a heading marks the block the viewer should lead with as a Verdict
 * callout.
 *
 * The letter is NOT the signal. `report-view.tsx` used to read "whatever is
 * lettered F" as the verdict, but no mode has ever written a Verdict block:
 * the callout landed in #1535 when `modes/oferta.md` already read
 * `## F) Interview Plan`, so every report has rendered the Interview Plan
 * table into a callout built for one sentence (#3416). All eighteen localized
 * modes write Interview Plan at F too, so this was never an English-only slip.
 * Counted by the property rather than the filename — `grep -rlE "^## F\\)" modes/`
 * returns 19 (18 localized + canonical). Only eight of those are named
 * `oferta.md`; the rest are `fursah.md`, `angebot.md`, `offre.md`, `naukri.md`,
 * `lowongan.md`, `annuncio.md`, `kyujin.md`, `gonggo.md`, `vacature.md`,
 * `is-ilani.md`. A sweep by expected filename misses exactly those.
 *
 * The marker is what the core actually promises: `cleanHeading` has always
 * stripped a trailing `(lead)` / `(verdict)`, which is a deliberate authoring
 * signal and is language-independent — a Spanish `## F) Veredicto (lead)`
 * reads the same as an English one. The bare English word is accepted as well
 * so a block titled plainly `## Verdict` is not missed.
 *
 * When nothing matches, there is no callout and every block renders through
 * the normal progressive disclosure — which is the correct outcome today.
 * @param {string} heading
 * @returns {boolean}
 */
export function isVerdictHeading(heading) {
  if (/\((?:lead|verdict)\)\s*$/i.test(heading.trim())) return true;
  return /^verdict$/i.test(cleanHeading(heading));
}

/** Public methodology apply/don't-apply line (career-ops.org + ReportView). */
export const APPLY_LINE = 4.0;

/** @param {unknown} legitimacy */
function flaggedPosting(legitimacy) {
  const s = String(legitimacy ?? "").toLowerCase();
  // Turkish reports (modes/tr/is-ilani.md) write the tier in Turkish:
  // Dikkatli İlerle (caution), Şüpheli (suspicious). Chinese reports
  // (modes/zh/oferta.md, modes/zh-TW/oferta.md) write it in Chinese:
  // 谨慎推进 / 審慎推進 (caution), 疑似虚假 / 疑似虛假 (suspicious).
  return /caut|precau|suspic|sospech|scam|fake|dikkatli|şüpheli|谨慎|審慎|疑似/.test(s);
}

/**
 * A score above the line on a flagged posting is not a recommendation, so the
 * label never contradicts the legitimacy badge next to it.
 *
 * @param {unknown} score
 * @param {unknown} [legitimacy]
 * @returns {string | null} "Recommended" | "Check the posting first" | "Below the apply line" | null
 */
export function applyLineLabel(score, legitimacy) {
  if (score == null || score === "") return null;
  const n = typeof score === "number" ? score : Number(String(score).match(/(\d+(?:\.\d+)?)/)?.[1]);
  if (!Number.isFinite(n)) return null;
  if (n < APPLY_LINE) return "Below the apply line";
  return flaggedPosting(legitimacy) ? "Check the posting first" : "Recommended";
}

/**
 * Block-G legitimacy tier → badge tone. Matches the same localized tiers as
 * flaggedPosting (English, Spanish, Turkish, Chinese).
 *
 * @param {string} l
 * @returns {"good" | "warn" | "bad" | "muted"}
 */
export function legitimacyTone(l) {
  const s = l.toLowerCase();
  if (s.includes("high") || s.includes("confian") || s.includes("legit") || s.includes("güven") || s.includes("高置信") || s.includes("高信心")) return "good";
  if (s.includes("caution") || s.includes("precau") || s.includes("caut") || s.includes("dikkatli") || s.includes("谨慎") || s.includes("審慎")) return "warn";
  if (s.includes("suspic") || s.includes("sospech") || s.includes("scam") || s.includes("fake") || s.includes("şüpheli") || s.includes("疑似")) return "bad";
  return "muted";
}

/**
 * Apply is the primary CTA only when the methodology says apply. Below 4.0 or
 * a caution/suspicious legitimacy tier, keep the control but drop brand fill
 * so it does not out-shout the verdict (#4206).
 *
 * @param {{ score?: unknown, legitimacy?: unknown }} opts
 * @returns {boolean}
 */
export function applyCtaQuiet(opts) {
  return applyLineLabel(opts?.score) === "Below the apply line" || flaggedPosting(opts?.legitimacy);
}

/**
 * Block B (CV Match / gaps) is the only lettered section that stays open.
 * Interview Plan is letter F in current oferta.md — never treat F as lead.
 * @param {{ letter?: string | null, heading?: string }} section
 * @returns {boolean}
 */
export function isLeadSection(section) {
  if (section?.letter === "B") return true;
  return /\b(cv match|match with cv)\b/i.test(cleanHeading(section?.heading ?? ""));
}

/**
 * First non-table paragraph — the one-line "why this score" for the verdict card.
 * @param {string} md
 * @returns {string}
 */
export function firstProseParagraph(md) {
  const withoutTables = String(md ?? "")
    .split("\n")
    .map((l) => (/^\s*\|/.test(l) ? "" : l))
    .join("\n");
  return (
    withoutTables
      .split(/\n{2,}/)
      .map((p) => p.replace(/^#+\s+/, "").trim())
      .find((p) => p && !/^[-*]{3,}$/.test(p) && !/^\*\*[^*]+:\*\*/.test(p)) ?? ""
  );
}

/**
 * Score-why paragraph for the verdict card. Prefers a real Verdict block, then
 * the body intro, then the header lede (oferta.md puts the one-liner above ---).
 * @param {{ report?: string, intro?: string, verdictContent?: string }} opts
 * @returns {string}
 */
export function verdictReason(opts) {
  const fromVerdict = firstProseParagraph(opts?.verdictContent ?? "");
  if (fromVerdict) return plainInline(fromVerdict);
  const fromIntro = firstProseParagraph(opts?.intro ?? "");
  if (fromIntro) return plainInline(fromIntro);
  const header = String(opts?.report ?? "").split(/^---\s*$/m)[0] ?? "";
  const stripped = header
    .replace(/^#\s+.*$/m, "")
    .replace(/^\s*\*\*[^*]+:\*\*.*$/gm, "")
    .trim();
  return plainInline(firstProseParagraph(stripped));
}

/**
 * The verdict card renders the reason as plain text, so inline Markdown
 * (`**Apply.**`, `code`, links) would show its raw markers.
 * @param {string} text
 * @returns {string}
 */
function plainInline(text) {
  return String(text ?? "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");
}

/**
 * Split a report body on `## ` headings. Everything before the first one is
 * the intro.
 * @param {string} body
 * @returns {{ intro: string, sections: Section[] }}
 */
export function splitSections(body) {
  /** @type {string[]} */
  const intro = [];
  /** @type {Section[]} */
  const sections = [];
  /** @type {{ heading: string, letter: string | null, lines: string[] } | null} */
  let cur = null;
  for (const line of body.split("\n")) {
    const h = line.match(/^##\s+(.*)$/);
    if (h) {
      if (cur) sections.push({ heading: cur.heading, letter: cur.letter, content: cur.lines.join("\n").trim() });
      const heading = h[1].trim();
      cur = { heading, letter: authorLetter(heading), lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    } else {
      intro.push(line);
    }
  }
  if (cur) sections.push({ heading: cur.heading, letter: cur.letter, content: cur.lines.join("\n").trim() });
  return { intro: intro.join("\n").trim(), sections };
}

const PREVIEW_MAX = 96;

/**
 * One-line preview for a collapsed report section. A STAR table gets its story
 * count, then prose wins. A section that is only a table gets "Field: value"
 * pairs for a two-column table or a row count otherwise, never the raw
 * `| --- |` separator.
 *
 * @param {string} md
 * @returns {string}
 */
export function sectionPreview(md) {
  const clip = (s) => (s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX).trimEnd() + "…" : s);
  const plain = (s) => s.replace(/[*_`>#|]/g, "").replace(/\s+/g, " ").trim();
  const table = parsePipeTable(md);
  const n = table?.rows.length ?? 0;
  if (table && isStarTableHeader(table.header)) return `${n} interview stor${n === 1 ? "y" : "ies"}`;
  const text = plain(
    md
      .replace(/^#+\s.*$/gm, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/^\s*\|.*$/gm, ""),
  );
  if (text) return clip(text.split(/(?<=[.!?])\s/)[0] ?? text);
  if (!table) return "";
  if (table.header.length === 2) {
    return clip(table.rows.map(([k, v]) => `${plain(k ?? "")}: ${plain(v ?? "")}`).join(" · "));
  }
  return `${n} row${n === 1 ? "" : "s"}`;
}
