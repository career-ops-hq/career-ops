#!/usr/bin/env node
/**
 * gigs.mjs — the freelance and contract rows of the tracker (job-engine:
 * docs/TRACKS.md).
 *
 * Read-only and zero-LLM. The tracker keeps its columns: an engagement that
 * is not permanent employment starts its Notes cell with a gig segment
 * (modes/tracks/README.md):
 *
 *   gig: 850 EUR/day, 6 mo, via Hays; posted: 2026-11-02
 *   gig: 95 EUR/h, 3 mo, direct
 *   gig: rate n/s, length n/s, via Malt
 *
 * This lists those rows with the rate as a day rate, the contract value the
 * stated length implies, and how the rate sits against tracks.freelance in
 * config/profile.yml. Nothing is estimated: a figure the segment does not
 * state stays null.
 *
 *   node gigs.mjs              JSON
 *   node gigs.mjs --summary    table
 *   node gigs.mjs --self-test
 */

import { existsSync, readFileSync } from 'fs';
import { hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot, getProfilePath, resolveTrackerPath } from './path-resolver.mjs';
import { parseTrackerRow, resolveColumns } from './tracker-parse.mjs';
import { loadTracks, normalizeTracks } from './lib/tracks.mjs';
import { compareRate, toDayRate } from './lib/gig-terms.mjs';

const KNOWN_FLAGS = ['--summary', '--self-test', '--help', '-h'];
const USAGE = [
  'Usage:',
  '  node gigs.mjs [--summary]',
  '  node gigs.mjs --self-test',
  '',
  'Lists tracker rows whose Notes start with a "gig: {rate}, {length}, {direct | via agency}" segment.',
].join('\n');

const CURRENCIES = { '€': 'EUR', '$': 'USD', '£': 'GBP' };
const UNITS = [
  [/^(h|hr|hour|std|stunde)$/i, 'hour'],
  [/^(d|day|tag|tagessatz)$/i, 'day'],
  [/^(w|wk|week|woche)$/i, 'week'],
  [/^(mo|month|monat)$/i, 'month'],
];

/**
 * Parse the gig segment at the start of a Notes cell.
 * @returns {null | { rate: null | { min: number, max: number, currency: string, unit: string }, months: number | null, via: string | null, direct: boolean, raw: string }}
 */
export function parseGigNote(notes) {
  const m = /^\s*gig:\s*([^;]*)/i.exec(String(notes ?? ''));
  if (!m) return null;
  const raw = m[1].trim();
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  const gig = { rate: null, months: null, via: null, direct: false, raw };
  for (const part of parts) {
    const rate = /^([€$£])?\s*(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*([€$£]|[A-Za-z]{3})?\s*(?:\/|per\s+|pro\s+)\s*([A-Za-z]+)$/.exec(part);
    if (rate && !gig.rate) {
      const symbol = rate[1] || rate[4] || '';
      const currency = CURRENCIES[symbol] || symbol.toUpperCase() || 'EUR';
      const unit = UNITS.find(([re]) => re.test(rate[5]))?.[1];
      const number = s => Number(s.replace(',', '.'));
      if (unit) {
        const min = number(rate[2]);
        gig.rate = { min, max: rate[3] ? number(rate[3]) : min, currency, unit };
        continue;
      }
    }
    const length = /^(\d+(?:[.,]\d+)?)\s*(mo|months?|monate?|weeks?|wochen?|wk|w)\b/i.exec(part);
    if (length && gig.months === null) {
      const n = Number(length[1].replace(',', '.'));
      gig.months = /^w/i.test(length[2]) ? Math.round((n / 4.345) * 10) / 10 : n;
      continue;
    }
    const via = /^via\s+(.+)$/i.exec(part);
    if (via) { gig.via = via[1].trim(); continue; }
    if (/^(direct|direkt)$/i.test(part)) gig.direct = true;
  }
  return gig;
}

/**
 * @param {string} trackerText
 * @param {ReturnType<typeof normalizeTracks>} tracks
 */
export function listGigs(trackerText, tracks) {
  const lines = trackerText.split('\n');
  const colmap = resolveColumns(lines);
  const fr = tracks.freelance;
  const rows = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    const gig = parseGigNote(row.notes);
    if (!gig) continue;
    const day = gig.rate ? toDayRate(gig.rate, { hoursPerDay: fr.hoursPerDay, billableDaysPerYear: fr.billableDaysPerYear }) : null;
    const dayRate = day ? { min: Math.round(day.min), max: Math.round(day.max), currency: gig.rate.currency } : null;
    // Days per month from the user's own billable days, so a 6-month contract
    // is not priced as 130 working days nobody bills.
    const daysPerMonth = fr.billableDaysPerYear / 12;
    rows.push({
      num: row.num,
      date: row.date,
      company: row.company,
      role: row.role,
      status: row.status,
      score: row.score,
      rate: gig.rate,
      dayRate,
      months: gig.months,
      contractValue: dayRate && gig.months
        ? { min: Math.round(dayRate.min * daysPerMonth * gig.months), max: Math.round(dayRate.max * daysPerMonth * gig.months), currency: dayRate.currency, assumes: 'billable_days_per_year / 12 days per month' }
        : null,
      via: gig.via || (row.via ? row.via : null),
      direct: gig.direct && !gig.via,
      againstTarget: gig.rate ? compareRate(gig.rate, fr.dayRate, { hoursPerDay: fr.hoursPerDay, billableDaysPerYear: fr.billableDaysPerYear, fx: fr.fx }).verdict : 'not_stated',
    });
  }
  const byStatus = {};
  for (const r of rows) byStatus[r.status || 'Unknown'] = (byStatus[r.status || 'Unknown'] || 0) + 1;
  return {
    count: rows.length,
    byStatus,
    target: fr.dayRate,
    assumptions: { hoursPerDay: fr.hoursPerDay, billableDaysPerYear: fr.billableDaysPerYear },
    rows,
  };
}

