#!/usr/bin/env node
/**
 * company-scope.mjs — pick the batch-input rows a `--company` run should process.
 *
 * Usage: node batch/company-scope.mjs --input <batch-input.tsv> --company "A,B"
 * Prints one matching offer id per line; exit 0 (also when nothing matches),
 * exit 1 on a usage error.
 *
 * A row matches when any requested name is contained in either
 *   - the company half of the notes column ("Company - Role" when the notes use
 *     that shape, otherwise the whole notes text), or
 *   - the posting URL (so `--company acme` finds boards.greenhouse.io/acme/...).
 *     On a shared ATS host (ats-vendor.mjs ATS_HOST_PATTERNS) the vendor's own
 *     domain is left out, so `--company Lever` does not pick every posting on
 *     jobs.lever.co; the tenant subdomain and the path still count.
 * Comparison uses tracker-utils.mjs normalizeCompany (case and punctuation
 * folded, any script kept), so "Acme Corp." matches "acme corp" and "AcmeCorp".
 */
import { readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main-module.mjs';
import { flagValue, validateFlags } from '../lib/cli-flags.mjs';
import { normalizeCompany } from '../tracker-utils.mjs';
import { atsVendorOf, KNOWN_ATS_VENDORS } from '../ats-vendor.mjs';

/** Split a comma-separated CLI value into normalised keys, dropping blanks. */
export function requestedLabels(value) {
  return String(value || '').split(',').map(normalizeCompany).filter(Boolean);
}

/** Company half of a "Company - Role" notes value; the whole text otherwise. */
export function companyOfNotes(notes) {
  const text = String(notes ?? '');
  const i = text.indexOf(' - ');
  return i < 0 ? text : text.slice(0, i);
}

/**
 * The part of a posting URL that can name the employer. On a known shared ATS
 * the vendor domain (its last two host labels: lever.co, myworkdayjobs.com…)
 * names the platform, not the company, so only the tenant subdomain, the path
 * and the query are kept. Any other URL is used whole.
 */
export function companyOfUrl(url) {
  const text = String(url ?? '');
  if (!KNOWN_ATS_VENDORS.includes(atsVendorOf(text))) return text;
  const { hostname, pathname, search } = new URL(text.trim());
  const tenant = hostname.split('.').slice(0, -2).join('.');
  return `${tenant} ${pathname} ${search}`;
}

export function matchesCompany({ url = '', notes = '' }, wanted) {
  if (wanted.length === 0) return true;
  const hay = [normalizeCompany(companyOfNotes(notes)), normalizeCompany(companyOfUrl(url))];
  return wanted.some((w) => hay.some((h) => h.includes(w)));
}

/** @returns {string[]} ids of the matching rows, in file order */
export function idsForCompanies(tsvText, companies) {
  const wanted = requestedLabels(companies);
  const ids = [];
  for (const line of String(tsvText).split(/\r?\n/)) {
    const [id, url = '', , notes = ''] = line.split('\t');
    if (!id || id === 'id' || !/^\d+$/.test(id) || !url) continue;
    if (matchesCompany({ url, notes }, wanted)) ids.push(id);
  }
  return ids;
}

function main(argv) {
  validateFlags(argv, ['--input', '--company'], 'Usage: node batch/company-scope.mjs --input <batch-input.tsv> --company "A,B"',
    { valueFlags: ['--input', '--company'], requireOperand: true });
  const input = flagValue(argv, '--input');
  const company = flagValue(argv, '--company');
  if (!input || !company) {
    console.error('Usage: node batch/company-scope.mjs --input <batch-input.tsv> --company "A,B"');
    process.exit(1);
  }
  if (requestedLabels(company).length === 0) {
    console.error('company-scope: --company has no usable name');
    process.exit(1);
  }
  const ids = idsForCompanies(readFileSync(input, 'utf-8'), company);
  if (ids.length) process.stdout.write(ids.join('\n') + '\n');
}

if (isMainModule(import.meta.url) && process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  console.log('Usage: node batch/company-scope.mjs --input <batch-input.tsv> --company "A,B"  (prints matching offer ids)');
} else if (isMainModule(import.meta.url)) main(process.argv.slice(2));
