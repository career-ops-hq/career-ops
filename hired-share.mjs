#!/usr/bin/env node
/**
 * hired-share.mjs — draft a Hired Wall story from data the tracker already
 * holds, show the EXACT payload, and open a prefilled GitHub issue for the
 * user to review and submit themselves.
 *
 * Human-in-the-loop is the contract: this script never posts anything. The
 * only thing that leaves the machine is what the user submits from their own
 * GitHub account, after seeing every field. career-ops has no backend and no
 * telemetry; the public ledger is the repo itself (HIRED.md + the issues).
 *
 *   node hired-share.mjs --report 12                      # draft from tracker row 12
 *   node hired-share.mjs --report 12 --anonymity role     # role-and-location card, no handle
 *   node hired-share.mjs --report 12 --story "..." --open # custom quote + open the browser
 *   node hired-share.mjs --status                         # hires recorded but never asked
 *   node hired-share.mjs --report 12 --mark never         # user said no: never ask again
 *
 * Anonymity levels (asked, never defaulted to the most exposed):
 *   handle → card shows @login and avatar (full credit)
 *   role   → card shows role + location only (default)
 *   count  → counts on the badge, no card
 *
 * The ask cadence lives in data/.hired-share-state.json (user layer, never
 * committed): one ask per hire at outcome time, at most one gentle re-mention
 * after an update if the answer was "later" (>30 days), and "never" is
 * permanent. A flywheel that nags stops being a celebration.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { parseTrackerRow, resolveColumns, isSeparatorRow, isHeaderRow } from './tracker-parse.mjs';
import { resolveTrackerPath, resolveWorkspaceRoot } from './tracker-utils.mjs';

const REPO_URL = 'https://github.com/career-ops-hq/career-ops';
const TEMPLATE = 'i-got-hired.yml';
const LEVELS = ['handle', 'role', 'count'];

const KNOWN_FLAGS = ['--report', '--anonymity', '--story', '--weeks', '--feature', '--open', '--dry-run', '--status', '--mark', '--root', '--help', '-h'];
const VALUE_FLAGS = ['--report', '--anonymity', '--story', '--weeks', '--feature', '--mark', '--root'];

const USAGE = `Usage:
  node hired-share.mjs --report N [--anonymity handle|role|count] [--story "..."]
                       [--weeks N] [--feature "..."] [--open] [--dry-run]
  node hired-share.mjs --status
  node hired-share.mjs --report N --mark shared|later|never

Drafts a Hired Wall story from tracker row N, prints the exact payload, and
builds a prefilled GitHub issue URL. Nothing is posted by this script: the
user reviews on GitHub and submits from their own account. --status lists
hires recorded in the tracker that were never offered a share. --mark records
the user's answer so the question is never repeated against their wishes.`;

/** State file: the entire anti-nag memory. User layer, gitignored with data/. */
function statePath(root) { return join(root, 'data', '.hired-share-state.json'); }
function loadState(root) {
  const p = statePath(root);
  if (!existsSync(p)) return { byReport: {} };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { byReport: {} }; }
}
function saveState(root, s) { writeFileSync(statePath(root), JSON.stringify(s, null, 2) + '\n'); }

/** All tracker rows whose canonical state is Hired, as {report, role, company, location, date}. */
export function hiredRows(trackerText) {
  const lines = trackerText.split('\n');
  const colmap = resolveColumns(lines);
  const out = [];
  for (const line of lines) {
    if (!line.startsWith('|') || isSeparatorRow(line) || isHeaderRow(line)) continue;
    const row = parseTrackerRow(line, colmap);
    if (!row || !/hired/i.test(row.status ?? '')) continue;
    // The Report cell is a markdown link ("[12](reports/12.md)"): the report
    // number is its FIRST run of digits, never a digit-strip of the whole cell.
    out.push({
      report: (String(row.report ?? '').match(/\d+/) || [''])[0],
      role: row.role ?? '',
      company: row.company ?? '',
      location: row.location ?? '',
      date: row.date ?? '',
    });
  }
  return out;
}

/**
 * Weeks from the earliest scan-history date to `endIso`. The search started
 * when the first posting was seen, not when this row appeared; that is the
 * number a reader deciding whether to try the tool actually wants. Returns
 * null when it cannot be derived — the field is optional and the user can
 * always pass --weeks.
 */
export function weeksFromScanHistory(scanHistoryText, endIso) {
  if (!scanHistoryText || !endIso) return null;
  let earliest = null;
  for (const line of scanHistoryText.split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2})\t/);
    if (m && (!earliest || m[1] < earliest)) earliest = m[1];
  }
  if (!earliest) return null;
  const ms = new Date(`${endIso}T12:00:00Z`) - new Date(`${earliest}T12:00:00Z`);
  if (!(ms > 0)) return null;
  return Math.max(1, Math.round(ms / (7 * 86400e3)));
}

