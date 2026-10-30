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

import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { parseTrackerRow, resolveColumns, isSeparatorRow, isHeaderRow, parseMarkdownLinks, extractTrackerReportNumbers } from './tracker-parse.mjs';
import { resolveTrackerPath, resolveWorkspaceRoot, writeFileAtomic, acquireTrackerLock, loadCanonicalStates, resolveCanonicalStateId } from './tracker-utils.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { fileURLToPath } from 'url';

// System-layer states.yml resolves from the codebase, not the data root (#3500).
const CODEBASE_ROOT = dirname(fileURLToPath(import.meta.url));
let statesCache = null;
/** Canonical states from templates/states.yml, read once per process. */
function canonicalStates() {
  if (statesCache) return statesCache;
  // Throws on a broken install rather than degrading to "no rows match":
  // drafting a wrong Hired Wall story is worse than stopping.
  statesCache = loadCanonicalStates(join(CODEBASE_ROOT, 'templates', 'states.yml'));
  return statesCache;
}

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

/**
 * Raised when the anti-nag memory exists and cannot be trusted.
 *
 * Deliberately not a silent fallback: the file records which hires the user
 * declined to share, and an empty memory is indistinguishable from "nobody has
 * ever been asked". Failing loudly asks the user to fix one file; failing
 * quietly asks them about a hire they already said no to.
 */
class StateError extends Error {
  constructor(message) { super(message); this.name = 'StateError'; }
}

/** State file: the entire anti-nag memory. User layer, gitignored with data/. */
function statePath(root) { return join(root, 'data', '.hired-share-state.json'); }
function loadState(root) {
  const p = statePath(root);
  // Absent is a first run — an empty memory is the correct answer.
  if (!existsSync(p)) return { byReport: {} };
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (err) {
    throw new StateError(`cannot read ${p} (${err.message})`);
  }
  // Unreadable is NOT a first run, and returning an empty memory for it is how
  // a "never" answer disappears. AGENTS.md's cadence rule is absolute — "If
  // they say no: --mark never, and honor it — that hire is never brought up
  // again" — and this file is the only thing that remembers. An empty object
  // here means every declined hire becomes askable, and the next saveState
  // persists that, so one unreadable byte erases the record permanently.
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new StateError(`${p} does not contain a JSON object`);
    }
    // ABSENT is fine — a file written before this key existed, or one that has
    // only ever recorded nothing, is an empty memory and `{}` is the right
    // answer. PRESENT BUT NOT AN OBJECT is the same reset one level down: a
    // string or an array here was silently replaced with `{}` and then written
    // back by saveState, dropping every declined hire exactly as a corrupt file
    // used to. Refuse it for the same reason the top level is refused.
    if (parsed.byReport === undefined || parsed.byReport === null) parsed.byReport = {};
    else if (typeof parsed.byReport !== 'object' || Array.isArray(parsed.byReport)) {
      throw new StateError(`${p} has a "byReport" that is not an object — fix or delete it.`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof StateError) throw err;
    throw new StateError(`${p} is not valid JSON (${String(err.message).split('\n')[0]})`);
  }
}
// Atomic, via the same helper every tracker writer uses. A plain writeFileSync
// truncates before it writes, so an interrupt — Ctrl-C, a full disk, a crash —
// leaves a half-written file. That file then fails to parse, which is exactly
// the condition the guard above now refuses to paper over: the non-atomic write
// is what MANUFACTURES the corruption the silent reset used to hide.
function saveState(root, s) {
  // A root on the legacy layout (applications.md at the top, no data/) still
  // resolves its hires, so data/ may not exist yet when the answer is recorded.
  const p = statePath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileAtomic(p, JSON.stringify(s, null, 2) + '\n');
}

