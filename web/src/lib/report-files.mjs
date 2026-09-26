import path from "node:path";

// Plain .mjs (same pattern as tracker-table.mjs/pdf-paths.mjs) so both the
// TypeScript side (career-ops.ts) and the Node-run test suites can import it.
// A .ts home would have been unreachable from `node --test`, which is why this
// convention had drifted into two copies before landing here.

/**
 * True for a `{n}-RESERVED.md` placeholder sentinel — never a real report.
 *
 * THE definition of that convention for `web/`. `reserve-report-num.mjs` writes
 * an empty `NNN-RESERVED.md` to claim a report number before a worker has
 * written the report; it is deleted once the real report lands (or GC'd after
 * 4h if abandoned). Two consumers must agree on what that looks like:
 *
 * - `findReportFile` (career-ops.ts) — "RESERVED" sorts before nearly every real
 *   slug, so a surviving sentinel could be returned INSTEAD of the real report,
 *   making the report body and the Apply/PDF-ready checks disappear.
 * - `completedReportNames` (run-cli-support.mjs) — a sentinel must not count as
 *   persistence, or an evaluation that wrote nothing passes the honesty gate.
 *
 * They previously carried separate predicates that already disagreed on
 * `notes-RESERVED.md`; one definition is the point of this module.
 *
 * The number prefix is required: only a numbered sentinel comes from the
 * reservation path, so a hypothetical `notes-RESERVED.md` is a real report.
 *
 * @param {string} file - A filename or path; only the basename is examined.
 * @returns {boolean}
 */
export function isReservedReportFile(file) {
  return /^\d+-RESERVED\.md$/.test(path.basename(file));
}
