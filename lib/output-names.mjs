/**
 * lib/output-names.mjs — the one filename standard for generated artifacts in
 * `output/` (career-ops-hq/career-ops#6667).
 *
 *   {NNN}-{company-slug}-{kind}-{candidate-slug}-{YYYY-MM-DD}[-{variant}].{ext}
 *   024-zep-cv-david-gitman-2026-11-07.pdf
 *
 * The report number leads, so a directory listing groups every artifact of one
 * application together and sorts in the same order as `reports/`.
 *
 * - `NNN` is the report number, zero-padded to three digits.
 * - `company-slug` is read from `reports/NNN-{slug}-{date}.md`, never derived
 *   again from the company name, so a CV and its cover letter cannot disagree
 *   with each other or with the report.
 * - `kind` is `cv` or `cover`.
 * - `candidate-slug` is the kebab-case name from `config/profile.yml`.
 * - `variant` is optional and comes from a closed list, so an alternate copy
 *   (`ats`, `canva`) never collides with the plain one.
 *
 * Files with no report keep the names they have today: this module only names
 * what has a report number.
 *
 * Pure functions plus one filesystem lookup (`slugFromReport`). No state.
 */

import { existsSync, readdirSync } from 'node:fs';

export const KINDS = Object.freeze(['cv', 'cover']);
export const VARIANTS = Object.freeze(['ats', 'canva']);

/** Kebab-case a free-text value: lowercase ASCII letters and digits, single dashes. */
export function kebab(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** True for a YYYY-MM-DD string that is a real calendar date (not 2026-02-30). */
export function isRealDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const when = new Date(Date.UTC(y, mo - 1, d));
  return when.getUTCFullYear() === y && when.getUTCMonth() === mo - 1 && when.getUTCDate() === d;
}

/** Zero-pad a report number to three digits; throws on anything that is not a positive integer. */
export function padReportNum(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new Error(`Invalid report number "${value}": expected a positive integer.`);
  }
  return text.padStart(3, '0');
}

/**
 * Build a standard artifact filename.
 *
 * @param {object} p
 * @param {string|number} p.report - Report number (NNN).
 * @param {string} p.company - Company slug, as read from the report filename.
 * @param {'cv'|'cover'} p.kind
 * @param {string} p.candidate - Candidate name or slug; kebab-cased here.
 * @param {string} p.date - YYYY-MM-DD.
 * @param {string} [p.variant] - One of VARIANTS.
 * @param {string} [p.ext='pdf']
 * @returns {string}
 */
export function buildOutputName({ report, company, kind, candidate, date, variant, ext = 'pdf' }) {
  if (!KINDS.includes(kind)) throw new Error(`Invalid kind "${kind}": use ${KINDS.join(' or ')}.`);
  if (variant !== undefined && !VARIANTS.includes(variant)) {
    throw new Error(`Invalid variant "${variant}": use ${VARIANTS.join(' or ')}.`);
  }
  if (!isRealDate(date)) throw new Error(`Invalid date "${date}": expected a real YYYY-MM-DD date.`);
  const companySlug = kebab(company);
  const candidateSlug = kebab(candidate);
  if (!companySlug) throw new Error('A company slug is required.');
  if (!candidateSlug) throw new Error('A candidate name is required.');
  const extension = String(ext).replace(/^\./, '');
  if (!/^[a-z0-9]+$/i.test(extension)) throw new Error(`Invalid extension "${ext}".`);
  const parts = [padReportNum(report), companySlug, kind, candidateSlug, date];
  if (variant) parts.push(variant);
  const name = `${parts.join('-')}.${extension}`;
  // A name this module cannot read back without already knowing the company is
  // not a standard name: `the-cv-centre` + a cover letter would carry both
  // `-cv-` and `-cover-`. Refuse it, so a caller falls back to its legacy name
  // instead of writing a file the readers would have to guess about.
  if (!parseOutputName(name)) {
    throw new Error(`Ambiguous name "${name}": the company or candidate carries a "cv"/"cover" word, so the kind cannot be read back. Use the legacy name.`);
  }
  return name;
}

