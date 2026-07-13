#!/usr/bin/env node
/**
 * followup-cadence.mjs — Follow-up Cadence Tracker for career-ops
 *
 * Parses applications.md + follow-ups.md, calculates follow-up cadence
 * for active applications, extracts contacts, and flags overdue entries.
 *
 * Run: node followup-cadence.mjs             (JSON to stdout)
 *      node followup-cadence.mjs --summary   (human-readable dashboard)
 *      node followup-cadence.mjs --overdue-only
 *      node followup-cadence.mjs --applied-days 10
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const FOLLOWUPS_FILE = join(CAREER_OPS, 'data/follow-ups.md');
const PROFILE_FILE = process.env.CAREER_OPS_PROFILE || join(CAREER_OPS, 'config/profile.yml');


// --- CLI args ---
const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const overdueOnly = args.includes('--overdue-only');
const appliedDaysIdx = args.indexOf('--applied-days');
const appliedDaysOverride = appliedDaysIdx !== -1 ? parseInt(args[appliedDaysIdx + 1], 10) : null;

// --- Cadence config ---
export const DEFAULT_CADENCE = {
  applied_first: 7,
  applied_subsequent: 7,
  applied_max_followups: 2,
  responded_initial: 1,
  responded_subsequent: 3,
  interview_thankyou: 1,
};

const PROFILE_CADENCE_KEYS = {
  applied_first_days: 'applied_first',
  applied_subsequent_days: 'applied_subsequent',
  applied_max_followups: 'applied_max_followups',
  responded_initial_days: 'responded_initial',
  responded_subsequent_days: 'responded_subsequent',
  interview_thankyou_days: 'interview_thankyou',
};

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function loadProfileCadence(profilePath = PROFILE_FILE) {
  if (!profilePath || !existsSync(profilePath)) return {};
  let raw;
  try {
    raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
  } catch {
    return {};
  }
  const source = raw.followup_cadence || {};
  const cadence = {};
  for (const [profileKey, cadenceKey] of Object.entries(PROFILE_CADENCE_KEYS)) {
    const parsed = positiveInteger(source[profileKey]);
    if (parsed !== null) cadence[cadenceKey] = parsed;
  }
  return cadence;
}

export function resolveCadenceConfig({ profilePath = PROFILE_FILE, appliedDays = appliedDaysOverride } = {}) {
  const cadence = { ...DEFAULT_CADENCE, ...loadProfileCadence(profilePath) };
  const cliApplied = positiveInteger(appliedDays);
  if (cliApplied !== null) cadence.applied_first = cliApplied;
  return cadence;
}

const CADENCE = resolveCadenceConfig();

// --- Status normalization (mirrors verify-pipeline.mjs) ---
const ALIASES = {
  'evaluada': 'evaluated', 'condicional': 'evaluated', 'hold': 'evaluated',
  'evaluar': 'evaluated', 'verificar': 'evaluated',
  'aplicado': 'applied', 'enviada': 'applied', 'aplicada': 'applied',
  'applied': 'applied', 'sent': 'applied',
  'respondido': 'responded',
  'entrevista': 'interview',
  'oferta': 'offer',
  'rechazado': 'rejected', 'rechazada': 'rejected',
  'descartado': 'discarded', 'descartada': 'discarded',
  'cerrada': 'discarded', 'cancelada': 'discarded',
  'no aplicar': 'skip', 'no_aplicar': 'skip', 'monitor': 'skip', 'geo blocker': 'skip',
};

const ACTIONABLE_STATUSES = ['applied', 'responded', 'interview'];

export function normalizeStatus(raw) {
  const clean = raw.replace(/\*\*/g, '').trim().toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  return ALIASES[clean] || clean;
}

// --- Date helpers ---
function today() {
  return new Date(new Date().toISOString().split('T')[0]);
}

export function parseDate(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) return null;
  return new Date(dateStr.trim());
}

