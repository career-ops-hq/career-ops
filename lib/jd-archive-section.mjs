/**
 * lib/jd-archive-section.mjs — the embedded JD archive section of a report.
 *
 * Every report must carry the posting's verbatim text under
 * `## Job Description (archived verbatim)` (#2789); check-jd-archive.mjs
 * enforces it. The evaluators that call a model API directly already hold that
 * text in memory, so they write the section themselves instead of asking the
 * model to copy it: a model can truncate, paraphrase, or leave the template
 * placeholder, and any of those defeats the archive.
 *
 * The heading and section-boundary patterns live here so the writer and
 * check-jd-archive.mjs, the reader, agree on what the section is.
 */

export const JD_ARCHIVE_HEADING = '## Job Description (archived verbatim)';

// Matches "## Job Description", with or without a parenthetical/suffix (the
// canonical heading is JD_ARCHIVE_HEADING). Content is read up to the next
// KNOWN report-section heading or end of file — not any "## " line, because a
// JD pasted verbatim can itself contain markdown-style sub-headings (e.g.
// "## Responsibilities"), which would otherwise truncate the section and
// falsely report a real archive as missing (CodeRabbit, PR #2791). The
// allowlist below is every section name modes/oferta.md's report template
// actually uses; a real JD's own text is vanishingly unlikely to collide with
// one verbatim.
export const JD_HEADING_RE = /^##\s+Job Description\b.*$/im;
export const NEXT_REPORT_SECTION_RE =
  /^##\s+(?:Machine Summary|Keywords extracted|[A-Z]\)|Block\s[A-Z]\b|Risk Summary|Cover Letter Draft|Post-evaluation|Liveness gate|Blacklist gate|Bounded Research Budget|Step 0\b)/im;

/**
 * Return `report` with the verbatim JD archived in it.
 *
 * check-jd-archive.mjs reads the FIRST "## Job Description" section, so a
 * section the model wrote itself (an evaluator whose prompt is
 * modes/oferta.md is told to) is replaced in place rather than left ahead of
 * this one. Without a model-written section, the archive is appended at the
 * end. An empty `jdText` leaves the report unchanged: there is nothing to
 * archive, and an empty section would only hide that from the check.
 */
export function withJdArchiveSection(report, jdText) {
  const body = String(report ?? '');
  const jd = String(jdText ?? '').trim();
  if (!jd) return body;
  const section = `${JD_ARCHIVE_HEADING}\n\n${jd}\n`;

  const m = JD_HEADING_RE.exec(body);
  if (!m) return `${body.trimEnd()}\n\n${section}`;

  const before = body.slice(0, m.index);
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(NEXT_REPORT_SECTION_RE);
  const after = next === -1 ? '' : `\n${rest.slice(next)}`;
  return `${before}${section}${after}`;
}
