/**
 * outcome-dir.mjs — find the ONE journal directory for a tracked application.
 *
 * `outcome.mjs` stores an application's outcome journal and artifacts in
 * `data/outcomes/{num}_{company_slug}_{role_slug}/`, and the journal inside it
 * is append-only: "the LAST `## Entry:` block is the current truth"
 * (calibrate.mjs's parseOutcomeJournal).
 *
 * The directory name was derived from the tracker row's CURRENT text every
 * time, so editing the Role cell between two recordings — normalising "Senior
 * Backend Engineer" to "Sr. Backend Engineer", say — sent the second entry to a
 * different directory:
 *
 *   data/outcomes/1_acme_senior-backend-engineer/outcome.md   interview_progress
 *   data/outcomes/1_acme_sr-backend-engineer/outcome.md       rejected
 *
 * One application, two half-journals, and no reader merges them. Every consumer
 * keys by the leading `{num}_`, so whichever directory it happens to read last
 * wins — by alphabetical order, not by when anything happened. The artifacts
 * (submitted_cv.md, posting.pdf, cover letter) split the same way.
 *
 * The tracker row NUMBER is the stable identity here; the slugs are a
 * human-readable label on it. So resolution goes by number, and the slug is
 * used only when there is nothing to reuse.
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every existing journal directory belonging to tracker row `num`.
 *
 * Sorted newest-journal-first, so a caller that must pick one picks the one
 * written most recently rather than the one that sorts first. A directory with
 * no outcome.md sorts last: it holds artifacts but no history.
 *
 * @param {string} outcomesRoot - Absolute path to data/outcomes.
 * @param {number|string} num - Tracker row number.
 * @returns {string[]} Directory NAMES (not paths), newest journal first.
 */
export function outcomeDirsFor(outcomesRoot, num) {
  if (!existsSync(outcomesRoot)) return [];
  const prefix = `${String(num)}_`;
  const mtime = (name) => {
    const log = join(outcomesRoot, name, 'outcome.md');
    // -1, not 0: a directory with no journal must sort after every directory
    // that has one, whatever their timestamps.
    if (!existsSync(log)) return -1;
    try {
      return statSync(log).mtimeMs;
    } catch {
      return -1;
    }
  };
  return readdirSync(outcomesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
    .map((e) => e.name)
    .sort((a, b) => (mtime(b) - mtime(a)) || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The directory an outcome for `num` belongs in.
 *
 * Reuses an existing one when there is one, so a tracker edit cannot fork the
 * journal. Only creates a name from the current slugs when this application has
 * no directory yet.
 *
 * @param {string} outcomesRoot - Absolute path to data/outcomes.
 * @param {number|string} num - Tracker row number.
 * @param {string} fallbackName - `{num}_{company_slug}_{role_slug}` for a first write.
 * @returns {{name: string, existing: string[]}} `existing` is every directory
 *   already present for this row, so the caller can report a pre-existing split
 *   rather than quietly writing into one half of it.
 */
export function resolveOutcomeDir(outcomesRoot, num, fallbackName) {
  const existing = outcomeDirsFor(outcomesRoot, num);
  return { name: existing[0] ?? fallbackName, existing };
}