/**
 * A report id in its canonical, unpadded form.
 *
 * Report numbers are unpadded everywhere in the tracker (`12`, not `012`), so
 * a flag that keeps its zeros has to reach the same row: `--report 012` is
 * the same request as `--report 12`.
 *
 * A value that is not a number is NOT a report id: stripping the letters out
 * of `--report 1x2` would record a decision for report 12, so an invalid id
 * is rejected instead of guessed.
 *
 * @param {string|number} value - A report id as typed.
 * @returns {string|null} The digits without leading zeros, or null when the
 *   value is not a number.
 */
function normalizeReportId(value) {
  const digits = String(value ?? '').trim();
  if (!/^\d+$/.test(digits)) return null;
  return digits.replace(/^0+(?=\d)/, '');
}

/**
 * The key a report's answer lives under in the state file.
 *
 * Report ids became unpadded with this change, so a state file written
 * earlier still holds "012" where the row's id is now "12". A declined hire
 * is meant to stay declined forever, so the lookup finds the old padded key
 * by its unpadded form — and a new answer is written under the key that is
 * already there, instead of adding a second one for the same hire.
 *
 * When a file holds BOTH forms of one id, a recorded decline wins: the
 * answer is the strongest one on record, so "never" under "012" is not
 * shadowed by "later" under "12" and the hire cannot become mentionable
 * again.
 *
 * @param {{byReport: Record<string, any>}} state - The loaded state.
 * @param {string} report - The report id.
 * @returns {string} The key to read and write.
 */
function stateKeyFor(state, report) {
  const byReport = state?.byReport ?? {};
  const id = String(report);
  const target = normalizeReportId(id);
  if (target == null) return id;
  const matches = Object.keys(byReport).filter((key) => normalizeReportId(key) === target);
  if (matches.length === 0) return id;
  const declined = matches.find((key) => byReport[key]?.status === 'never');
  if (declined) return declined;
  return id in byReport ? id : matches[0];
}

async function recordDecision(root, report, status) {
  mkdirSync(join(root, 'data'), { recursive: true });
  const lock = await acquireTrackerLock(`${statePath(root)}.lock`, { tracker: statePath(root) });
  try {
    const state = loadState(root);
    const key = stateKeyFor(state, report);
    if (status === 'drafted' && state.byReport[key]?.status === 'never') return;
    state.byReport[key] = { status, askedAt: new Date().toISOString() };
    saveState(root, state);
  } finally {
    lock.release();
  }
}

/**
 * True for a target that points at this install rather than at the web.
 *
 * A protocol-relative or absolute-URL target is somebody else's page, so its
 * digits are never a report number of ours.
 *
 * @param {string} target
 * @returns {boolean}
 */
function isLocalTarget(target) {
  if (!target) return false;
  if (target.startsWith('//')) return false;
  return !/^[a-z][a-z0-9+.-]*:/i.test(target);
}

/**
 * Report number from a Report cell the canonical parser could not resolve.
 *
 * The canonical parser only resolves report links written in the
 * `{num}-{slug}.md` convention, so a tracker that links `reports/12.md` — a
 * shape the tracker family has always accepted — resolves to nothing and
 * `--report 12` would not find the row. The Report cell holds a report link
 * by contract, so for a LOCAL link its numeric label (or the leading digits
 * of its filename) is the report id. An external link never is: a tracker
 * cell can hold a third-party posting URL whose digits mean nothing here.
 *
 * @param {string} cell - Raw Report cell.
 * @returns {number|null} The report number, or null when there is none.
 */
function reportNumberFromReportCell(cell) {
  const value = String(cell ?? '').trim();
  if (!value) return null;
  const links = parseMarkdownLinks(value);
  for (const link of links) {
    const target = String(link.target ?? '').trim().replace(/^<|>$/g, '');
    if (!isLocalTarget(target)) continue;
    const label = String(link.label ?? '').trim();
    if (/^\d+$/.test(label) && Number(label) > 0) return Number(label);
    const base = target.split(/[\\/]/).pop() ?? '';
    const match = base.match(/^(\d+)(?:-|\.|$)/);
    if (match) return Number(match[1]);
  }
  if (links.length > 0) return null;
  // A bare path, no link syntax: the filename carries the number.
  if (!isLocalTarget(value)) return null;
  const base = value.split(/[\\/]/).pop() ?? '';
  const match = base.match(/^(\d+)(?:-|\.|$)/);
  return match ? Number(match[1]) : null;
}

