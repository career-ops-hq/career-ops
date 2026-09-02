#!/usr/bin/env node
/**
 * merge-tracker.mjs — Merge batch tracker additions into applications.md
 *
 * Handles multiple TSV formats:
 * - 9-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes
 * - 8-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport (no notes)
 * - Pipe-delimited (markdown table row): | col | col | ... |
 *
 * Dedup: company normalized + role fuzzy match + report number match
 * If duplicate with higher score → update in-place, update report link
 * Validates status against states.yml (rejects non-canonical, logs warning)
 *
 * Run: node career-ops/merge-tracker.mjs [--dry-run] [--verify]
 */

import { readFileSync, readdirSync, mkdirSync, renameSync, existsSync } from 'fs';
import { join, basename, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { normalizeReportLink as normalizeLink } from './tracker-links.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { roleFuzzyMatch } from './role-matcher.mjs';
import { parsePdfIndex } from './find.mjs';
import { LEGACY_COLMAP, detectColumns, isHeaderRow, resolveScoreStatus, normalizeVia, SEPARATOR_ROW_RE } from './tracker-parse.mjs';
import { resolveTrackerPath, resolveWorkspaceRoot, resolvePdfIndexPath, trackerLockDirFor, acquireTrackerLock, writeFileAtomic, normalizeCompany, cell } from './tracker-utils.mjs';
// Canonical posting-URL key. Kept in its own module so scan.mjs / scan-history
// can adopt the same key later without the definitions drifting.
import { normalizeUrl } from './url-key.mjs';

const CAREER_OPS = getCareerOpsRoot();
// Support both layouts: data/applications.md (boilerplate) and applications.md
// (original). CAREER_OPS_TRACKER overrides the path (used by tests and
// non-standard layouts). Resolution lives in tracker-utils.mjs so every tracker
// writer agrees on the same canonical path (and therefore the same lock).
const APPS_FILE = resolveTrackerPath(CAREER_OPS);
const TRACKER_DIR = dirname(APPS_FILE);
// CAREER_OPS_ADDITIONS overrides the additions dir (used by tests, mirrors CAREER_OPS_TRACKER).
const ADDITIONS_DIR = process.env.CAREER_OPS_ADDITIONS
  ? process.env.CAREER_OPS_ADDITIONS
  : join(CAREER_OPS, 'batch/tracker-additions');
const MERGED_DIR = join(ADDITIONS_DIR, 'merged');
// CAREER_OPS_BATCH_STATE overrides the batch-state.tsv path (used by tests).
const BATCH_STATE_FILE = process.env.CAREER_OPS_BATCH_STATE
  ? process.env.CAREER_OPS_BATCH_STATE
  : join(CAREER_OPS, 'batch/batch-state.tsv');

// Cross-check against batch-state.tsv (found 2026-07-30): a worker can write
// a well-formed tracker TSV even when its own JSON result said "failed" --
// e.g. two workers that fabricated a placeholder score (0.0/5, "Suspicious")
// for a posting they never actually read, after being unable to extract the
// JD. batch-runner.sh's JSON-status detection is the authority on whether an
// offer really succeeded; a TSV whose report number maps to a "failed" row
// there is fabricated evidence, not just cosmetically ambiguous like the
// score/status column-swap check below -- it must never merge, however
// well-formed the TSV itself looks in isolation.
function loadFailedReportNumbers(path) {
  const failed = new Set();
  if (!existsSync(path)) return failed;
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('id\t')) continue;
    const cols = line.split('\t');
    if (cols.length < 6) continue;
    const status = cols[2];
    const reportNum = cols[5];
    if (status === 'failed' && reportNum && reportNum !== '-') {
      const n = parseInt(reportNum, 10);
      if (!isNaN(n)) failed.add(n);
    }
  }
  return failed;
}
const FAILED_REPORT_NUMBERS = loadFailedReportNumbers(BATCH_STATE_FILE);
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');
const MIGRATE = process.argv.includes('--migrate');
const MIGRATE_VIA = process.argv.includes('--migrate-via');
const BACKFILL_URLS = process.argv.includes('--backfill-urls');
const MERGE_HOLD_MS = Number(process.env.CAREER_OPS_MERGE_HOLD_MS) || 0;
const MERGE_READY_IPC = process.env.CAREER_OPS_MERGE_READY_IPC === '1';

const TRACKER_LOCK_DIR = trackerLockDirFor(APPS_FILE);

// The reports/ dir sits at the repo root, which is the tracker's parent in the
// data/ layout (data/applications.md) and the tracker's own dir at root layout.
// Shared with sync-pdf-flags.mjs so the two agree on where a workspace's
// siblings live — they disagreed before #2471.
const REPORTS_ROOT = resolveWorkspaceRoot(APPS_FILE);
const PDF_INDEX_FILE = resolvePdfIndexPath(APPS_FILE);

/**
 * Normalize report links before writing them into the tracker file.
 *
 * TSV additions use root-relative report links so they are easy for agents to
 * generate. The tracker may live either at `data/applications.md` or at the
 * repository root, so this wrapper binds the correct tracker and reports
 * directories before delegating to the shared link normalizer.
 *
 * @param {string} reportField - Raw report cell from a TSV addition.
 * @returns {string} Markdown report link relative to the tracker file.
 */
const normalizeReportLink = (reportField) => normalizeLink(reportField, TRACKER_DIR, REPORTS_ROOT);

// Ensure required directories exist (fresh setup)
mkdirSync(join(CAREER_OPS, 'data'), { recursive: true });
mkdirSync(ADDITIONS_DIR, { recursive: true });

/**
 * Pause the async merge flow for a fixed number of milliseconds.
 *
 * Used by the regression test hook (`CAREER_OPS_MERGE_HOLD_MS`), which
 * deliberately holds the first merge after it reads `applications.md` so a
 * second merge can try to enter the same critical section. (The lock retry
 * loop's own sleep lives in tracker-utils.mjs with the lock.)
 *
 * @param {number} ms - Milliseconds to wait before resolving.
 * @returns {Promise<void>} Resolves after the requested delay.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let trackerLock;
try {
  trackerLock = await acquireTrackerLock(TRACKER_LOCK_DIR, {
    timeoutMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS) || 60_000,
    retryMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_RETRY_MS) || 75,
    staleMs: Number(process.env.CAREER_OPS_TRACKER_LOCK_STALE_MS) || 10 * 60_000,
    tracker: APPS_FILE,
  });
  process.once('exit', () => trackerLock?.release());
  if (trackerLock.waitMs > 0 || trackerLock.staleRecovered) {
    console.log(`🔒 Tracker merge lock acquired (wait_ms=${trackerLock.waitMs} | attempts=${trackerLock.attempts} | stale_recovered=${trackerLock.staleRecovered})`);
  }
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

// Canonical states and aliases
const CANONICAL_STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Hired', 'Rejected', 'Discarded', 'SKIP'];

/**
 * Convert raw addition status text into one canonical tracker state.
 *
 * Batch workers and older tracker additions may emit Spanish labels, bold
 * Markdown, legacy date suffixes, or repost markers. The merge script normalizes
 * all of those variants here so applications.md keeps the states defined by
 * templates/states.yml.
 *
 * @param {string} status - Raw status string from a TSV or pipe-delimited row.
 * @returns {string} Canonical tracker status.
 */
function validateStatus(status) {
  const clean = status.replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const lower = clean.toLowerCase();

  for (const valid of CANONICAL_STATES) {
    if (valid.toLowerCase() === lower) return valid;
  }

  // Aliases
  const aliases = {
    // Spanish → English
    'evaluada': 'Evaluated', 'condicional': 'Evaluated', 'hold': 'Evaluated', 'evaluar': 'Evaluated', 'verificar': 'Evaluated',
    'aplicado': 'Applied', 'enviada': 'Applied', 'aplicada': 'Applied', 'applied': 'Applied', 'sent': 'Applied',
    'respondido': 'Responded',
    'entrevista': 'Interview',
    'oferta': 'Offer',
    'rechazado': 'Rejected', 'rechazada': 'Rejected',
    'contratado': 'Hired', 'contratada': 'Hired', 'accepted': 'Hired', 'accept': 'Hired',
    'descartado': 'Discarded', 'descartada': 'Discarded', 'cerrada': 'Discarded', 'cancelada': 'Discarded',
    'no aplicar': 'SKIP', 'no_aplicar': 'SKIP', 'skip': 'SKIP', 'monitor': 'SKIP',
    'geo blocker': 'SKIP',
  };

  if (aliases[lower]) return aliases[lower];

  // DUPLICADO/Repost → Discarded
  if (/^(duplicado|dup|repost)/i.test(lower)) return 'Discarded';

  console.warn(`⚠️  Non-canonical status "${status}" → defaulting to "Evaluated"`);
  return 'Evaluated';
}

