#!/usr/bin/env node
/**
 * verify-apply-gate.mjs — Application SLA gate (read-only).
 *
 * Usage:
 *   node verify-apply-gate.mjs <company|report#>          # check one application
 *   node verify-apply-gate.mjs                            # check all Applied rows
 *   node verify-apply-gate.mjs <company> --json
 *
 * Checks an application against the SLA in modes/_custom.md → "Application SLA":
 *   1. tailored CV exists on disk (output/cv-shivanand-shah-{slug}*.pdf)
 *   2. cover letter exists OR tracker notes carry a JD-anchored sentence
 *   3. follow-up is scheduled in data/follow-ups.md for the tracker row
 *   4. report carries **URL:** and **Legitimacy:** headers and an archived JD
 *      (embedded ## Job Description or a jds/ capture — see check-jd-archive.mjs)
 *   5. form-fill profile data/application-profile.yml exists and has no
 *      deprecated/corrupted education values (the GED/Business-Communications bug)
 *
 * Exit code: 0 all pass · 1 one or more SLA failures. Verdicts on stdout;
 * machine-readable with --json.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';

const DATA_ROOT = getCareerOpsRoot();
const TRACKER = join(DATA_ROOT, 'data', 'applications.md');
const OUT = join(DATA_ROOT, 'output');
const FOLLOWUPS = join(DATA_ROOT, 'data', 'follow-ups.md');
const PROFILE = join(DATA_ROOT, 'data', 'application-profile.yml');
const BAD_EDU = /\b(GED|Business Comm\w*)\b/i;
const MAXS = { CV_MISSING: 'tailored CV not on disk', NO_COVER: 'no cover letter / JD-anchored notes', NO_FOLLOWUP: 'no follow-up scheduled', REPORT_BROKEN: 'report missing required headers/archived JD', FORM_CORRUPTED: 'form-fill profile missing or carries deprecated values', NOT_FOUND: 'tracker row not found' };

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

function parseTracker() {
  if (!existsSync(TRACKER)) return [];
  const lines = readFileSync(TRACKER, 'utf-8').split(/\r?\n/);
  const headers = [];
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (line.includes('---')) continue;
    if (!headers.length && cells.some((c) => /^#$/i.test(c))) {
      headers.push(...cells.slice(1, -1));
      continue;
    }
    if (headers.length && cells.length >= 9) {
      const vals = cells.slice(1, -1);
      const row = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
      if (/^\d+$/.test(row['#'] || '')) rows.push(row);
    }
  }
  return rows;
}

function findRow(selector) {
  const rows = parseTracker();
  if (/^\d+$/.test(selector)) return rows.find((r) => r['#'] === selector) || null;
  const q = slugify(selector);
  return rows.find((r) => slugify(r.Company || '').includes(q) || q.includes(slugify(r.Company || ''))) || null;
}

function followupsFor(sel) {
  if (!existsSync(FOLLOWUPS)) return false;
  const text = readFileSync(FOLLOWUPS, 'utf-8');
  const key = /^\d+$/.test(sel) ? sel : null;
  if (key) return new RegExp(`#${key}\\b|${key}\\s+2026`).test(text);
  const row = findRow(sel);
  if (!row) return false;
  return new RegExp(slugify(row.Company || ''), 'i').test(text) && new RegExp(slugify(row.Role || '').slice(0, 8), 'i').test(text);
}

function reportOk(report) {
  if (!report) return { ok: false, detail: 'report file not found — link may be dead' };
  const text = readFileSync(report, 'utf-8');
  const hasUrl = /\*\*URL:\*\*/.test(text);
  const hasLegit = /\*\*Legitimacy:\*\*/.test(text);
  const hasJd = /## Job Description/.test(text) || /local:jds\//.test(text);
  return { ok: hasUrl && hasLegit && hasJd, detail: `URL:${hasUrl} Legit:${hasLegit} JD:${hasJd}` };
}