/** All tracker rows whose canonical state is Hired, as {report, role, company, location, date}. */
export function hiredRows(trackerText) {
  const lines = trackerText.split('\n');
  const colmap = resolveColumns(lines);
  const out = [];
  for (const line of lines) {
    if (!line.startsWith('|') || isSeparatorRow(line) || isHeaderRow(line)) continue;
    const row = parseTrackerRow(line, colmap);
    // Exact canonical state, never a substring: `/hired/i` used to count any
    // future state containing "hired" (NotHired, PreHired) as a landed job.
    // resolveCanonicalStateId returns the canonical ID ("hired"), case-folded.
    if (!row || resolveCanonicalStateId(row.status ?? '', canonicalStates()) !== 'hired') continue;
    // The canonical report parser, never a digit grab off the whole cell: the
    // FIRST-run-of-digits rule answered `reports/012-acme.md` as "012", so
    // `--report 12` found nothing. Numbers come back unpadded, label first.
    const reportNumbers = extractTrackerReportNumbers(row.report ?? '', row.notes ?? '');
    const loose = reportNumbers.length > 0 ? null : reportNumberFromReportCell(row.report ?? '');
    out.push({
      report: reportNumbers.length > 0 ? String(reportNumbers[0]) : (loose != null ? String(loose) : ''),
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

  // Default to the configured data root (CAREER_OPS_ROOT / CAREER_OPS_DATA_DIR /
  // .career-ops-data marker), not process.cwd(): with the user layer outside the
  // checkout, the cwd-derived root found no tracker and reported no hires.
  const root = flagValue(args, '--root') || resolveWorkspaceRoot(resolveTrackerPath(getCareerOpsRoot()));
  const trackerPath = resolveTrackerPath(root);
  const tracker = existsSync(trackerPath) ? readFileSync(trackerPath, 'utf8') : '';
  const hires = hiredRows(tracker);
  const state = loadState(root);

  if (hasFlag(args, '--status')) {
    // For the agent's post-update moment: which hires were never asked, and
    // which said "later" long enough ago that ONE gentle re-mention is fair.
    const now = Date.now();
    const rows = hires.map((h) => {
      const s = state.byReport[stateKeyFor(state, h.report)];
      const staleLater = s?.status === 'later' && s.askedAt && (now - new Date(s.askedAt)) > 30 * 86400e3;
      return { ...h, asked: Boolean(s), status: s?.status ?? 'never-asked', mentionable: !s || staleLater };
    });
    console.log(JSON.stringify({ hires: rows, askable: rows.filter((r) => r.mentionable).map((r) => r.report) }, null, 2));
    return;
  }

  const report = flagValue(args, '--report');
  if (!report) { console.error(`--report is required (or use --status).\n\n${USAGE}`); process.exitCode = 1; return; }
  // A report id is a number: `--report 1x2` is a typo, not report 12.
  const reportId = normalizeReportId(report);
  if (reportId == null) {
    console.error(`--report must be a report number, got ${JSON.stringify(report)}.\n\n${USAGE}`);
    process.exitCode = 1; return;
  }
  const hire = hires.find((h) => h.report === reportId);
  if (!hire) {
    console.error(`No tracker row with state Hired and report #${reportId}. Record the outcome first: node outcome.mjs ${reportId} hired`);
    process.exitCode = 1; return;
  }

  const mark = flagValue(args, '--mark');
  if (mark) {
    if (!['shared', 'later', 'never'].includes(mark)) { console.error(`--mark must be shared|later|never.\n\n${USAGE}`); process.exitCode = 1; return; }
    await recordDecision(root, hire.report, mark);
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

  await recordDecision(root, hire.report, 'drafted');

  if (hasFlag(args, '--open')) {
    if (!openInBrowser(url)) console.log('(could not open a browser here — copy the URL above)');
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exitCode = 1; });
}