// The tracker `date` column is often the evaluation date, while the real
// submission date is recorded in the notes as "Applied YYYY-MM-DD" (or
// "APPLIED ..."). Prefer that so cadence reflects when the application actually
// went out, not when the role was evaluated. Returns the first such date, or
// null when the notes don't carry one (caller falls back to the date column).
export function parseAppliedDate(notes) {
  if (!notes) return null;
  const m = String(notes).match(/\bapplied\s+(\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

export function daysBetween(d1, d2) {
  return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().split('T')[0];
}

// --- Parse applications.md ---
function parseTracker() {
  if (!existsSync(APPS_FILE)) return [];
  const content = readFileSync(APPS_FILE, 'utf-8');
  const lines = content.split('\n');
  const colmap = resolveColumns(lines);
  const entries = [];
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (row) entries.push(row);
  }
  return entries;
}

// --- Parse follow-ups.md ---
function parseFollowups() {
  if (!existsSync(FOLLOWUPS_FILE)) return [];
  const content = readFileSync(FOLLOWUPS_FILE, 'utf-8');
  const entries = [];
  for (const line of content.split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 8) continue;
    const num = parseInt(parts[1]);
    if (isNaN(num)) continue;
    entries.push({
      num,
      appNum: parseInt(parts[2]),
      date: parts[3],
      company: parts[4],
      role: parts[5],
      channel: parts[6],
      contact: parts[7],
      notes: parts[8] || '',
    });
  }
  return entries;
}

// --- Next-date overrides (pins) ---
// A user can PIN an application's next follow-up date, taking precedence over
// the computed cadence (a pin even revives a cold application) until a
// follow-up logged on/after the pin's set-date resumes the normal schedule.
// Stored in data/follow-ups.md as directive lines:
//   - next #42 2026-07-10 (set 2026-07-02)
// The `(set …)` part records when the pin was made; if omitted (hand-written)
// it defaults to the pinned date itself. The LAST pin line per application wins.
const OVERRIDE_RE = /^-\s+next\s+#(\d+)\s+(\d{4}-\d{2}-\d{2})(?:\s+\(set\s+(\d{4}-\d{2}-\d{2})\))?\s*$/i;

export function parseNextOverrides(content) {
  const byApp = new Map();
  for (const line of content.split('\n')) {
    const m = line.match(OVERRIDE_RE);
    if (!m) continue;
    const date = m[2];
    if (!parseDate(date)) continue; // an impossible pinned date never poisons the analysis
    const appNum = parseInt(m[1]);
    byApp.set(appNum, { appNum, date, setDate: m[3] || date });
  }
  return byApp;
}

// The pin applies until a follow-up is logged AFTER it. Ties favor the pin:
// "log a follow-up, then pin the next date" is the common same-day flow.
export function resolveNextOverride(override, lastFollowupDate) {
  if (!override) return null;
  if (lastFollowupDate && lastFollowupDate > override.setDate) return null;
  return override.date;
}

function parseOverrides() {
  if (!existsSync(FOLLOWUPS_FILE)) return new Map();
  return parseNextOverrides(readFileSync(FOLLOWUPS_FILE, 'utf-8'));
}

// --- Extract contacts from notes ---
function extractContacts(notes) {
  if (!notes) return [];
  const contacts = [];
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
  const emails = notes.match(emailRegex) || [];
  for (const email of emails) {
    // Try to extract name before email: "Emailed Name at" or "contact: Name"
    let name = null;
    const beforeEmail = notes.substring(0, notes.indexOf(email));
    const nameMatch = beforeEmail.match(/(?:Emailed|emailed|contact[:\s]+|to\s+)([A-Z][a-z]+ ?[A-Z]?[a-z]*)\s*(?:at|@|$)/i);
    if (nameMatch) name = nameMatch[1].trim();
    contacts.push({ email, name });
  }
  return contacts;
}

// --- Resolve report path ---
export function resolveReportPath(reportField, appsFile = APPS_FILE, repoRoot = CAREER_OPS) {
  const match = reportField.match(/\]\(([^)]+)\)/);
  if (!match) return null;
  // Report links in the tracker are normalized relative to the tracker file's
  // own directory (see PR #760 — `merge-tracker.mjs --migrate`). Resolve against
  // dirname(APPS_FILE), not the project root, otherwise relative paths like
  // `../reports/...` (the data/applications.md layout) escape above the project.
  const fullPath = join(dirname(appsFile), match[1]);
  const repoRelative = relative(repoRoot, fullPath).split(sep).join('/');
  if (repoRelative.startsWith('../') || repoRelative === '..' || !repoRelative.startsWith('reports/')) return null;
  return existsSync(fullPath) ? repoRelative : null;
}

