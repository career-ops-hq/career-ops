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

const SLUG_MAX = 60;

/** Cut at a character boundary so the result is at most `max` UTF-8 bytes. */
function truncateUtf8(value, max) {
  let bytes = 0;
  let out = '';
  for (const char of value) {
    bytes += Buffer.byteLength(char);
    if (bytes > max) break;
    out += char;
  }
  return out.replace(/-+$/g, '');
}

/** Slug grammar used by archive-posting.mjs for capture name fields. */
export function captureSlug(text) {
  const fold = (value) => value
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const lowered = String(text ?? '').toLowerCase();
  const ascii = fold(lowered.replace(/[^\w\s-]/g, '')).slice(0, SLUG_MAX);
  if (ascii !== '') return ascii;
  // A name written entirely in another script (株式会社アクメ, Яндекс, شركة) has no
  // ASCII word character, so the grammar above reduced it to '' and every such
  // capture came out as `{date}__.pdf`: two postings on one day overwrote each
  // other, and companyMatches() treats '' as "attribute nothing", so the capture
  // was never found again. Only that all-empty case falls back to the letters and
  // digits of any script, so every slug that was already non-empty is unchanged
  // and the captures written under it keep resolving. The limit is in bytes
  // (one ASCII character is one byte, a CJK character three), so that company
  // and role together keep the whole capture filename under the 255 bytes most
  // filesystems allow.
  return truncateUtf8(fold(lowered.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')), SLUG_MAX);
}

/** Zero-pad a report number to the 3-digit form used by reports/ filenames. */
export function reportPrefix(num) {
  return String(num).padStart(3, '0');
}

/**
 * Does `filename` name a capture belonging to `slug`'s company?
 *
 * Both grammars written here put the company first, after the report prefix and
 * an optional capture date:
 *
 *   {NNN}-{YYYY-MM-DD}_{company}_{role}_{sha256(url)[0:16]}[-2, -3, ...].pdf   archive-posting.mjs
 *   {NNN}-{company}-{role}.{ext}              hand-named and plugin captures
 *
 * So the slug is anchored to that position and must end on a field boundary.
 * Testing `includes()` over the whole name let a role word ("marketing", "vp")
 * answer for a company — the same mistake as matching the number alone, one
 * field further in.
 */
function companyMatches(filename, slug) {
  if (slug === '') return false; // supplied but unusable: attribute nothing
  const rest = filename
    .replace(/^\d+-/, '')                      // report prefix
    .replace(/^\d{4}-\d{2}-\d{2}[_-]/, '')     // capture date, when present
    .toLowerCase();
  const s = slug.toLowerCase();
  if (!rest.startsWith(s)) return false;
  const next = rest.charAt(s.length);
  return next === '' || next === '-' || next === '_' || next === '.';
}

/**
 * Find the archived capture for a report number.
 *
 * @param {string} jdsDir            Directory holding captures (usually jds/).
 * @param {number|string} reportNum  Tracker/report number.
 * @param {object} [opts]
 * @param {string} [opts.companySlug] Disambiguates when a report has several
 *   captures, and guards against a number that matched the wrong company: if no
 *   candidate carries this slug, the lookup reports nothing found rather than
 *   returning a capture it cannot attribute. Omit it to take the most recent
 *   candidate unconditionally.
 * @returns {{path: string, filename: string, ext: string, candidates: string[]}|null}
 *   null when no capture matches the report, or when companySlug matches none.
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
  //
  // A companySlug that matches nothing means every candidate belongs to some
  // other company: the number matched, the posting did not. Falling back to a
  // mismatch would hand the caller another company's JD, and the caller cannot
  // tell it apart from a real hit — outcome.mjs copies it in as the permanent
  // posting record and, counting the lookup as a success, never archives the
  // real one. Report nothing found instead. The cost of being wrong the other
  // way is only a re-archive from the live URL.
  let chosen = byRecency[0];
  if (companySlug !== undefined && companySlug !== null) {
    chosen = byRecency.find(e => companyMatches(e.name, String(companySlug)));
    if (!chosen) return null;
  }

  return {
    path: join(jdsDir, chosen.name),
    filename: chosen.name,
    ext: extname(chosen.name),
    candidates: byRecency.map(e => e.name),
  };
}
