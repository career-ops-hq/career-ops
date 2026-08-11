import fs from "node:fs";
import path from "node:path";

// The web half of the transition ledger (status-log.tsv). set-status.mjs has
// written this file since #1695, and funnel-velocity.mjs and company-history.mjs
// read it — but status changes made in the web UI never reached it, so for
// anyone who works from the web app the ledger stays empty and both readers have
// no data to work with.
//
// Contract is set-status.mjs's, byte for byte:
//   {tracker#}\t{date}\t{from}\t{to}\t{source}\t
// with the ledger a SIBLING of the tracker file, so a CAREER_OPS_TRACKER
// redirect keeps the ledger next to the tracker it describes.
//
// Observation-only, exactly as the CLI treats it: the tracker remains the source
// of truth for STATE, the ledger only records WHEN. A failed append is reported
// to the caller and never thrown, because by the time this runs the status write
// has already committed — turning a ledger problem into a failed status change
// would be strictly worse than losing one history row.

/** A field is safe when it cannot shift the columns of a TSV row. */
const isSafeField = (v) => !/[\t\r\n]/.test(String(v));

// True only when YYYY-MM-DD names a day that exists. A shape check alone admits
// "2026-02-30" and "2026-13-40", and every reader of the ledger treats whatever
// is in the date column as a real date. Round-tripping through a UTC Date and
// comparing the parts back catches out-of-range months as well as month-length
// and leap-year violations, which a range check misses.
//
// A twin of isRealCalendarDate() in followup-cadence.mjs, not an import of it:
// Turbopack's root is pinned to web/ (next.config.mjs) and refuses modules
// outside it, so a repo-root module cannot be imported at build time here. That
// is the same constraint tracker-table.mjs documents.
const isRealCalendarDate = (iso) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ""))) return false;
  const [y, mo, d] = iso.split("-").map(Number);
  if (mo < 1 || mo > 12 || d < 1) return false;
  // setUTCFullYear rather than Date.UTC: Date.UTC maps years 0-99 onto
  // 1900-1999, which would reject a literal ISO year below 0100.
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

/**
 * Append one transition to the ledger beside `trackerFile`.
 *
 * @param {object}  args
 * @param {string}  args.trackerFile  Path to applications.md; the ledger is its sibling.
 * @param {number|string} args.num    Tracker row number.
 * @param {string}  args.from         Previous status (canonicalized by the caller).
 * @param {string}  args.to           New status (canonicalized by the caller).
 * @param {string} [args.source]      What performed the change. Defaults to "web".
 * @param {string} [args.date]        Event date YYYY-MM-DD, a real calendar day. Defaults to today.
 * @returns {{logged: boolean, reason?: string}} Never throws.
 */
export function appendStatusTransition({ trackerFile, num, from, to, source = "web", date } = {}) {
  const eventDate = date ?? new Date().toISOString().slice(0, 10);

  // Without this, a missing path throws out of path.dirname() below — outside
  // the try, so no caller sees a result. "Never throws" has to hold for a
  // caller's own mistake too, because by then the status write has committed.
  if (typeof trackerFile !== "string" || !trackerFile) {
    return { logged: false, reason: "invalid-field" };
  }

  // The date is held to its documented format rather than the generic check:
  // it is the only column with one, and a date that cannot be parsed back is
  // worse than an absent row because funnel-velocity.mjs still counts it.
  if (!isRealCalendarDate(eventDate)) return { logged: false, reason: "invalid-field" };

  for (const field of [num, from, to, source]) {
    if (!isSafeField(field)) return { logged: false, reason: "invalid-field" };
  }

  // Re-selecting the current status is not a transition. Logging it would inflate
  // every hop count funnel-velocity.mjs derives from this file.
  if (from === to) return { logged: false, reason: "no-change" };

  const logPath = path.join(path.dirname(trackerFile), "status-log.tsv");
  try {
    fs.appendFileSync(logPath, `${num}\t${eventDate}\t${from}\t${to}\t${source}\t\n`);
    return { logged: true };
  } catch (err) {
    return { logged: false, reason: `error: ${err.message}` };
  }
}
