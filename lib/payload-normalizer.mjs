/**
 * payload-normalizer.mjs — defensive pre-pass for model-generated CV payloads.
 *
 * WHY THIS EXISTS
 *   `build-cv-html.mjs:374-376` renders bullets with a bare ternary:
 *
 *       const bullets = Array.isArray(e.bullets)
 *         ? e.bullets.filter(Boolean).map(b => `<li>${escapeHtml(b)}</li>`).join('\n    ')
 *         : '';
 *
 *   `validatePayload()` never inspects `bullets`, and `hasRequiredFields()`
 *   (lib/cv-payload-schema.mjs) only checks the section's `required` keys —
 *   `bullets` is optional on every section. So a model that emits prose instead
 *   of an array produces a payload that validates with ZERO errors, ZERO
 *   warnings, renders successfully, exits 0, and ships a CV with an empty
 *   `<ul></ul>`. Nothing anywhere reports it.
 *
 *   That is the failure this module closes. A model migrating from HTML output
 *   (where bullets are `<li>` markup) to JSON has no signal that the field
 *   changed shape, and "bullet list came back empty" is the natural first
 *   symptom. Normalizing BEFORE validation converts a silent drop into either
 *   correct content or a visible error.
 *
 * WHAT IT DOES NOT DO
 *   It never invents, rewrites, or reorders content, and it never fabricates a
 *   metric. It only changes the SHAPE of a field, and it reports every change
 *   it made via `normalizePayload().notes` so a caller can surface them. Silent
 *   mutation of user-facing CV text is the failure mode this repo keeps paying
 *   for (see #3523), so every repair is both applied and recorded.
 *
 * DELIBERATE NON-BEHAVIOR: array-of-non-strings in `bullets`
 *   A non-string element is DROPPED and noted, not stringified. Coercing
 *   `{}` to "[object Object]" would put junk on a CV; silently keeping it
 *   would produce a broken `<li>`. Dropping plus a note means the caller can
 *   decide. The array case is a genuine model bug, unlike the string case
 *   below which is a pure shape mismatch with no information loss.
 *
 * THE STRING CASE IS LOSSLESS
 *   A string `bullets` is split on newlines when it contains any, and otherwise
 *   wrapped whole in a single-element array. No words are dropped, only the
 *   shape changes, which is what makes normalizing rather than rejecting the
 *   right call for this specific field.
 */

import { validatePayload, hasRequiredFields } from './cv-payload-schema.mjs';

/**
 * Sections whose entries may carry `bullets`, and whether a bullet-less entry
 * is meaningful. `experience` and `projects` are bullet-bearing; adding a new
 * section to this table is the only edit needed to extend coverage.
 */
const BULLET_SECTIONS = ['experience', 'projects'];

/**
 * Education key migration, keyed by TARGET format.
 *
 * The two builders have genuinely different vocabularies (lib/cv-payload-schema.mjs
 * header, #3523): html wants {title, org, location, year, description}, tex
 * wants {institution, degree, location, dates, coursework}. An entry written in
 * the wrong dialect matches no required key, so it renders NOTHING while
 * validation still reports valid — the exact silent-drop the schema module was
 * written to prevent, re-entering through a different door.
 *
 * Each table maps SOURCE key -> TARGET key. `null` as a target means the value
 * is preserved but not renamed (location is spelled identically in both).
 * Only keys the model plausibly emits are mapped; anything else is left alone
 * for validatePayload() to report as an unrecognised key.
 */
const EDUCATION_KEY_MAP = {
  html: { institution: 'title', degree: 'org', dates: 'year', coursework: 'description' },
  tex: { title: 'institution', org: 'degree', year: 'dates', description: 'coursework' },
};