/** The documented slug syntax: lowercase ASCII letters and digits, single dashes. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** True for a slug `kebab()` could have produced. */
export function isSlug(value) {
  return SLUG_RE.test(String(value ?? ''));
}

/**
 * Read a standard name back into its parts, or null when it is not one.
 *
 * Both slugs are free-length and may themselves contain `cv` or `cover`
 * (`acme-cv-tools`, `robin-cover-jones`), so the name alone can be ambiguous.
 * Two ways to read it:
 *
 * - With `company` (the slug read from the report, which is what
 *   `buildOutputName` was given): the name must start with `{company}-`, the
 *   kind token follows it, and everything after that is the candidate. This
 *   resolves any name the builder writes, whatever its slugs contain.
 * - Without `company`: the split anchors on the one `-{kind}-` token in the
 *   name. A name with more than one `-cv-` or `-cover-` is ambiguous and
 *   reads as not standard.
 *
 * Either way both slugs must be kebab-case (lowercase ASCII, single dashes)
 * and the date must be a real calendar date.
 *
 * @param {string} name - A basename.
 * @param {{company?: string}} [opts]
 * @returns {{report: string, company: string, kind: string, candidate: string, date: string, variant: string|null, ext: string}|null}
 */
export function parseOutputName(name, { company: knownCompany } = {}) {
  const m = /^(\d{3,})-(.+)\.([a-z0-9]+)$/i.exec(String(name));
  if (!m) return null;
  const [, report, rest, ext] = m;
  const variantAlt = VARIANTS.join('|');
  const tail = new RegExp(`-(\\d{4}-\\d{2}-\\d{2})(?:-(${variantAlt}))?$`).exec(rest);
  if (!tail) return null;
  const head = rest.slice(0, tail.index);
  let company;
  let kind;
  let candidate;
  if (knownCompany) {
    const prefix = `${knownCompany}-`;
    if (!head.startsWith(prefix)) return null;
    const after = head.slice(prefix.length);
    kind = KINDS.find((k) => after.startsWith(`${k}-`));
    if (!kind) return null;
    company = knownCompany;
    candidate = after.slice(kind.length + 1);
  } else {
    const hits = KINDS.flatMap((k) => {
      const token = `-${k}-`;
      const found = [];
      for (let i = head.indexOf(token); i !== -1; i = head.indexOf(token, i + 1)) found.push({ k, token, i });
      return found;
    });
    if (hits.length !== 1) return null;
    const { k, token, i } = hits[0];
    kind = k;
    company = head.slice(0, i);
    candidate = head.slice(i + token.length);
  }
  if (!isSlug(company) || !isSlug(candidate)) return null;
  if (!isRealDate(tail[1])) return null;
  return {
    report,
    company,
    kind,
    candidate,
    date: tail[1],
    variant: tail[2] ?? null,
    ext: ext.toLowerCase(),
  };
}

/**
 * The company slug of a report, read from its filename `reports/NNN-{slug}-{date}.md`.
 *
 * @param {string|number} report - Report number.
 * @param {string} reportsDir - Absolute path to the `reports/` directory.
 * @returns {string|null} The slug, or null when no report carries that number.
 */
export function slugFromReport(report, reportsDir) {
  let num;
  try { num = padReportNum(report); } catch { return null; }
  if (!existsSync(reportsDir)) return null;
  const matches = readdirSync(reportsDir)
    .map((file) => new RegExp(`^${num}-(.+)-\\d{4}-\\d{2}-\\d{2}\\.md$`).exec(file))
    .filter(Boolean)
    .map((m) => kebab(m[1]))
    .filter(Boolean)
    .sort();
  return matches[0] ?? null;
}