function summary(result) {
  if (!result.count) return 'No gig rows. A gig row is a tracker row whose Notes start with "gig: {rate}, {length}, {direct | via agency}".';
  const money = v => (v ? (v.min === v.max ? String(v.min) : v.min + '-' + v.max) + ' ' + v.currency : 'n/s');
  const out = ['Gigs in the tracker: ' + result.count + ' (' + Object.entries(result.byStatus).map(([k, v]) => k + ' ' + v).join(', ') + ')', ''];
  out.push('| # | Company | Role | Status | Day rate | Length | Contract value | Via | vs target |');
  out.push('|---|---------|------|--------|----------|--------|----------------|-----|-----------|');
  for (const r of result.rows) {
    out.push('| ' + [r.num, r.company, r.role, r.status, money(r.dayRate), r.months ? r.months + ' mo' : 'n/s', r.contractValue ? '~' + money(r.contractValue) : 'n/s', r.via || (r.direct ? 'direct' : 'n/s'), r.againstTarget].join(' | ') + ' |');
  }
  out.push('', 'Day rates assume ' + result.assumptions.hoursPerDay + ' h/day; contract values assume ' + result.assumptions.billableDaysPerYear + ' billable days a year.');
  return out.join('\n');
}

function selfTest() {
  let failed = 0;
  const check = (ok, label) => { if (!ok) { failed++; console.error('FAIL ' + label); } };
  const a = parseGigNote('gig: 850 EUR/day, 6 mo, via Hays; posted: 2026-11-02');
  check(a?.rate?.min === 850 && a.rate.unit === 'day' && a.rate.currency === 'EUR' && a.months === 6 && a.via === 'Hays', 'full segment');
  const b = parseGigNote('gig: 90-110 €/h, 12 weeks, direct');
  check(b?.rate?.min === 90 && b.rate.max === 110 && b.rate.unit === 'hour' && b.direct && b.months === 2.8, 'hourly range in weeks');
  const c = parseGigNote('gig: rate n/s, length n/s, via Malt');
  check(c && c.rate === null && c.months === null && c.via === 'Malt', 'nothing stated');
  check(parseGigNote('Strong fit; posted: 2026-11-02') === null, 'an ordinary note is not a gig');
  const tracker = [
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    '| 1 | 2026-11-02 | Acme | LLM Engineer (Freelance) | 4.2/5 | Evaluated | ❌ | [1](reports/001-acme-2026-11-02.md) | gig: 100 EUR/h, 6 mo, via Hays |',
    '| 2 | 2026-11-02 | Globex | Staff Engineer | 4.0/5 | Applied | ✅ | [2](reports/002-globex-2026-11-02.md) | Good fit |',
  ].join('\n');
  const tracks = normalizeTracks({ tracks: { freelance: { enabled: true, day_rate: { target: 900, minimum: 700, currency: 'EUR' }, billable_days_per_year: 200 } } });
  const listed = listGigs(tracker, tracks);
  check(listed.count === 1 && listed.rows[0].dayRate.min === 800, 'one gig row, hourly rate as a day rate');
  check(listed.rows[0].contractValue.min === 80000, 'contract value from billable days');
  check(listed.rows[0].againstTarget === 'between', 'rate between minimum and target');
  check(listGigs(tracker, normalizeTracks(null)).rows[0].againstTarget === 'no_floor', 'no target set is not a verdict');
  if (failed) { console.error(failed + ' self-test check(s) failed'); process.exit(1); }
  console.log('self-test passed (8 checks)');
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE);
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) { console.log(USAGE); process.exit(0); }
  if (hasFlag(args, '--self-test')) { selfTest(); process.exit(0); }
  const trackerPath = resolveTrackerPath(getCareerOpsRoot());
  const result = existsSync(trackerPath)
    ? listGigs(readFileSync(trackerPath, 'utf-8'), loadTracks(getProfilePath()))
    : { count: 0, byStatus: {}, rows: [], target: null, assumptions: null };
  console.log(hasFlag(args, '--summary') ? summary(result) : JSON.stringify(result, null, 2));
}
