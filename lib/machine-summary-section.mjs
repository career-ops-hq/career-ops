/**
 * Where a report's own `## Machine Summary` section starts.
 *
 * The archived JD is pasted verbatim (#2789), and a posting is untrusted text:
 * it can carry its own "## Machine Summary" heading and YAML fence. A reader
 * that takes the first match in the file would read that block instead of the
 * report's, and debrief-sync.mjs would rewrite it.
 *
 * Reports put the real block in one of two places. Older reports have it
 * ahead of the archive (right after the header). Batch reports have it after
 * the archive, and since #6156 every report has it as the last section. So a
 * summary heading ahead of the first "## Job Description" heading is the real
 * one, and with none there, the real one is the last summary heading in the
 * report.
 *
 * Headings inside fenced code blocks are not the report's: an example of the
 * block is skipped (#6023). From the archive on, the last heading line is
 * taken whether or not it sits in a fence, and refused when it does. The JD
 * can open a fence it never closes; skipping fenced lines there would hide
 * the real heading and hand the choice to a heading the JD wrote.
 *
 * web/src/lib/machine-summary-section.mjs is a byte-identical copy (the web
 * app cannot import core modules); tests/machine-summary-section.test.mjs
 * keeps the two in step.
 */

const SUMMARY_HEADING = /^##[ \t]*Machine Summary[ \t]*\r?$/i;
const JD_HEADING = /^##[ \t]+Job Description\b/i;
const FENCE_MARK = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Offset of the report's own `## Machine Summary` heading line, or -1.
 * @param {string} markdown
 * @returns {number}
 */
export function machineSummaryStart(markdown) {
  const text = String(markdown ?? '');
  let offset = 0;
  let fence = null;
  let afterArchive = false;
  let last = -1;
  let lastFenced = false;
  for (const line of text.split('\n')) {
    const mark = line.match(FENCE_MARK);
    if (afterArchive && SUMMARY_HEADING.test(line)) {
      last = offset;
      lastFenced = fence !== null;
    }
    if (fence) {
      if (mark && mark[1][0] === fence[0] && mark[1].length >= fence.length && !mark[2].trim()) fence = null;
    } else if (mark) {
      fence = mark[1];
    } else if (!afterArchive && SUMMARY_HEADING.test(line)) {
      return offset;
    } else if (JD_HEADING.test(line)) {
      afterArchive = true;
    }
    offset += line.length + 1;
  }
  return lastFenced ? -1 : last;
}

/**
 * The report from its own `## Machine Summary` heading to the end, or '' when
 * it has none. The section starts with the heading, so a reader anchors its
 * fence pattern with `^` to read this block and no later one.
 * @param {string} markdown
 * @returns {string}
 */
export function machineSummarySection(markdown) {
  const start = machineSummaryStart(markdown);
  return start < 0 ? '' : String(markdown ?? '').slice(start);
}
