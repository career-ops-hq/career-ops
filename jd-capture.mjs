/**
 * jd-capture.mjs — Look up an archived job posting by report number.
 *
 * Captures in jds/ used to be findable only by reconstructing the filename that
 * wrote them, from today's date plus a freshly scraped company and role. Those
 * inputs change between runs, so a capture became unreachable the day after it
 * was made — exactly when the posting has gone dead and the capture matters.
 *
 * The report number is stable: it keys reports/{###}-{slug}-{date}.md and column
 * one of the tracker. Matching on it finds captures written today, captures
 * written months ago, and the ones users named by hand, without renaming any.
 *
 * Padded and unpadded prefixes both resolve (`064-`, `64-`, `01-`), because both
 * appear in real capture directories. Matching compares the parsed integer, so
 * report 64 never picks up report 640's capture.
 */

import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

/** Zero-pad a report number to the 3-digit form used by reports/ filenames. */
export function reportPrefix(num) {
  return String(num).padStart(3, '0');
}

/**
 * Find the archived capture for a report number.
 *
 * @param {string} jdsDir            Directory holding captures (usually jds/).
 * @param {number|string} reportNum  Tracker/report number.
 * @param {object} [opts]
 * @param {string} [opts.companySlug] Disambiguates when a report has several
 *   captures. A slug that begins with digits is indistinguishable from a report
 *   number by filename alone, so this is the escape hatch for that collision.
 * @returns {{path: string, filename: string, ext: string, candidates: string[]}|null}
 */
export function findCaptureForReport(jdsDir, reportNum, { companySlug } = {}) {
  const target = Number(reportNum);
  if (!Number.isInteger(target) || target <= 0) return null;

  let entries;
  try {
    entries = readdirSync(jdsDir);
  } catch {
    return null; // No captures directory yet — nothing to resolve, not an error.
  }

  // The trailing hyphen is load-bearing: it stops `64` matching `640-epsilon.txt`
  // and stops a numeric run inside a name (`li-0640-...`) from matching at all.
  const matches = entries.filter(name => {
    const m = /^(\d+)-/.exec(name);
    return m ? parseInt(m[1], 10) === target : false;
  });
  if (matches.length === 0) return null;

  const byRecency = matches
    .map(name => {
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(join(jdsDir, name)).mtimeMs;
      } catch { /* vanished mid-scan — sorts last, still returned as a candidate */ }
      return { name, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));

  // Recency is a deterministic tie-break, not a quality judgement. An explicit
  // companySlug beats it, and callers get the full candidate list either way.
  const hinted = companySlug
    ? byRecency.find(e => e.name.toLowerCase().includes(String(companySlug).toLowerCase()))
    : null;
  const chosen = hinted ?? byRecency[0];

  return {
    path: join(jdsDir, chosen.name),
    filename: chosen.name,
    ext: extname(chosen.name),
    candidates: byRecency.map(e => e.name),
  };
}