// normalizeVia (Unicode-aware Via/agency key, #1596/#1603) lives in
// tracker-parse.mjs so merge-tracker and analyze-patterns share ONE normalizer
// and agency identity can't drift between scripts. (normalizeCompany lives in
// tracker-utils.mjs since #1460 so every tracker writer shares one company key.)

/**
 * Extract the bracketed report number from a Markdown report link.
 *
 * Report-number equality is an exact duplicate signal, but only after company
 * equality is confirmed by the caller. This helper reads links such as
 * `[123](../reports/123-company-role-date.md)` and returns the numeric id.
 *
 * Layouts whose header has no dedicated Report column (e.g. a customized
 * `… | Materials | Apply Link | Follow-up | Notes` shape) embed the link in
 * Notes prose instead (see buildRow), so the Notes cell is scanned as a
 * fallback — scoped to links that point into reports/ so a job-posting URL in
 * the same prose can't match.
 *
 * @param {string} reportStr - Raw report cell from applications.md or TSV input.
 * @param {string} [notesStr] - Notes cell, scanned when the report cell has none.
 * @returns {number|null} Parsed report number, or null when absent.
 */
function extractReportNum(reportStr, notesStr = '') {
  const m = String(reportStr ?? '').match(/\[(\d+)\]/);
  if (m) return parseInt(m[1]);
  const n = String(notesStr ?? '').match(/\[(\d+)\]\([^)]*reports\/[^)]+\)/);
  return n ? parseInt(n[1]) : null;
}

/**
 * Derive a posting URL from a row's linked report (`**URL:**` header).
 *
 * ONE derivation shared by the merge loop and --backfill-urls. The key has to be
 * written on the way IN, not only by a migration: the documented TSV is nine
 * columns with the URL optional, so a row added through the normal batch flow
 * carries no URL of its own and Pass 0 would have nothing to match until a human
 * remembered to run the backfill. A dedup key that only exists after a manual
 * step is a dedup key that is usually absent.
 *
 * @param {string} reportField - Report cell, e.g. `[42](reports/042-acme.md)`.
 * @returns {{url: string, reason: 'ok'|'no-report'|'no-url'}} The URL plus why
 *   it is empty, so the backfill can report the two cases separately.
 */
function resolveReportUrl(reportField) {
  const linkMatch = (reportField || '').match(/\]\(([^)]+)\)/);
  if (!linkMatch) return { url: '', reason: 'no-report' };
  // Containment, not cosmetics: resolve and assert the path stays under
  // REPORTS_ROOT. Stripping leading `../` alone still let an embedded
  // `reports/../../..` walk out of the tree, and the tracker is user-editable.
  const reportPath = resolve(REPORTS_ROOT, linkMatch[1].trim().replace(/^(\.\.\/)+/, ''));
  if (!reportPath.startsWith(REPORTS_ROOT + sep)) return { url: '', reason: 'no-report' };
  if (!existsSync(reportPath)) return { url: '', reason: 'no-report' };
  // [ \t]* NOT \s*: \s matches newlines, so an empty `**URL:**` header swallowed
  // the line break and captured the NEXT header's text. Every such report then
  // minted the same bogus key (`**Legitimacy:**`), and the backfill counted it
  // as a successful fill. `\S+` cannot cross a newline, so an empty header now
  // just fails to match at that position instead of reaching into the next line.
  //
  // Deliberately NOT anchored to line start. AGENTS.md requires `**URL:**` "in
  // the header (between Score and PDF)" — that is, INLINE:
  //   **Score:** 4.1/5 | **URL:** https://… | **Legitimacy:** High | **PDF:** …
  // which a `^`-anchored pattern cannot see. Every report written in the
  // documented format reported "no **URL:** header" and silently fell back to
  // fuzzy company+role dedup — the exact matching that let a new Google req
  // overwrite a different, concurrently-live one. Checked against all 399
  // reports: 376 match both ways and agree on the URL 376/376, so dropping the
  // anchor cannot change a URL that already resolved.
  const m = readFileSync(reportPath, 'utf-8').match(/\*\*URL:\*\*[ \t]*(\S+)/);
  if (!m) return { url: '', reason: 'no-url' };
  // Strip a markdown autolink wrapper and trailing punctuation, then require a
  // real http(s) URL. `**URL:** N/A` is legitimate for recruiter-sourced roles,
  // and normalizeUrl deliberately yields no key for it — writing the placeholder
  // into the column would hand every such row the same key.
  const raw = m[1].replace(/^<|>$/g, '').replace(/[),.;]+$/, '');
  return normalizeUrl(raw) ? { url: raw, reason: 'ok' } : { url: '', reason: 'no-url' };
}

