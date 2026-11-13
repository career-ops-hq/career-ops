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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error(`Invalid date "${date}": expected YYYY-MM-DD.`);
  const companySlug = kebab(company);
  const candidateSlug = kebab(candidate);
  if (!companySlug) throw new Error('A company slug is required.');
  if (!candidateSlug) throw new Error('A candidate name is required.');
  const extension = String(ext).replace(/^\./, '');
  if (!/^[a-z0-9]+$/i.test(extension)) throw new Error(`Invalid extension "${ext}".`);
  const parts = [padReportNum(report), companySlug, kind, candidateSlug, date];
  if (variant) parts.push(variant);
  return `${parts.join('-')}.${extension}`;
}

/**
 * Read a standard name back into its parts, or null when it is not one.
 *
 * The company and candidate slugs are both free-length, so the split anchors
 * on the fixed `-{kind}-` token and the trailing date. A name with more than
 * one `-cv-` or `-cover-` in it is ambiguous and reads as not standard.
 *
 * @param {string} name - A basename.
 * @returns {{report: string, company: string, kind: string, candidate: string, date: string, variant: string|null, ext: string}|null}
 */
export function parseOutputName(name) {
  const m = /^(\d{3,})-(.+)\.([a-z0-9]+)$/i.exec(String(name));
  if (!m) return null;
  const [, report, rest, ext] = m;
  const variantAlt = VARIANTS.join('|');
  const tail = new RegExp(`-(\\d{4}-\\d{2}-\\d{2})(?:-(${variantAlt}))?$`).exec(rest);
  if (!tail) return null;
  const head = rest.slice(0, tail.index);
  const kinds = KINDS.map((k) => `-${k}-`);
  const hits = kinds.flatMap((token) => {
    const found = [];
    for (let i = head.indexOf(token); i !== -1; i = head.indexOf(token, i + 1)) found.push({ token, i });
    return found;
  });
  if (hits.length !== 1) return null;
  const { token, i } = hits[0];
  const company = head.slice(0, i);
  const candidate = head.slice(i + token.length);
  if (!company || !candidate) return null;
  return {
    report,
    company,
    kind: token.slice(1, -1),
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
    .map((m) => m[1])
    .sort();
  return matches[0] ?? null;
}
