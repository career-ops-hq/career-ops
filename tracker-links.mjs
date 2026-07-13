/**
 * tracker-links.mjs — Shared report-link normalization for the tracker.
 *
 * Markdown links resolve relative to the file that contains them, so a report
 * link in applications.md must be relative to wherever that tracker file lives:
 * `../reports/...` when the tracker is at `data/applications.md`, or
 * `reports/...` when it sits at the repo root.
 *
 * Report files canonically live in `<repoRoot>/reports/`, so we resolve the
 * incoming link to that absolute location regardless of how it was written
 * (root-relative `reports/...` per the TSV convention, or an already-normalized
 * `../reports/...`) and recompute the path with path.relative. Idempotent:
 * re-running never double-prefixes a link. See issue #760.
 */

import { join, relative, sep } from 'path';

/**
 * Rewrite every report link in a string so its path is relative to trackerDir.
 *
 * @param {string} reportField  Text containing one or more `[label](path)` links.
 * @param {string} trackerDir   Absolute dir of the tracker file (dirname of applications.md).
 * @param {string} repoRoot     Absolute repo root where `reports/` lives.
 * @returns {string} The same text with report links normalized.
 */
export function normalizeReportLink(reportField, trackerDir, repoRoot) {
  return reportField.replace(/\]\(([^)]+)\)/g, (whole, linkPath) => {
    const m = linkPath.match(/^(?:\.\.\/)*(reports\/.+)$/);
    if (!m) return whole; // not a report path — leave untouched
    const reportAbs = join(repoRoot, m[1]);
    const rel = relative(trackerDir, reportAbs).split(sep).join('/');
    return `](${rel})`;
  });
}