function check(selector) {
  const row = findRow(selector);
  if (!row) return { selector, pass: false, failures: [MAXS.NOT_FOUND], checks: {} };
  const company = row.Company || selector;
  const role = row['Role / URL'] || row.Role || '';
  const notes = row.Notes || '';
  const report = (row.Report || '').match(/\(([^)]+\.md)\)/)?.[1];

  const slug = slugify(company);
  let cvExists = false;
  if (existsSync(OUT)) {
    cvExists = readdirSync(OUT).some((f) => new RegExp(`cv-shivanand-shah-${slug}(?:-|--|\.)`).test(f) && f.endsWith('.pdf'));
  }
  const coverOk = existsSync(OUT) && readdirSync(OUT).some((f) => f.toLowerCase().includes('cover') && f.toLowerCase().includes(slug));
  const notesAnchor = /[A-Z][^.]{20,}?(JD|posting|role|requisition|opportunity)[^.]*\./.test(notes);
  const followup = followupsFor(row['#']);
  const rep = reportOk(report ? resolve(DATA_ROOT, report.startsWith('../') ? report.slice(3) : report) : null);
  const profExists = existsSync(PROFILE);
  // Scan only the ACTIVE portion of the profile (up to the DEPRECATED VALUES
  // section) — the file documents the old bad values under `deprecated:`, which
  // is exactly where the anti-corruption check must NOT look.
  const profActive = profExists ? readFileSync(PROFILE, 'utf-8').split(/# DEPRECATED VALUES/)[0] : '';
  const formOk = profExists && !BAD_EDU.test(profActive);

  const failures = [];
  if (!cvExists) failures.push(MAXS.CV_MISSING);
  if (!coverOk && !notesAnchor) failures.push(MAXS.NO_COVER);
  if (!followup) failures.push(MAXS.NO_FOLLOWUP);
  if (!rep.ok) failures.push(`${MAXS.REPORT_BROKEN} (${rep.detail})`);
  if (!formOk) failures.push(MAXS.FORM_CORRUPTED);

  return {
    selector,
    company,
    role,
    rowNum: row['#'],
    score: row.Score,
    status: row.Status,
    pass: failures.length === 0,
    failures,
    checks: { cv: cvExists, cover: coverOk || notesAnchor, followup, report: rep.ok, form: formOk },
  };
}

const target = process.argv[2] && process.argv[2] !== '--json' ? process.argv[2] : undefined;
const json = process.argv.includes('--json');
const rows = parseTracker();
const applied = target ? [target] : rows.filter((r) => (r.Status || '') === 'Applied').map((r) => r['#']);

export function runAll({ silent = false } = {}) {
  const rows = parseTracker();
  const applied = rows.filter((r) => (r.Status || '') === 'Applied').map((r) => r['#']);
  const results = applied.map(check);
  const failing = results.filter((r) => !r.pass);
  return {
    applied: applied.length,
    failing: failing.length,
    failingRows: failing.map((f) => `#${f.rowNum}`),
    missingCover: failing.filter((f) => f.failures.includes(MAXS.NO_COVER)).length,
    missingFollowup: failing.filter((f) => f.failures.includes(MAXS.NO_FOLLOWUP)).length,
    missingJd: failing.filter((f) => /REPORT_BROKEN|report missing/.test((f.failures || []).join(' '))).length,
  };
}

const results = applied.map(check);
const failures = results.filter((r) => !r.pass);

if (isMainModule(import.meta.url)) {
  main(results, failures, applied.length, json, target);
}

function main(results, failures, checked, json, target) {
  if (json) {
    console.log(JSON.stringify({ checked, pass: failures.length === 0, applications: results }, null, 2));
    process.exit(failures.length ? 1 : 0);
  }

  if (!target && checked === 0) {
    console.log('No Applied rows in tracker — nothing to gate.');
    process.exit(0);
  }

  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`${icon} [${r.rowNum}] ${r.company} — ${r.role} (${r.score}, ${r.status})` + (r.pass ? '' : `\n    NON-STARTERS: ${r.failures.join(' · ')}`));
  }
  const summary = `\n${failures.length === 0 ? '🟢' : '🔴'} Gate: ${results.length - failures.length}/${results.length} applications SLA-clean`;
  console.log(summary + ` — fix before submitting: ${failures.map((f) => `#${f.rowNum}`).join(', ') || 'none'}`);
  process.exit(failures.length ? 1 : 0);
}