// Matches the req/job-number labels actually seen in this tracker's free-text
// Notes column: `R_1488728`, `Req PRACT011038`, `Req #1311`, `REQ-2026-32061`,
// `Job 202606-116491`, `Job ID 65136`, `Posting ID 5340`, `JR00124259`,
// `Ref R2857957`. The label is required so we don't grab an unrelated number
// (a salary figure, a date fragment) — only text explicitly tagged as a
// req/job/posting/reference id counts.
const REQ_NUMBER_RE = /\b(?:job\s*id|posting\s*id|requisition|req|jr|job|posting|ref(?:erence)?|r_)[\s:#_-]*([a-z][a-z0-9-]*\d[a-z0-9-]*|\d[a-z0-9-]*)\b/i;

/**
 * Extract a req/job/posting number from a tracker Notes cell, if present.
 *
 * Tier-3 duplicate detection (company + fuzzy role match) has no awareness of
 * req numbers on its own, which lets two distinct postings at the same company
 * with similarly-worded titles collapse into one row (#1524 — e.g. two TD Bank
 * L&D postings distinguished only by `R_1494379` vs `R_1488728`). This helper
 * pulls out that number so the caller can treat a confirmed mismatch as proof
 * the rows are NOT duplicates, without touching cases where no number is
 * present on either side.
 *
 * @param {string} notes - Raw Notes cell from a tracker row or TSV addition.
 * @returns {string|null} Uppercased req/job number, or null when none is found.
 */
function extractReqNumber(notes) {
  if (!notes) return null;
  const m = String(notes).match(REQ_NUMBER_RE);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Company equality for duplicate detection.
 *
 * normalizeCompany() strips everything outside [a-z0-9], so a company name
 * written entirely in a non-Latin script (CJK, Cyrillic, Arabic, …) normalizes
 * to the empty string — and every such name would compare equal to every other
 * one. That collapses DIFFERENT companies into one row as soon as their roles
 * fuzzy-match (six Japanese companies posting データエンジニア → one row).
 * When the normalized key carries no signal, fall back to raw trimmed
 * equality so distinct non-Latin companies stay distinct; the unknown-employer
 * `?` marker still matches itself, so the #1596 cross-channel guard keeps its
 * existing behavior.
 *
 * @param {string} a - Company cell from one side of the comparison.
 * @param {string} b - Company cell from the other side.
 * @returns {boolean} True when the two cells name the same company.
 */
function companiesMatch(a, b) {
  const key = normalizeCompany(String(a));
  if (key !== normalizeCompany(String(b))) return false;
  return key !== '' || String(a).trim() === String(b).trim();
}

/**
 * Combine an existing row's Notes with a re-evaluation's Notes.
 *
 * The update path used to overwrite Notes with
 * `Re-eval {date} ({old}→{new}). {new notes}`, discarding the existing cell
 * outright (#2392 gap 2). The Notes column is not decoration: it carries the
 * `Applied YYYY-MM-DD` marker that followup-cadence.mjs prefers over the Date
 * column (dropping it silently resets the follow-up clock to the evaluation
 * date), the req/job number that this script's OWN sibling-req guard reads back
 * via extractReqNumber(), contact addresses, and whatever the user wrote with
 * `set-status --note`. None of it is recoverable: applications.md is gitignored
 * and no .bak is written.
 *
 * Format: the existing notes are kept verbatim and FIRST, with the re-eval
 * marker and any new notes appended after them. Order is deliberate, not
 * cosmetic — parseAppliedDate() and extractReqNumber() both return their FIRST
 * match, so leading with the established text keeps a row's apply date and req
 * number stable across re-evaluations instead of letting each new evaluation's
 * text take over. The cost is that Notes grows by one clause per re-evaluation.
 *
 * @param {string} existingNotes - Notes cell currently on the tracker row.
 * @param {object} addition - Parsed TSV addition (uses `notes` and `date`).
 * @param {number} oldScore - Score currently on the row.
 * @param {number} newScore - Score from the addition.
 * @param {string} [extraMarker] - Appended to the re-eval marker, before any
 *   incoming notes. Used by the downgrade path to record the superseded report
 *   (#2411). It rides on the marker rather than on `addition.notes` so that the
 *   repeat detection below keeps comparing the user's own text against the
 *   user's own text — a generated fragment in that comparison would make every
 *   downgrade look like a new note and defeat it.
 * @returns {string} Combined Notes cell.
 */
function mergeNotes(existingNotes, addition, oldScore, newScore, extraMarker = '') {
  // Trailing period trimmed only so the '. ' join does not produce '..'; no
  // other character of the existing text is touched. The tracker's "no data"
  // sentinels (the looksLikeScoreCell set minus the score-only DUP) count as
  // empty here: a placeholder cell collapses to the marker instead of gaining
  // a `—. ` separator the row never had (#2483).
  const prevRaw = String(existingNotes ?? '').trim();
  const prev = ['—', '-', 'N/A'].includes(prevRaw)
    ? ''
    : prevRaw.replace(/\s*\.\s*$/, '');
  const incoming = String(addition.notes ?? '').trim();
  const marker = extraMarker
    ? `Re-eval ${addition.date} (${oldScore}→${newScore}) — ${extraMarker}`
    : `Re-eval ${addition.date} (${oldScore}→${newScore})`;
  // Re-running the same evaluation would otherwise repeat its own text; the
  // marker still records that the re-evaluation happened. Repeats are detected
  // per CLAUSE — the same '. ' separator this function joins with — not by raw
  // substring: `prev.includes(incoming)` dropped any new note that happened to
  // appear INSIDE an existing clause ("Remote" vanished against "Remote OK").
  // A clause equals the incoming text either bare or in the marker-prefixed
  // form a previous run of this function appended (`{marker}: {incoming}`).
  const clause = (s) => s.replace(/\.+$/, '').trim();
  const incomingClause = clause(incoming);
  const isRepeat = incoming !== '' && prev.split(/\.\s+/).map(clause)
    .some(c => c === incomingClause || c.endsWith(`: ${incomingClause}`));
  const tail = incoming && !isRepeat ? `${marker}: ${incoming}` : marker;
  return prev ? `${prev}. ${tail}` : tail;
}

/**
 * Parse a score cell into a numeric value for score-upgrade decisions.
 *
 * The merge path compares old and new scores to decide whether to update an
 * existing duplicate row. Markdown bolding and `/5` suffixes are presentation
 * details, so only the first numeric value is used.
 *
 * @param {string} s - Raw score cell such as `4.2/5`.
 * @returns {number} Parsed score, or 0 when no numeric value is present.
 */
function parseScore(s) {
  const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * True when a Score cell is a documented "no score" sentinel rather than a
 * number. AGENTS.md names `N/A`, `—` and `-` as the values a row carries when it
 * was added without an evaluation, or when a re-eval could not be scored (#1799).
 *
 * parseScore() maps all of these to 0, so the merge path cannot tell them apart
 * from a genuine zero on its own — callers that must not treat "no score" as
 * "scored zero" ask here first (#2803).
 *
 * @param {string} s - Raw score cell.
 * @returns {boolean}
 */
function isUnscoreable(s) {
  return ['—', '-', 'N/A'].includes(String(s).replace(/\*\*/g, '').trim());
}

/**
 * Load the optional generated-PDF manifest.
 *
 * data/pdf-index.tsv is gitignored and only exists after generate-pdf.mjs has
 * written at least one PDF. Missing manifest = nothing to sync.
 *
 * @returns {Map<string,string>} Normalized report# → PDF path.
 */
function loadPdfIndex() {
  return existsSync(PDF_INDEX_FILE)
    ? parsePdfIndex(readFileSync(PDF_INDEX_FILE, 'utf-8'))
    : new Map();
}

/**
 * Flip stale PDF cells to ✅ when the generated-PDF manifest has the row's
 * report number.
 *
 * @param {Array<object>} existingApps - Parsed tracker rows.
 * @param {string[]} appLines - Mutable tracker file lines.
 * @param {Map<string,string>} pdfIndex - Normalized report# → PDF path.
 * @returns {number} Number of tracker rows updated.
 */
function syncPdfFlags(existingApps, appLines, pdfIndex) {
  let changed = 0;
  if (pdfIndex.size === 0) return changed;

  for (const app of existingApps) {
    const reportNum = extractReportNum(app.report, app.notes);
    if (!reportNum || !pdfIndex.has(String(reportNum)) || app.pdf !== '❌') continue;

    const lineIdx = appLines.indexOf(app.raw);
    if (lineIdx < 0) continue;

    console.log(`${DRY_RUN ? '🔄 PDF sync (dry-run)' : '🔄 PDF sync'}: #${app.num} ${app.company} — report ${reportNum} now has a generated PDF`);
    if (!DRY_RUN) {
      const updatedLine = buildRow({ ...app, pdf: '✅' });
      appLines[lineIdx] = updatedLine;
      app.pdf = '✅';
      app.raw = updatedLine;
    }
    changed++;
  }

  return changed;
}

// Column layout for the applications.md table. The tracker may use the original
// 9-column layout, or a customized one with an extra/reordered column (e.g. a
// Location column after Role). We map columns by header NAME rather than fixed
// position so both work — fixed-position indexing would otherwise read, say,
// Location where it expects Score. Falls back to the legacy layout when no
// recognizable header row is found.
// LEGACY_COLMAP, HEADER_ALIASES and detectColumns are the shared header-name
// mapping, now sourced from tracker-parse.mjs so every tracker reader stays in
// lockstep (see imports above). COLMAP stays mutable here — it is reassigned to
// the detected layout once the table is read (below).
let COLMAP = LEGACY_COLMAP;

// Total cell count of the tracker's ACTUAL header row, set once the table is
// read. Writes are driven by this width rather than by a hardcoded column list
// so a tracker carrying columns career-ops has no field for (Apply Link,
// Follow-up, or anything else a user adds) still round-trips: the row keeps the
// header's shape and the unknown cells are filled with the tracker's own "no
// data" marker instead of being dropped. Null until detected; falls back to the
// width implied by COLMAP.
let HEADER_WIDTH = null;

// Build a tracker row string matching the detected layout. Every field
// career-ops knows about is placed at ITS OWN detected index, and any column
// the header declares but career-ops has no value for becomes '—'.
//
// The previous implementation appended a fixed tail (score, status, pdf,
// report, notes, [url]) after the optional Via/Location columns. That silently
// produced a row NARROWER than the header on any tracker with extra columns —
// e.g. a 10-column `… | Materials | Apply Link | Follow-up | Notes` layout got
// 9-cell rows. Such rows are unparseable by set-status.mjs (its column map is
// header-derived), so those applications became unaddressable: the status could
// no longer be changed through the supported path.
function buildRow(o) {
  const width = HEADER_WIDTH ?? (Math.max(...Object.values(COLMAP)) + 2);
  // index 0 is the empty string left of the leading pipe; index `width - 1` is
  // the one right of the trailing pipe. Data cells live in between.
  const cells = new Array(Math.max(0, width - 2)).fill('—');
  // Rebuilding an EXISTING row (PDF sync, re-evaluation update, URL backfill):
  // start from the row's current cells so values in columns career-ops has no
  // field for — a hand-entered Apply Link, a Follow-up date — survive the
  // rebuild. parseAppLine only carries the mapped fields, so without this the
  // '—' fill above would overwrite those user-owned cells on every update.
  // Copied verbatim (empty cells included); the put() calls below then
  // overwrite only the fields career-ops owns. New rows pass no `raw` and keep
  // the plain '—' fill.
  if (o.raw) {
    const prev = String(o.raw).split('|').map(s => s.trim());
    for (let i = 0; i < cells.length; i++) {
      if (prev[i + 1] !== undefined) cells[i] = prev[i + 1];
    }
  }
  const put = (key, value) => {
    const idx = COLMAP[key];
    if (idx == null) return false;
    const at = idx - 1; // shift past the pre-pipe empty cell
    if (at < 0 || at >= cells.length) return false;
    cells[at] = value;
    return true;
  };

  put('num', o.num);
  put('date', o.date);
  put('company', cell(o.company));
  put('via', cell(o.via) || '—');
  put('role', cell(o.role));
  put('location', cell(o.location) || '—');
  put('score', o.score);
  put('status', o.status);
  put('pdf', o.pdf);
  // Optional trailing URL column — the stable natural key.
  put('url', cell(o.url) || '');

  // A layout with no dedicated Report column keeps the link in Notes, mirroring
  // how extractReportNum already READS it back. Without this the link would be
  // dropped outright on such trackers.
  let notes = cell(o.notes);
  if (!put('report', o.report) && o.report && String(o.report).trim() !== '—') {
    const link = String(o.report).trim();
    if (notes && !notes.includes(link)) notes = `${notes.replace(/\s*$/, '')} Report: ${link}.`;
    else if (!notes) notes = `Report: ${link}.`;
  }
  put('notes', notes);

  return `| ${cells.join(' | ')} |`;
}

// Header + separator for the DETECTED layout, mirroring buildRow's column
// order. The abort path below prints these as repair guidance, so hard-coding
// the nine-column form would hand a user with a Via or Location column a
// header that silently drops it — repair instructions that reintroduce the
// drift they exist to fix.
function buildHeaderRows() {
  const labels = ['#', 'Date', 'Company'];
  if (COLMAP.via != null) labels.push('Via');
  labels.push('Role');
  if (COLMAP.location != null) labels.push('Location');
  labels.push('Score', 'Status', 'PDF', 'Report', 'Notes');
  return {
    header: `| ${labels.join(' | ')} |`,
    separator: `|${labels.map((l) => '-'.repeat(Math.max(3, l.length + 2))).join('|')}|`,
  };
}

/**
 * Parse one Markdown applications.md table row into a tracker object.
 *
 * Header/separator rows and malformed rows return null. Valid rows preserve the
 * original raw line so the merge logic can locate and replace the exact tracker
 * line when a higher-scored re-evaluation arrives.
 *
 * @param {string} line - One line from applications.md.
 * @returns {object|null} Parsed tracker row, or null for non-data rows.
 */
function parseAppLine(line) {
  const parts = line.split('|').map(s => s.trim());
  const maxIdx = Math.max(...Object.values(COLMAP));
  if (parts.length <= maxIdx) return null;
  const num = parseInt(parts[COLMAP.num]);
  if (isNaN(num) || num === 0) return null;
  return {
    num,
    date: parts[COLMAP.date],
    company: parts[COLMAP.company],
    via: COLMAP.via != null ? parts[COLMAP.via] : '',
    role: parts[COLMAP.role],
    location: COLMAP.location != null ? parts[COLMAP.location] : '',
    score: parts[COLMAP.score],
    status: parts[COLMAP.status],
    // Null-safe: a header without dedicated PDF/Report columns leaves those
    // keys off COLMAP entirely (see extractReportNum's Notes fallback).
    pdf: COLMAP.pdf != null ? (parts[COLMAP.pdf] ?? '') : '',
    report: COLMAP.report != null ? (parts[COLMAP.report] ?? '') : '',
    notes: COLMAP.notes != null ? (parts[COLMAP.notes] || '') : '',
    // The posting URL, when the tracker carries the column.
    url: COLMAP.url != null ? (parts[COLMAP.url] || '') : '',
    raw: line,
  };
}

/**
 * Parse a TSV file content into a structured addition object.
 *
 * Handles 9-column TSV, 8-column TSV, and pipe-delimited Markdown rows. The
 * parser also tolerates old score/status column ordering, validates status, and
 * rejects additions without a usable tracker number so malformed batch output
 * cannot corrupt applications.md.
 *
 * @param {string} content - Raw file content from batch/tracker-additions.
 * @param {string} filename - Source filename used in warning messages.
 * @returns {object|null} Parsed tracker addition, or null when malformed.
 */
/**
 * Resolve the optional trailing TSV fields (index ≥ 9) into { via, location }.
 *
 * Via travels as a TAGGED field (`via=Hays`) rather than another positional
 * slot: TSV writers are LLM agents following prompt instructions, and a writer
 * that skips an empty padding field would silently shift a positional Via into
 * the Location slot (#1596). A single untagged extra remains the legacy
 * positional location (stale prompts stay valid forever). Anything ambiguous —
 * two untagged extras, duplicate via= tags — returns null so the row is
 * rejected loudly instead of merged with scrambled columns.
 *
 * @param {string[]} parts - All fields of the TSV/pipe row.
 * @param {string} filename - Source filename used in warning messages.
 * @returns {{via: string, location: string}|null}
 */
function parseTsvExtras(parts, filename) {
  // Drop placeholders outright. A generator emitting the documented trailing
  // `url` field for a posting that has none writes "N/A"/"TBD"/"—", and by shape
  // that is not a URL — it would fall into the untagged bucket and be recorded
  // as the row's LOCATION. An absent value must read as absent, not as some
  // other column's content.
  const PLACEHOLDER = /^(n\/?a|tbd|none|null|-|—|–)$/i;
  const extras = parts.slice(9)
    .map(s => String(s).trim())
    .filter(s => s !== '' && !PLACEHOLDER.test(s));
  const viaTags = extras.filter(s => /^via=/i.test(s));
  // Classify trailing fields by SHAPE, not position. A URL is
  // unambiguous (starts with http(s)://), so the posting URL and an older
  // location cell are order-independent and a row carrying both is not read as
  // two ambiguous locations. Location-only rows keep working untouched.
  const urls = extras.filter(s => !/^via=/i.test(s) && /^https?:\/\//i.test(s));
  const untagged = extras.filter(s => !/^via=/i.test(s) && !/^https?:\/\//i.test(s));
  if (viaTags.length > 1 || untagged.length > 1 || urls.length > 1) {
    console.warn(`⚠️  Skipping ${filename}: ambiguous extra fields [${extras.join(', ')}] — expected at most one "via=Firm" tag, one location and one URL`);
    return null;
  }
  return {
    via: viaTags.length ? viaTags[0].replace(/^via=/i, '').trim() : '',
    location: untagged[0] || '',
    url: urls[0] || '',
  };
}

function parseTsvContent(content, filename) {
  content = content.trim();
  if (!content) return null;

  let parts;
  let addition;

  // Detect pipe-delimited (markdown table row)
  if (content.startsWith('|')) {
    parts = content.split('|').map(s => s.trim());
    if (parts[0] === '') parts.shift();
    if (parts[parts.length - 1] === '') parts.pop();
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed pipe-delimited ${filename}: ${parts.length} fields`);
      return null;
    }
    // Format: num | date | company | role | score | status | pdf | report | notes [| location]
    // Identify score vs status by content, not position, so a swapped row can't
    // merge silently (#1427).
    const resolved = resolveScoreStatus(parts[4], parts[5]);
    if (!resolved) {
      console.warn(`⚠️  Skipping ${filename}: cannot tell score from status in columns 5–6 ("${parts[4]}" | "${parts[5]}") — refusing to merge a possible column swap`);
      return null;
    }
    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      // Write-canonical: the tracker stores scores unbolded (verify-pipeline
      // rejects bold scores), so strip any markdown bold from the incoming cell.
      score: resolved.score.replace(/\*\*/g, '').trim(),
      status: validateStatus(resolved.status),
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
    const extras = parseTsvExtras(parts, filename);
    if (!extras) return null;
    Object.assign(addition, extras);
  } else {
    // Tab-separated
    parts = content.split('\t');
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed TSV ${filename}: ${parts.length} fields`);
      return null;
    }

    // Column order varies: batch TSVs write (status, score), applications.md is
    // (score, status). Identify each by content — the score cell is recognizable
    // by pattern, a status never is — so a reordered TSV merges correctly and an
    // undecidable row is skipped loudly instead of merging swapped data (#1427).
    const resolved = resolveScoreStatus(parts[4].trim(), parts[5].trim());
    if (!resolved) {
      console.warn(`⚠️  Skipping ${filename}: cannot tell score from status in columns 5–6 ("${parts[4].trim()}" | "${parts[5].trim()}") — refusing to merge a possible column swap`);
      return null;
    }

    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      status: validateStatus(resolved.status),
      // Write-canonical: strip any markdown bold so the stored score stays
      // unbolded (verify-pipeline rejects bold scores).
      score: resolved.score.replace(/\*\*/g, '').trim(),
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
    const extras = parseTsvExtras(parts, filename);
    if (!extras) return null;
    Object.assign(addition, extras);
  }

  if (isNaN(addition.num) || addition.num === 0) {
    console.warn(`⚠️  Skipping ${filename}: invalid entry number`);
    return null;
  }

  return addition;
}

// ---- Main ----

// Read applications.md
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to merge into.');
  process.exit(0);
}
const appContent = readFileSync(APPS_FILE, 'utf-8');
// Test-only synchronization hook: the concurrent merge test waits for the
// first worker to read the tracker while still holding the lock, then starts a
// second worker to prove the lock prevents the old lost-update race.
if (MERGE_READY_IPC && typeof process.send === 'function') {
  process.send({ type: 'merge-tracker-ready' });
}
if (MERGE_HOLD_MS > 0) {
  await sleep(MERGE_HOLD_MS);
}

// One-time migration: rewrite existing report links so they resolve relative
// to the tracker file's directory (see #760). Run with: node merge-tracker.mjs --migrate
if (MIGRATE) {
  const migrated = appContent
    .split('\n')
    .map(line => (line.startsWith('|') ? normalizeReportLink(line) : line));
  const before = appContent.split('\n');
  const changed = migrated.filter((l, i) => l !== before[i]).length;

  if (DRY_RUN) {
    console.log(`🔎 Migration (dry-run): ${changed} row(s) would be rewritten in ${basename(APPS_FILE)}`);
  } else {
    writeFileAtomic(APPS_FILE, migrated.join('\n'));
    console.log(`✅ Migration: rewrote ${changed} report link(s) in ${basename(APPS_FILE)} relative to ${TRACKER_DIR === CAREER_OPS ? 'repo root' : 'data/'}`);
  }
  process.exit(0);
}

// Opt-in migration (#1596): insert a Via column (intermediary channel) after
// Company. Header-aware readers auto-detect both layouts, so this is optional —
// it exists for users who want the column added to an existing tracker.
// Idempotent: a tracker that already has a Via column is left untouched.
// Run with: node merge-tracker.mjs --migrate-via [--dry-run]
if (MIGRATE_VIA) {
  const lines = appContent.split('\n');
  const colmap = detectColumns(lines) || LEGACY_COLMAP;
  if (colmap.via != null) {
    console.log('✅ Via column already present — nothing to migrate.');
    process.exit(0);
  }
  const companyIdx = colmap.company;
  let changed = 0;
  const migrated = lines.map(line => {
    if (!line.startsWith('|')) return line;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length <= companyIdx) return line;
    const isHeader = parts[colmap.num] === '#';
    const isSeparator = /^[-: ]*$/.test(parts.join(''));
    const insert = isHeader ? 'Via' : isSeparator ? '-----' : '—';
    const cells = [...parts.slice(1, companyIdx + 1), insert, ...parts.slice(companyIdx + 1, parts.length - 1)];
    changed++;
    return isSeparator
      ? `|${cells.map(c => c || '---').join('|')}|`
      : `| ${cells.join(' | ')} |`;
  });
  if (DRY_RUN) {
    console.log(`🔎 Migration (dry-run): Via column would be inserted after Company (${changed} table line(s) rewritten)`);
  } else {
    writeFileAtomic(APPS_FILE, migrated.join('\n'));
    console.log(`✅ Migration: inserted Via column after Company (${changed} table line(s) rewritten). Direct applications are marked —.`);
  }
  process.exit(0);
}

// #3515: keep the tracker table ordered by `#` ascending on every write.
//
// Rows used to be spliced in immediately after the separator row and never
// reordered, so the table ended up ordered by *when a batch was merged*: each
// merge froze its own internal order in place and landed on top of the previous
// one. Finding row #42 meant reading the whole table — the one thing an ordered
// `#` column should make unnecessary.
//
// Sorting happens at write time over the whole data block, so an existing
// tracker is repaired in place on the next merge with no separate migration.
// Ascending matches how rows are referred to ("row 42") and how reports/ is
// numbered on disk.
//
// Rows whose `#` cell is non-numeric — the backfilled `N/A` / `—` / `-`
// sentinels described in AGENTS.md, or a row too malformed to parse — keep a
// defined position at the END of the table, in their existing relative order.
// They are never dropped and never throw the comparator.
//
// Only the contiguous run of table rows directly after the separator is
// touched; any prose or second table further down the file is left alone.
// Returns the number of rows whose position changed.
function sortTrackerRowsInPlace(lines) {
  let sepIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SEPARATOR_ROW_RE.test(lines[i])) { sepIdx = i; break; }
  }
  if (sepIdx < 0) return 0;
  let end = sepIdx + 1;
  while (end < lines.length && lines[end].startsWith('|')) end++;
  const block = lines.slice(sepIdx + 1, end);
  if (block.length < 2) return 0;
  // Bare parseInt, deliberately — the same reading of the `#` cell that
  // parseAppLine and the usedNumbers pass use. It accepts a numeric prefix, so
  // a malformed `12draft` cell reads as 12 here exactly as it does there: that
  // row is #12 to dedup, to number allocation and to maxNum, so sorting it into
  // position 12 is what keeps the table consistent with the rest of the script.
  // A stricter full-cell test would park a row at the bottom that every other
  // code path still calls #12 — a row you cannot find by its number, which is
  // the problem this sort exists to solve. The sentinels that matter (`N/A`,
  // `—`, `-`) are NaN under both readings and land at the end either way.
  const numOf = (line) => {
    const parts = line.split('|').map(s => s.trim());
    const n = parseInt(parts[COLMAP.num], 10);
    return Number.isNaN(n) ? null : n;
  };
  const decorated = block.map((line, i) => ({ line, i, num: numOf(line) }));
  decorated.sort((a, b) => {
    // Sentinel-numbered rows sink to the bottom; ties (and sentinel-vs-sentinel)
    // fall back to the original index so the sort is fully deterministic.
    if (a.num === null || b.num === null) {
      if (a.num === b.num) return a.i - b.i;
      return a.num === null ? 1 : -1;
    }
    return a.num === b.num ? a.i - b.i : a.num - b.num;
  });
  const sorted = decorated.map(d => d.line);
  let moved = 0;
  for (let i = 0; i < sorted.length; i++) if (sorted[i] !== block[i]) moved++;
  lines.splice(sepIdx + 1, block.length, ...sorted);
  return moved;
}

const appLines = appContent.split('\n');
// Detect the tracker's column layout via header names so parsing and writing
// both work whether the table uses the original 9-column layout or a customized
// one (e.g. with a Location column after Role). Falls back to the legacy layout.
COLMAP = detectColumns(appLines) || LEGACY_COLMAP;
// Capture the header's real width so buildRow emits rows of exactly that shape
// (see HEADER_WIDTH). Detected from the same line detectColumns matched, so the
// two can never disagree.
HEADER_WIDTH = (() => {
  for (const line of appLines) {
    if (line.startsWith('|') && isHeaderRow(line)) return line.split('|').length;
  }
  return null;
})();
if (COLMAP.location != null) console.log('🧭 Detected Location column.');
if (COLMAP.via != null) console.log('🧭 Detected Via column.');
if (COLMAP.url != null) console.log('🧭 Detected URL column (deterministic dedup active).');
if (HEADER_WIDTH != null && HEADER_WIDTH - 2 > Object.keys(COLMAP).length) {
  console.log(
    `🧭 Header has ${HEADER_WIDTH - 2} columns; ${HEADER_WIDTH - 2 - Object.keys(COLMAP).length} ` +
    'not mapped to a career-ops field — those cells are written as "—".',
  );
}
const existingApps = [];
let maxNum = 0;

for (const line of appLines) {
  // Skip only on the NaN check inside parseAppLine, which already rejects the
  // header and separator rows because neither has a numeric `#` cell. The old
  // `.includes('---') / .includes('Empresa')` heuristic was redundant for those
  // two rows and wrong for data rows: any row whose free text contained three
  // hyphens (a URL slug such as `Senior-Engineer---Platform-Team`, an em
  // dash typed as `---`) or the word "Empresa" (a Spanish-market company name)
  // never reached existingApps, so duplicate detection could not see it and a
  // re-evaluation of that role appended a second row instead of updating it in
  // place. #1704 fixed the numbering half of this with the usedNumbers pass
  // below; this is the dedup half (#2265).
  if (!line.startsWith('|')) continue;
  const app = parseAppLine(line);
  if (app) {
    existingApps.push(app);
    if (app.num > maxNum) maxNum = app.num;
  }
}

// One-time backfill populating the URL column on existing
// rows from each row's linked report (`**URL:**` header). This is the EXPAND
// phase — the key must exist before the merge relies on it. Idempotent: only
// fills rows whose URL cell is empty, so re-running is safe.
// Run with: node merge-tracker.mjs --backfill-urls [--dry-run]
if (BACKFILL_URLS) {
  if (COLMAP.url == null) {
    console.error('❌ --backfill-urls: this tracker has no URL column. Add a `URL` header column first (additive), then re-run.');
    trackerLock.release();
    process.exit(1);
  }
  let filled = 0, noReport = 0, noUrl = 0, already = 0;
  const backfilled = appLines.map(line => {
    // parseAppLine's NaN check below already rejects the header and separator
    // rows (neither has a numeric `#` cell), so no `---` substring test here —
    // that heuristic skipped data rows whose URL contains `---` (Workday slugs
    // like `Product-Strategy---Operations`), which is the #2265 bug class.
    if (!line.startsWith('|')) return line;
    const app = parseAppLine(line);
    if (!app) return line;
    // Rebuilt, not returned verbatim — a row can carry a URL and STILL be short
    // of the header on a layout with user-owned columns after `URL`. Returning
    // `line` there leaves the same unreadable row this fix exists to prevent.
    if ((app.url || '').trim()) { already++; return buildRow({ ...app }); }
    // Shared derivation with the merge loop — one place that knows how to turn a
    // report link into the posting URL. Tracker links may be root-relative
    // (`reports/...`) or data-relative (`../reports/...`); both resolve.
    const resolved = resolveReportUrl(app.report);
    // A row we cannot fill is still rebuilt, with an empty URL cell.
    //
    // Returning the original line leaves a pre-URL-column row one cell short of
    // the header, and #3016 established that a short row is exactly what
    // parseTrackerRow must reject: "a row must span the full header width,
    // otherwise a missing interior cell would silently shift every later column
    // one position left". That guard is correct; this writer was producing rows
    // it correctly refuses. Every reader built on tracker-parse.mjs then skips
    // the row for good — set-status.mjs reports "No tracker row with #N".
    //
    // parseAppLine's guard is `parts.length <= maxIdx`, one cell looser than
    // parseTrackerRow's `parts.length < width`, which is why the backfill can
    // still see and repair precisely the rows the readers cannot.
    //
    // The DELIMITER is added, never a value: buildRow writes `put('url', '')`,
    // and an empty URL falls back to the report-number and fuzzy company+role
    // dedup tiers exactly as it does today. Nothing is fabricated.
    if (resolved.reason === 'no-report') { noReport++; return buildRow({ ...app, url: '' }); }
    if (resolved.reason === 'no-url') { noUrl++; return buildRow({ ...app, url: '' }); }
    filled++;
    return buildRow({ ...app, url: resolved.url });
  });
  const summary = `${filled} filled, ${already} already set, ${noReport} no/missing report, ${noUrl} report has no **URL:**`;
  if (DRY_RUN) {
    console.log(`🔎 Backfill URLs (dry-run): would fill ${filled} row(s). (${summary})`);
  } else {
    writeFileAtomic(APPS_FILE, backfilled.join('\n'));
    console.log(`✅ Backfill URLs: ${summary}.`);
  }
  trackerLock.release();
  process.exit(0);
}
// Full set of numbers already on the tracker (#1704). Deliberately broader than
// the existingApps loop above: it reserves the number from any row with a
// numeric # cell, including a row too malformed for parseAppLine to return.
// Such a row can't participate in duplicate detection, but its number is still
// taken and must never be handed out again. Used below so a new entry's number
// is checked against every number actually on the tracker, not just the largest
// one the existingApps loop saw.
const usedNumbers = new Set();
const MAX_COL_IDX = Math.max(...Object.values(COLMAP));
for (const line of appLines) {
  if (!line.startsWith('|')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (parts.length <= MAX_COL_IDX) continue;
  const n = parseInt(parts[COLMAP.num]);
  if (!isNaN(n) && n !== 0) {
    usedNumbers.add(n);
    if (n > maxNum) maxNum = n;
  }
}

console.log(`📊 Existing: ${existingApps.length} entries, max #${maxNum}`);
let added = 0;
let updated = 0;
let skipped = 0;
const pdfIndex = loadPdfIndex();
const pdfSynced = syncPdfFlags(existingApps, appLines, pdfIndex);
updated += pdfSynced;

// Read tracker additions
if (!existsSync(ADDITIONS_DIR)) {
  console.log('No tracker-additions directory found.');
  // Nothing to merge, but an existing tracker left unsorted by earlier versions
  // is still repaired here (#3515) — that is the whole point of sorting at write
  // time rather than at insert time.
  const moved = DRY_RUN ? 0 : sortTrackerRowsInPlace(appLines);
  if (moved > 0) console.log(`🔢 Sorted tracker by # ascending (${moved} row(s) repositioned).`);
  if ((pdfSynced > 0 || moved > 0) && !DRY_RUN) writeFileAtomic(APPS_FILE, appLines.join('\n'));
  if (DRY_RUN) console.log('(dry-run — no changes written)');
  trackerLock.release();
  process.exit(0);
}

const tsvFiles = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
if (tsvFiles.length === 0) {
  console.log('✅ No pending additions to merge.');
  // Nothing to merge, but an existing tracker left unsorted by earlier versions
  // is still repaired here (#3515) — that is the whole point of sorting at write
  // time rather than at insert time.
  const moved = DRY_RUN ? 0 : sortTrackerRowsInPlace(appLines);
  if (moved > 0) console.log(`🔢 Sorted tracker by # ascending (${moved} row(s) repositioned).`);
  if ((pdfSynced > 0 || moved > 0) && !DRY_RUN) writeFileAtomic(APPS_FILE, appLines.join('\n'));
  if (DRY_RUN) console.log('(dry-run — no changes written)');
  trackerLock.release();
  process.exit(0);
}

// Sort files numerically for deterministic processing
tsvFiles.sort((a, b) => {
  const numA = parseInt(/^(\d+)/.exec(a)?.[1] ?? '', 10) || 0;
  const numB = parseInt(/^(\d+)/.exec(b)?.[1] ?? '', 10) || 0;
  return numA - numB;
});

console.log(`📥 Found ${tsvFiles.length} pending additions`);

// Warn once per run, not per row.
let warnedNoUrlCol = false;
const newLines = [];
// TSVs whose evaluation could not be applied to the tracker. They are kept out
// of merged/ so a re-run picks them up, and they make the process exit non-zero
// instead of reporting a success that did not happen.
const failedAdditions = [];

/**
 * Replace one tracker row line wherever it currently lives.
 *
 * A row added earlier in THIS run is still queued in `newLines` and has not
 * been spliced into `appLines` yet, so an update targeting it would not be
 * found by an appLines-only lookup (#2392 gap 3). Searching both keeps the
 * intra-run dedup below able to update a row it just created.
 *
 * @param {string} oldLine - The row line as it currently stands.
 * @param {string} updatedLine - Replacement row line.
 * @returns {boolean} True when the line was found and replaced.
 */
function replaceTrackerLine(oldLine, updatedLine) {
  const idx = appLines.indexOf(oldLine);
  if (idx >= 0) {
    appLines[idx] = updatedLine;
    return true;
  }
  const pendingIdx = newLines.indexOf(oldLine);
  if (pendingIdx >= 0) {
    newLines[pendingIdx] = updatedLine;
    return true;
  }
  return false;
}

for (const file of tsvFiles) {
  const content = readFileSync(join(ADDITIONS_DIR, file), 'utf-8').trim();
  const addition = parseTsvContent(content, file);
  if (!addition) { skipped++; continue; }

  // A via= tag can only be stored if the tracker has a Via column — warn
  // instead of dropping the channel silently (#1596). Clear the value too:
  // existing rows parse with via='' on this layout, so a set addition.via would
  // make the cross-channel duplicate guard see a channel mismatch and add a
  // second ? row instead of updating the same-agency re-blast.
  if (addition.via && COLMAP.via == null) {
    console.warn(`⚠️  ${file}: carries via=${addition.via} but the tracker has no Via column — value dropped. Add it with: node merge-tracker.mjs --migrate-via`);
    addition.via = '';
  }

  // If additions carry a URL but the tracker has no URL
  // column, deterministic Pass 0 cannot engage and dedup silently falls back to
  // the fuzzy tiers. Warn once rather than degrade invisibly.
  if (addition.url && COLMAP.url == null && !warnedNoUrlCol) {
    console.warn('⚠️  Additions carry a URL but this tracker has no URL column — URL dedup is INACTIVE (fuzzy fallback). Add a `URL` header column to enable it.');
    warnedNoUrlCol = true;
  }

  // Normalize the report link to be relative to the tracker file's directory.
  // The TSV convention carries a root-relative `reports/...` link; rewrite it
  // so it resolves correctly when clicked from applications.md (see #760).
  addition.report = normalizeReportLink(addition.report);

  // Derive the key from the linked report when the TSV did not carry one, so a
  // row added through the normal nine-column flow is born WITH its key. This
  // must run before the dedup below reads addition.url — deriving it afterwards
  // would populate the column while leaving Pass 0 nothing to match on, which is
  // the original bug with extra steps.
  if (!addition.url) addition.url = resolveReportUrl(addition.report).url;

  // Check for duplicate by:
  // 0. Exact normalized posting URL (deterministic, authoritative)
  // 1. Exact report number match
  // 2. Company + role fuzzy match
  const reportNum = extractReportNum(addition.report, addition.notes);

  if (reportNum && FAILED_REPORT_NUMBERS.has(reportNum)) {
    console.warn(`⚠️  Skipping ${file}: report #${reportNum} is marked "failed" in batch-state.tsv — refusing to merge a tracker line for an offer the batch runner itself recorded as failed (possible fabricated result)`);
    skipped++;
    continue;
  }

  let duplicate = null;
  // True only for a tier-1 match (report number + company): the one heuristic
  // tier where the addition is provably the same evaluation as the existing
  // row, so its role title may replace the row's. Tier-2 (entry num) and
  // tier-3 (fuzzy role) matches keep the existing title — a fuzzy false
  // positive that also rewrites the title destroys the evidence that two reqs
  // were distinct. Pass 0 (URL) grants the same trust for the same reason; it
  // tracks that separately in `dupReason`.
  let reportNumMatched = false;

  // Pass 0 — the posting URL is the stable natural key. When it hits it is
  // authoritative and no heuristic runs. Tiers 1-3 below remain the fallback
  // for rows with no URL yet.
  const addUrl = normalizeUrl(addition.url);
  let dupReason = null;
  if (addUrl) {
    duplicate = existingApps.find(a => a.url && normalizeUrl(a.url) === addUrl);
    if (duplicate) dupReason = 'url';
  }

  // Guard the report/num/fuzzy fallback against collapsing distinct postings.
  //
  // ONLY TWO PRESENT-AND-DIFFERENT KEYS ARE EVIDENCE. A key that is absent on
  // either side says nothing at all, so it must let the tier proceed and decide
  // on its own signals. This is SQL's three-valued logic: a comparison against
  // an unknown is UNKNOWN, not "different" — the same reason `x = NULL` is never
  // true. The earlier version returned true when the ADDITION had no key, which
  // silently turned "I don't know" into "definitely a different posting" and
  // made every URL-bearing row unmatchable by the documented 9-column TSV: a
  // routine re-evaluation appended a duplicate row instead of updating, both
  // rows pointing at the same report. Record-linkage practice names this
  // directly — treating missing as disagreement is a known bias, not a safe
  // default.
  // Two present-and-different keys are PROOF the rows are distinct postings.
  const urlDiffers = (cand) => {
    const candUrl = normalizeUrl(cand.url);
    if (!candUrl || !addUrl) return false;   // unknown → not evidence
    return candUrl !== addUrl;
  };

  // The heuristic tiers additionally refuse to let an UNKEYED addition claim a
  // row whose posting we do know. That asymmetry is the point of the whole
  // change: tier 1 matches on the report number, which is provable identity, so
  // an absent key there must not block — it is UNKNOWN, not "different", and
  // treating it as different is what made a routine nine-column re-evaluation
  // append a duplicate row. Tiers 2 and 3 match on an entry number or a fuzzy
  // title, which are guesses; there, "this row is a specific known posting and
  // you have not told me which posting you are" is a good reason to stay out.
  const urlBlocksHeuristic = (cand) => {
    if (urlDiffers(cand)) return true;
    return Boolean(normalizeUrl(cand.url)) && !addUrl;
  };

  if (!duplicate && reportNum) {
    // Report-number match must also confirm company (#912). Report-file
    // sequence and tracker-row sequence are independent, so the same number
    // appearing for two different companies is sequence drift, not a duplicate.
    // Without the company guard, a NewCo TSV with report [1] silently overwrites
    // the existing tracker row [1] belonging to an unrelated company.
    duplicate = existingApps.find(app => {
      // Provable tier: only a CONFLICT disqualifies, never a missing key.
      if (urlDiffers(app)) return false;
      const existingReportNum = extractReportNum(app.report, app.notes);
      return existingReportNum === reportNum && companiesMatch(app.company, addition.company);
    });
    if (duplicate) reportNumMatched = true;
  }

  if (!duplicate) {
    // Exact entry number match — but only when the company also matches.
    // The TSV `num` doubles as the tracker row id, yet report-file numbering
    // and tracker-row numbering can drift out of sync (e.g. reports maxed at
    // 067 while the tracker was already at #69). A bare num collision across
    // *different* companies is that drift, not a duplicate — matching on num
    // alone silently merges a brand-new role into an unrelated existing row.
    duplicate = existingApps.find(app =>
      !urlBlocksHeuristic(app) && app.num === addition.num && companiesMatch(app.company, addition.company)
      // Same-run num collisions are reservation races, not row-id references:
      // two TSVs that both claimed num=5 for DIFFERENT roles at one company
      // are two distinct evaluations, and folding them keeps the first title
      // with the second score (main renumbers and keeps both via the
      // #1704/#1733 path). For a row queued THIS run, only accept the num
      // match when the roles also fuzzy-match — consistent with tier-3's
      // cross-run semantics. For rows already on disk, num remains the
      // tracker row id and behavior is unchanged.
      && (!app.addedThisRun || roleFuzzyMatch(addition.role, app.role))
    );
  }

  if (!duplicate) {
    // Company + role fuzzy match
    const additionReqNum = extractReqNumber(addition.notes);
    duplicate = existingApps.find(app => {
      // Two different posting URLs are two different postings — a fuzzy title
      // collision must never collapse them. This is the structural version of
      // the #1524 req-number guard, and the tier where an unkeyed addition is
      // also held back from claiming a row whose posting is known.
      if (urlBlocksHeuristic(app)) return false;
      if (!companiesMatch(app.company, addition.company)) return false;
      if (!roleFuzzyMatch(addition.role, app.role)) return false;
      // Cross-channel guard (#1596): unknown-employer rows (`?`) all normalize
      // to the same empty company key, but the same role via two DIFFERENT
      // agencies is two real submissions — merging them silently is exactly
      // the double-submission hazard the Via column exists to surface. Only
      // the same channel (the agency re-blasting one listing) is a duplicate.
      // Via comparison is Unicode-aware (#1603): normalizeCompany() would
      // collapse distinct non-Latin agency names to the same empty key.
      if ((String(addition.company).trim() === '?' || String(app.company).trim() === '?')
          && normalizeVia(addition.via || '') !== normalizeVia(app.via || '')) return false;
      // Req/job-number guard (#1524): a similarly-worded title at the same
      // company can still be a genuinely distinct posting when a req/job
      // number in the Notes column proves it (employers like TD commonly run
      // concurrent near-identical L&D/HR titles distinguished only by req#).
      // Only treat this as evidence the rows differ when BOTH sides carry an
      // extractable number and they disagree — if either side has none, fall
      // back to today's fuzzy-match-only behavior unchanged.
      const appReqNum = extractReqNumber(app.notes);
      if (additionReqNum && appReqNum && additionReqNum !== appReqNum) return false;
      return true;
    });
  }

  if (duplicate) {
    // An unscoreable re-eval (N/A/—/-) carries no score to write through. Its
    // score parses to 0, so the downgrade path below would read it as a genuine
    // zero and overwrite a real score with the sentinel — unrecoverably, since
    // the tracker is gitignored and no .bak is written (#2803). A failed fetch is
    // "no new score", not "scored zero": leave the row's score, report and PDF as
    // they stand. When the row itself is not yet scored there is nothing to lose,
    // so let the normal path refresh its date/notes/report from the re-eval.
    if (isUnscoreable(addition.score) && !isUnscoreable(duplicate.score)) {
      console.log(
        `⏭️  Skipping ${file}: re-eval of #${duplicate.num} ${addition.company} — `
        + `${addition.role} produced no score (${String(addition.score).trim()}); `
        + `keeping ${duplicate.score}`,
      );
      skipped++;
      continue;
    }
    const newScore = parseScore(addition.score);
    const oldScore = parseScore(duplicate.score);

    // A re-evaluation writes through in BOTH directions. A lower score is not
    // noise to discard — it is newer information, and often the most valuable
    // kind: a targeting/policy change, a freshly-discovered staleness signal (a
    // requisition turning out to be a year old), or a gap re-weighted from
    // "ramp-up item" to "decisive gate". The former `newScore > oldScore` gate
    // sent all of those to a bare `else`, so the tracker kept asserting a stale
    // optimistic score, the new report was orphaned, and the TSV was archived to
    // merged/ as if it had landed (#2411). Equal scores write through too, since
    // the notes and report link are still fresher than what the row holds.
    //
    // Because the fuzzy matcher can mis-pair genuinely different roles (see
    // role-matcher.mjs — "Senior" is a stopword and short tokens are dropped), a
    // downgrade records the superseded report number so a bad match stays
    // recoverable from the tracker alone. mergeNotes() keeps the existing cell
    // verbatim and first, so a second downgrade preserves the earlier marker
    // rather than overwriting it.
    const downgrade = newScore < oldScore;
    const oldReportNum = extractReportNum(duplicate.report, duplicate.notes);
    const supersededNote = downgrade && oldReportNum && oldReportNum !== reportNum
      ? `Superseded report [${oldReportNum}] (was ${oldScore}/5)`
      : '';

    console.log(
      `${downgrade ? '🔽' : '🔄'} Update: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`
      + (downgrade ? ' — DOWNGRADE, re-eval scored lower' : ''),
    );
    // The PDF flag describes THE ROW'S REPORT, and this branch replaces that
    // report link. Inheriting duplicate.pdf across a report change carried the
    // superseded report's ✅ onto the new one: the row then claimed a tailored
    // PDF exists for a report that has none, and the only PDF on disk belonged
    // to the evaluation that was just superseded. Fall back to the existing
    // flag only when the report is unchanged; when it changes, the manifest is
    // the sole authority (#2594).
    // "different, INCLUDING one-side-absent". Requiring both to be truthy meant
    // a row whose report cell is `—` had oldReportNum === null, so reportChanged
    // was falsy and the stale ✅ was inherited exactly as before this fix — and a
    // `—` row with a ✅ is ordinary, it is what a tracker entry added before its
    // evaluation looks like. Both absent stays "unchanged", which is correct.
    const reportChanged = String(reportNum ?? '') !== String(oldReportNum ?? '');
    const pdf = reportNum && pdfIndex.has(String(reportNum))
      ? '✅'
      : (reportChanged ? '❌' : duplicate.pdf);
    const updatedLine = buildRow({
      num: duplicate.num, date: addition.date, company: addition.company,
      // A URL match is a CONFIRMED same-posting identity, so the incoming title
      // is authoritative the same way a report-number match is — employers do
      // edit a live posting's title. The fuzzy tiers stay conservative and keep
      // the existing role, since there the pairing is only a guess.
      role: (reportNumMatched || dupReason === 'url') ? addition.role : duplicate.role,
      via: addition.via || duplicate.via || '—',
      location: addition.location || duplicate.location || '—',
      score: addition.score, status: duplicate.status, pdf,
      report: addition.report,
      notes: mergeNotes(duplicate.notes, addition, oldScore, newScore, supersededNote),
      // Preserve the row's unmapped custom-column cells across the rebuild.
      raw: duplicate.raw,
      // Carry the key forward. Without this the update path rewrites the row
      // with an empty URL cell and the posting loses the very key that matched
      // it, silently demoting every later merge back to the fuzzy tiers.
      url: addition.url || duplicate.url || '',
    });
    if (replaceTrackerLine(duplicate.raw, updatedLine)) {
      // Refresh the cached row from the line just written (#2392). `raw` was
      // captured when applications.md was parsed and used to be left stale
      // after the write, so a SECOND addition matching this same row found
      // nothing at indexOf(), fell through a branch with no else, and was
      // archived as merged — the evaluation was gone with no warning and no
      // recoverable copy (the tracker is gitignored and no .bak is written).
      // The stale `score` was just as damaging: the second comparison read
      // the pre-update score, so which of several re-evaluations survived
      // depended on TSV filename sort order. Re-parsing the written line is
      // the faithful refresh — the cached row then holds exactly what a fresh
      // read of the tracker would produce. syncPdfFlags() has always kept its
      // cache in step this way; the update path did not.
      const refreshed = parseAppLine(updatedLine);
      if (refreshed) Object.assign(duplicate, refreshed);
      else duplicate.raw = updatedLine;
      updated++;
    } else {
      // Unreachable once `raw` is refreshed above, but never silent again: a
      // row we cannot locate means the addition was NOT applied, so say so,
      // keep the TSV out of merged/, and fail the run.
      console.error(
        `❌ ${file}: could not locate tracker row #${duplicate.num} ` +
        `(${duplicate.company} — ${duplicate.role}) to update; this evaluation was NOT merged.`,
      );
      failedAdditions.push(file);
    }
  } else {
    // New entry - preserve the TSV's reserved ID whenever it is actually
    // free. Parallel workers can finish out of order, so a valid reservation
    // may be lower than the current tracker maximum (#1733). Renumber only on
    // a real collision, using the next free ID above the current maximum and
    // warning loudly so report/tracker drift is visible (#1704).
    let entryNum;
    if (!usedNumbers.has(addition.num)) {
      entryNum = addition.num;
    } else {
      entryNum = maxNum + 1;
      while (usedNumbers.has(entryNum)) entryNum++;
      console.warn(
        `⚠️  Tracker #${addition.num} already used; assigning #${entryNum} to ` +
        `${addition.company} — ${addition.role}. Report link remains ${addition.report}.`,
      );
    }
    usedNumbers.add(entryNum);
    if (entryNum > maxNum) maxNum = entryNum;

    const pdf = reportNum && pdfIndex.has(String(reportNum)) ? '✅' : addition.pdf;
    const newLine = buildRow({
      num: entryNum, date: addition.date, company: addition.company, role: addition.role,
      via: addition.via || '—',
      location: addition.location || '—',
      score: addition.score, status: addition.status, pdf,
      report: addition.report, notes: addition.notes,
      // Write the key on the way in. Backfill is the one-time EXPAND phase for
      // rows that predate the column; a row added today must carry its own URL
      // or Pass 0 can never match it and dedup stays fuzzy-only for new work.
      url: addition.url || '',
    });
    newLines.push(newLine);
    // Register the row with the dedup index right away (#2392 gap 3). All
    // three dedup tiers search `existingApps`, which only ever held rows read
    // from the file, so two TSVs for the same company+role in ONE run both
    // appended and the tracker gained duplicate rows — the exact outcome
    // CLAUDE.md's "NEVER create new entries if company+role already exists"
    // rule forbids. The parsed row's `raw` is the queued line, and
    // replaceTrackerLine() knows how to find it in `newLines`, so a later
    // higher-scored addition updates it in place just like a row already on
    // disk.
    const parsedNew = parseAppLine(newLine);
    if (parsedNew) {
      // Mark the row as queued this run: tier-2 treats a num collision with a
      // same-run row as a reservation race unless the roles also fuzzy-match
      // (see the tier-2 guard above). Object.assign() in the update path never
      // deletes the flag, so it survives in-place refreshes within the run.
      parsedNew.addedThisRun = true;
      existingApps.push(parsedNew);
    }
    added++;
    console.log(`➕ Add #${entryNum}: ${addition.company} — ${addition.role} (${addition.score})`);
  }
}

// Insert new lines after the header (line index of first data row)
if (newLines.length > 0) {
  // Find header separator (|---|...) and insert after it. Match the row's
  // structure rather than a bare `---` substring, so a data row carrying three
  // hyphens in its free text can never be mistaken for the separator.
  let insertIdx = -1;
  for (let i = 0; i < appLines.length; i++) {
    if (SEPARATOR_ROW_RE.test(appLines[i])) {
      insertIdx = i + 1;
      break;
    }
  }
  if (insertIdx < 0) {
    // #2394: no separator row means no insert point. The old code left
    // insertIdx at -1, skipped the splice with no else, then carried on to
    // write the file, archive every TSV into merged/ and print "+N added" —
    // so a tracker whose table header had been damaged (or a fresh file that
    // only ever got its `# Applications Tracker` line) swallowed a whole batch
    // of evaluations while reporting success. Nothing survived: the tracker is
    // gitignored and merge-tracker keeps no .bak.
    //
    // Abort before writing anything. Leaving the tracker and the additions dir
    // exactly as they were makes the run a no-op that replays cleanly once the
    // table is repaired.
    console.error(`❌ Aborting merge: ${basename(APPS_FILE)} has no table separator row ("|---|------|...").`);
    console.error(`   There is no insert point for ${newLines.length} new row(s), so NOTHING was written and no TSV was archived.`);
    console.error('   Repair the tracker table header, then re-run — the pending additions in');
    console.error(`   ${ADDITIONS_DIR} will merge then. Expected header:`);
    const { header, separator } = buildHeaderRows();
    console.error(`     ${header}`);
    console.error(`     ${separator}`);
    for (const line of newLines) console.error(`   not merged: ${line}`);
    trackerLock.release();
    process.exit(1);
  }
  appLines.splice(insertIdx, 0, ...newLines);
}

// Write back
if (!DRY_RUN) {
  const moved = sortTrackerRowsInPlace(appLines);
  if (moved > 0) console.log(`\n🔢 Sorted tracker by # ascending (${moved} row(s) repositioned).`);
  writeFileAtomic(APPS_FILE, appLines.join('\n'));

  // Move processed files to merged/ — but only the ones actually applied.
  // Archiving a TSV whose row never reached the tracker is what turns a bug
  // into permanent data loss, since applications.md is gitignored and no backup
  // is written.
  if (!existsSync(MERGED_DIR)) mkdirSync(MERGED_DIR, { recursive: true });
  const archivable = tsvFiles.filter(f => !failedAdditions.includes(f));
  for (const file of archivable) {
    renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
  }
  console.log(`\n✅ Moved ${archivable.length} TSVs to merged/`);
}

console.log(`\n📊 Summary: +${added} added, 🔄${updated} updated, ⏭️${skipped} skipped${failedAdditions.length ? `, ❌${failedAdditions.length} NOT merged` : ''}`);
if (DRY_RUN) console.log('(dry-run — no changes written)');
trackerLock.release();

// Sync PDF flags (idempotent; uses its own lock/transaction)
if (!DRY_RUN) {
  try {
    execFileSync('node', [join(CAREER_OPS, 'sync-pdf-flags.mjs')], { stdio: 'inherit' });
  } catch (e) {
    console.warn(`⚠️  Failed to sync PDF flags: ${e.message}`);
  }
}

// Optional verify
if (VERIFY && !DRY_RUN) {
  console.log('\n--- Running verification ---');
  try {
    execFileSync('node', [join(CAREER_OPS, 'verify-pipeline.mjs')], { stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}

// Any addition that could not be applied fails the run. The TSVs stay in the
// additions dir, so re-running after the tracker is repaired merges them once.
if (failedAdditions.length > 0) {
  console.error(
    `\n❌ ${failedAdditions.length} addition(s) were NOT merged and were left in ${ADDITIONS_DIR}: ` +
    failedAdditions.join(', '),
  );
  process.exit(1);
}