// --- Compute urgency ---
export function computeUrgency(status, daysSinceApp, daysSinceLastFollowup, followupCount) {
  if (status === 'applied') {
    if (followupCount >= CADENCE.applied_max_followups) return 'cold';
    if (followupCount === 0 && daysSinceApp >= CADENCE.applied_first) return 'overdue';
    if (followupCount > 0 && daysSinceLastFollowup !== null && daysSinceLastFollowup >= CADENCE.applied_subsequent) return 'overdue';
    return 'waiting';
  }
  if (status === 'responded') {
    if (daysSinceApp < CADENCE.responded_initial) return 'urgent';
    if (daysSinceApp >= CADENCE.responded_subsequent) return 'overdue';
    return 'waiting';
  }
  if (status === 'interview') {
    if (daysSinceApp >= CADENCE.interview_thankyou) return 'overdue';
    return 'waiting';
  }
  return 'waiting';
}

// --- Compute next follow-up date ---
export function computeNextFollowupDate(status, appDate, lastFollowupDate, followupCount) {
  if (status === 'applied') {
    if (followupCount >= CADENCE.applied_max_followups) return null; // cold
    if (followupCount === 0) return addDays(parseDate(appDate), CADENCE.applied_first);
    if (lastFollowupDate) return addDays(parseDate(lastFollowupDate), CADENCE.applied_subsequent);
    return addDays(parseDate(appDate), CADENCE.applied_first);
  }
  if (status === 'responded') {
    if (lastFollowupDate) return addDays(parseDate(lastFollowupDate), CADENCE.responded_subsequent);
    return addDays(parseDate(appDate), CADENCE.responded_initial);
  }
  if (status === 'interview') {
    return addDays(parseDate(appDate), CADENCE.interview_thankyou);
  }
  return null;
}