/**
 * The prefilled issue URL. GitHub issue forms accept query params keyed by
 * field id; dropdowns need the exact option text. Everything the user will
 * see on GitHub is exactly what this URL carries — printed in full first.
 */
export function buildIssueUrl({ role, companyType, story, feature, timeToHire, anonymity }) {
  const q = new URLSearchParams();
  q.set('template', TEMPLATE);
  q.set('title', `Hired: ${role}`);
  if (role) q.set('role', role);
  if (companyType) q.set('company_type', companyType);
  if (story) q.set('story', story);
  if (feature) q.set('feature', feature);
  if (timeToHire) q.set('time_to_hire', timeToHire);
  q.set('anonymity', {
    handle: 'With my GitHub handle (full credit)',
    role: 'Role and location only, no handle',
    count: 'Just count me, no card',
  }[anonymity]);
  return `${REPO_URL}/issues/new?${q.toString()}`;
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch { return false; }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { console.log(USAGE); return; }
  const bad = validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: VALUE_FLAGS, requireOperand: true });
  if (bad) { process.exitCode = 1; return; }

  const root = flagValue(args, '--root') || resolveWorkspaceRoot(resolveTrackerPath(process.cwd()));
  const trackerPath = resolveTrackerPath(root);
  const tracker = existsSync(trackerPath) ? readFileSync(trackerPath, 'utf8') : '';
  const hires = hiredRows(tracker);
  const state = loadState(root);

  if (hasFlag(args, '--status')) {
    // For the agent's post-update moment: which hires were never asked, and
    // which said "later" long enough ago that ONE gentle re-mention is fair.
    const now = Date.now();
    const rows = hires.map((h) => {
      const s = state.byReport[h.report];
      const staleLater = s?.status === 'later' && s.askedAt && (now - new Date(s.askedAt)) > 30 * 86400e3;
      return { ...h, asked: Boolean(s), status: s?.status ?? 'never-asked', mentionable: !s || staleLater };
    });
    console.log(JSON.stringify({ hires: rows, askable: rows.filter((r) => r.mentionable).map((r) => r.report) }, null, 2));
    return;
  }

  const report = flagValue(args, '--report');
  if (!report) { console.error(`--report is required (or use --status).\n\n${USAGE}`); process.exitCode = 1; return; }
  const hire = hires.find((h) => h.report === String(report).replace(/[^\d]/g, ''));
  if (!hire) {
    console.error(`No tracker row with state Hired and report #${report}. Record the outcome first: node outcome.mjs ${report} hired`);
    process.exitCode = 1; return;
  }

  const mark = flagValue(args, '--mark');
  if (mark) {
    if (!['shared', 'later', 'never'].includes(mark)) { console.error(`--mark must be shared|later|never.\n\n${USAGE}`); process.exitCode = 1; return; }
    state.byReport[hire.report] = { status: mark, askedAt: new Date().toISOString() };
    saveState(root, state);
    console.log(`report #${hire.report} marked "${mark}"${mark === 'never' ? ' — this hire will never be brought up again' : ''}.`);
    return;
  }

  const anonymity = flagValue(args, '--anonymity') || 'role';
  if (!LEVELS.includes(anonymity)) { console.error(`--anonymity must be one of: ${LEVELS.join('|')}.\n\n${USAGE}`); process.exitCode = 1; return; }

  let weeks = flagValue(args, '--weeks');
  if (!weeks) {
    const shPath = join(root, 'data', 'scan-history.tsv');
    weeks = weeksFromScanHistory(existsSync(shPath) ? readFileSync(shPath, 'utf8') : '', hire.date) ?? '';
  }

  const story = flagValue(args, '--story') || '';
  const feature = flagValue(args, '--feature') || '';
  const payload = {
    role: hire.role,
    companyType: '',
    story,
    feature,
    timeToHire: weeks ? `${weeks} weeks` : '',
    anonymity,
  };

  const url = buildIssueUrl(payload);
  console.log('This is EXACTLY what the prefilled issue will contain — nothing more:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\nReview and submit it yourself on GitHub (nothing has been sent):');
  console.log(url);

  if (hasFlag(args, '--dry-run')) return;

  state.byReport[hire.report] = { status: 'drafted', askedAt: new Date().toISOString() };
  saveState(root, state);

  if (hasFlag(args, '--open')) {
    if (!openInBrowser(url)) console.log('(could not open a browser here — copy the URL above)');
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