/** Newline-separated prose that a model may emit as one string. */
function splitBulletString(value) {
  const trimmed = value.trim();
  if (trimmed === '') return [];
  // A single-line string is one bullet. Multi-line prose is a bullet list the
  // model joined with newlines. `-`/`*` prefixes are stripped when present
  // because a markdown list is the other common shape here.
  if (!/[\r\n]/.test(trimmed)) return [trimmed];
  return trimmed
    .split(/[\r\n]+/)
    .map(line => line.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(Boolean);
}

function normalizeBullets(entry, where, notes) {
  if (!Object.prototype.hasOwnProperty.call(entry, 'bullets') || entry.bullets === undefined || entry.bullets === null) {
    entry.bullets = [];
    notes.push(`${where}: bullets absent -> [] (entry renders without a bullet list)`);
    return;
  }

  if (typeof entry.bullets === 'string') {
    const split = splitBulletString(entry.bullets);
    entry.bullets = split;
    notes.push(
      split.length
        ? `${where}: bullets was a string -> array of ${split.length} (split ${/\n/.test(entry.bullets) ? 'on newlines' : 'as one bullet'})`
        : `${where}: bullets was an empty/blank string -> []`,
    );
    return;
  }

  if (Array.isArray(entry.bullets)) {
    const kept = entry.bullets.filter(b => typeof b === 'string' && b.trim() !== '');
    if (kept.length !== entry.bullets.length) {
      const dropped = entry.bullets.length - kept.length;
      notes.push(`${where}: dropped ${dropped} non-string or blank bullet(s) — not stringified, to avoid "[object Object]" on a CV`);
    }
    entry.bullets = kept;
    return;
  }

  // A number, boolean, or object in a bullet field is a shape error with no
  // sensible repair. Replace with [] and record it loudly; validation will not
  // catch this on its own.
  notes.push(`${where}: bullets was ${Array.isArray(entry.bullets) ? 'an array' : typeof entry.bullets} (unusable shape) -> []`);
  entry.bullets = [];
}

function normalizeEducation(entries, format, notes) {
  const map = EDUCATION_KEY_MAP[format];
  if (!map) return;
  entries.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    const where = `education[${i}]`;
    let renamed = 0;
    for (const [from, to] of Object.entries(map)) {
      // Only rename when the source key is present AND the target is absent, so
      // a payload already in the right dialect is untouched.
      if (!Object.prototype.hasOwnProperty.call(entry, from)) continue;
      if (Object.prototype.hasOwnProperty.call(entry, to)) continue;
      entry[to] = entry[from];
      delete entry[from];
      renamed += 1;
    }
    if (renamed) {
      const now = hasRequiredFields(entry, 'education', format);
      notes.push(
        `education[${i}]: renamed ${renamed} key(s) into the ${format} dialect `
        + `(${now ? 'now renderable' : 'STILL missing a required field — validation will report it'})`,
      );
    }
  });
}

/**
 * Normalize a model-generated CV payload in place and return it with a report.
 *
 * @param {object} rawPayload  parsed payload, typically straight from JSON.parse
 * @param {{format?: 'html'|'tex'}} [options]
 * @returns {{payload: object, notes: string[], errors: string[], warnings: string[]}}
 *   `payload` is the same object, mutated (mutating is deliberate: callers pass
 *   a freshly parsed object and a copy would only invite drift between the two).
 *   `notes` records every repair. `errors`/`warnings` come from the shared
 *   validator run AFTER normalization, so they describe the repaired payload —
 *   which is the payload that will actually render.
 */
export function normalizePayload(rawPayload, options = {}) {
  const format = options.format || 'html';
  const notes = [];

  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {
      payload: rawPayload,
      notes,
      errors: ['normalizePayload: expected an object; nothing to normalize'],
      warnings: [],
    };
  }

  for (const section of BULLET_SECTIONS) {
    const entries = rawPayload[section];
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, i) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
      normalizeBullets(entry, `${section}[${i}]`, notes);
    });
  }

  if (Array.isArray(rawPayload.education)) {
    normalizeEducation(rawPayload.education, format, notes);
  }

  const { errors, warnings } = validatePayload(rawPayload, format);
  return { payload: rawPayload, notes, errors, warnings };
}

export default normalizePayload;
