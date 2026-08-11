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

/**
 * Append one transition to the ledger beside `trackerFile`.
 *
 * @param {object}  args
 * @param {string}  args.trackerFile  Path to applications.md; the ledger is its sibling.
 * @param {number|string} args.num    Tracker row number.
 * @param {string}  args.from         Previous status (canonicalized by the caller).
 * @param {string}  args.to           New status (canonicalized by the caller).
 * @param {string} [args.source]      What performed the change. Defaults to "web".
 * @param {string} [args.date]        Event date YYYY-MM-DD. Defaults to today.
 * @returns {{logged: boolean, reason?: string}} Never throws.
 */
export function appendStatusTransition({ trackerFile, num, from, to, source = "web", date }) {
  const eventDate = date ?? new Date().toISOString().slice(0, 10);

  for (const field of [num, from, to, source, eventDate]) {
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