// --- Main analysis ---
function analyze() {
  const apps = parseTracker();
  if (apps.length === 0) {
    return { error: 'No applications found in tracker.' };
  }

  const followups = parseFollowups();
  const overrides = parseOverrides();

  // Group follow-ups by app number
  const followupsByApp = new Map();
  for (const fu of followups) {
    if (!followupsByApp.has(fu.appNum)) followupsByApp.set(fu.appNum, []);
    followupsByApp.get(fu.appNum).push(fu);
  }

  const now = today();
  const entries = [];

  for (const app of apps) {
    const normalized = normalizeStatus(app.status);
    if (!ACTIONABLE_STATUSES.includes(normalized)) continue;

    // Prefer the "Applied YYYY-MM-DD" date from notes; fall back to the column.
    const appliedDate = parseAppliedDate(app.notes) || app.date;
    const appDate = parseDate(appliedDate);
    if (!appDate) continue;

    const daysSinceApp = daysBetween(appDate, now);
    const appFollowups = followupsByApp.get(app.num) || [];
    const followupCount = appFollowups.length;

    // Find most recent follow-up
    let lastFollowupDate = null;
    let daysSinceLastFollowup = null;
    if (appFollowups.length > 0) {
      const sorted = appFollowups.sort((a, b) => (a.date > b.date ? -1 : 1));
      lastFollowupDate = sorted[0].date;
      const lastDate = parseDate(lastFollowupDate);
      if (lastDate) daysSinceLastFollowup = daysBetween(lastDate, now);
    }

    let urgency = computeUrgency(normalized, daysSinceApp, daysSinceLastFollowup, followupCount);
    let nextFollowupDate = computeNextFollowupDate(normalized, appliedDate, lastFollowupDate, followupCount);

    // A pinned next-date takes precedence over the computed cadence (explicit
    // user intent — it even revives a cold application) until a follow-up
    // logged after the pin resumes the normal schedule.
    const nextOverride = resolveNextOverride(overrides.get(app.num), lastFollowupDate);
    if (nextOverride) {
      nextFollowupDate = nextOverride;
      urgency = daysBetween(parseDate(nextOverride), now) >= 0 ? 'overdue' : 'waiting';
    }

    const nextDate = nextFollowupDate ? parseDate(nextFollowupDate) : null;
    const daysUntilNext = nextDate ? daysBetween(now, nextDate) : null;

    const contacts = extractContacts(app.notes);
    const reportPath = resolveReportPath(app.report);

    entries.push({
      num: app.num,
      date: app.date,
      appliedDate,
      company: app.company,
      // Intermediary channel (#1596): agency name when the application went
      // through an intermediary, null for a direct application (the tracker's
      // `—` placeholder and the no-Via-column case both normalize to null, so
      // consumers never learn the sentinel). When set, follow-ups chase the
      // agency contact, not the company.
      via: app.via && app.via !== '—' ? app.via : null,
      role: app.role,
      status: normalized,
      score: app.score,
      notes: app.notes,
      reportPath,
      contacts,
      daysSinceApplication: daysSinceApp,
      daysSinceLastFollowup,
      followupCount,
      urgency,
      nextFollowupDate,
      nextOverride,
      daysUntilNext,
    });
  }

  // Sort by urgency priority: urgent > overdue > waiting > cold
  const urgencyOrder = { urgent: 0, overdue: 1, waiting: 2, cold: 3 };
  entries.sort((a, b) => (urgencyOrder[a.urgency] ?? 9) - (urgencyOrder[b.urgency] ?? 9));

  const filtered = overdueOnly
    ? entries.filter(e => e.urgency === 'overdue' || e.urgency === 'urgent')
    : entries;

  return {
    metadata: {
      analysisDate: now.toISOString().split('T')[0],
      totalTracked: apps.length,
      actionable: entries.length,
      overdue: entries.filter(e => e.urgency === 'overdue').length,
      urgent: entries.filter(e => e.urgency === 'urgent').length,
      cold: entries.filter(e => e.urgency === 'cold').length,
      waiting: entries.filter(e => e.urgency === 'waiting').length,
    },
    entries: filtered,
    cadenceConfig: CADENCE,
  };
}

// --- Summary mode ---
function printSummary(result) {
  if (result.error) {
    console.log(`\n${result.error}\n`);
    return;
  }

  const { metadata, entries } = result;

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Follow-up Cadence Dashboard — ${metadata.analysisDate}`);
  console.log(`  ${metadata.totalTracked} total applications, ${metadata.actionable} actionable`);
  console.log(`${'='.repeat(70)}\n`);

  if (entries.length === 0) {
    console.log('  No active applications to track. Apply to some roles first.\n');
    return;
  }

  // Status summary
  const urgencyIcon = { urgent: 'URGENT', overdue: 'OVERDUE', waiting: 'waiting', cold: 'COLD' };
  console.log(`  ${metadata.urgent} urgent | ${metadata.overdue} overdue | ${metadata.waiting} waiting | ${metadata.cold} cold\n`);

  // Table header
  console.log('  ' + '#'.padEnd(5) + 'Company'.padEnd(16) + 'Status'.padEnd(12) + 'Days'.padEnd(6) + 'F/U'.padEnd(5) + 'Next'.padEnd(13) + 'Urgency'.padEnd(10) + 'Contact');
  console.log('  ' + '-'.repeat(80));

  for (const e of entries) {
    const urgLabel = urgencyIcon[e.urgency] || e.urgency;
    const nextStr = e.nextFollowupDate || '-';
    const contactStr = e.contacts.length > 0 ? e.contacts[0].email : '-';
    console.log(
      '  ' +
      String(e.num).padEnd(5) +
      e.company.substring(0, 15).padEnd(16) +
      e.status.padEnd(12) +
      String(e.daysSinceApplication).padEnd(6) +
      String(e.followupCount).padEnd(5) +
      nextStr.padEnd(13) +
      urgLabel.padEnd(10) +
      contactStr
    );
  }

  console.log('');
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = analyze();

  if (summaryMode) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  if (result.error) process.exit(1);
}
