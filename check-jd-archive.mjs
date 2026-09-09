#!/usr/bin/env node
/**
 * check-jd-archive.mjs — JD Archival Validator for career-ops
 *
 * A report's `**URL:**` header is a live pointer, not an archive — it rots
 * the day a posting closes or gets taken down, which reliably happens
 * somewhere in the weeks between applying and a later interview round. Prior
 * to this script, "also archive the JD" was a prompt-only instruction in
 * `modes/pdf.md` step 4 ("write the JD to jds/{slug}.md if it isn't already
 * one") with zero code enforcement — on a real tracker with 7 saved reports,
 * `jds/` was completely empty. This is the watchdog: zero LLM, zero network,
 * zero writes.
 *
 * A report counts as archived when EITHER holds:
 *   (a) it carries a `## Job Description` section (the primary mechanism —
 *       `## Job Description (archived verbatim)` per modes/oferta.md and
 *       modes/pdf.md) with substantive content, not an empty placeholder, or
 *   (b) a corresponding jds/ capture exists for it.
 *
 * (b) reuses jd-capture.mjs's findCaptureForReport — the same report-number
 * lookup outcome.mjs already relies on — rather than inventing a new slug
 * matcher. That function only resolves captures written with a numeric
 * report-number prefix (archive-posting.mjs --report=N), which AGENTS.md's
 * "JD captures (jds/)" section already documents as the recommended writer;
 * the other jds/ naming conventions in play (date-prefixed, sha1-suffixed,
 * bare company-role slugs) have no report number to key on and are not
 * reliably resolvable back to a specific report, so they cannot be credited
 * here. The report's own filename ({###}-{company-slug}-{YYYY-MM-DD}.md)
 * already carries the canonical company slug used to disambiguate captures —
 * no separate slugify pass is needed.
 *
 * Reports missing BOTH are flagged. The severity of that flag depends on the
 * report's OWN tracker row (PR #2791 review, 2026-08-14 to 2026-08-17):
 *
 *   - No tracker available to join against (fresh install, no
 *     data/applications.md yet, or a caller testing reports/jds/ in
 *     isolation): the legacy hard `missing-jd-archive` finding — there is no
 *     retroactive corpus to reason about, so every report is presumptively
 *     the "going forward" case and gets full enforcement.
 *   - Tracker row resolves to a TERMINAL state (Rejected, Discarded, SKIP,
 *     Hired): no finding at all, not even a warning. The application is
 *     done; a dead JD carries no further risk.
 *   - Tracker row resolves to a LIVE state (Evaluated, Applied, Responded,
 *     Interview, Offer), OR the join can't resolve the row (no match,
 *     ambiguous match, or an unreadable/unparseable tracker) — a soft
 *     `jd-archive-review-due` finding, same severity shape as
 *     check-table-freshness.mjs's `review-due`: visible, never blocking CI.
 *     santifer's ruling explicitly rejected a report-age/creation-date
 *     cutoff here — the risk this validator exists for (a posting dying
 *     before the JD is needed again) tracks whether the APPLICATION is
 *     still live, not when the REPORT was written, so an old-but-live row
 *     gets the same soft-warning treatment as a report written yesterday.
 *
 * Terminal/live classification joins report numbers against
 * data/applications.md via tracker-parse.mjs's own extractTrackerReportNumbers
 * (the same report<->row lookup set-status.mjs already relies on) and
 * templates/states.yml via tracker-utils.mjs's loadCanonicalStates /
 * resolveCanonicalState — no second tracker parser, read-only, fail-soft.
 *
 * Run: node check-jd-archive.mjs                        (JSON to stdout)
 *      node check-jd-archive.mjs --summary               (human-readable table)
 *      node check-jd-archive.mjs --reports-dir path/to    (override, for testing)
 *      node check-jd-archive.mjs --jds-dir path/to        (override, for testing)
 *      node check-jd-archive.mjs --tracker path/to        (override, for testing)
 *      node check-jd-archive.mjs --no-tracker             (skip the tracker join; legacy hard behavior)
 *      node check-jd-archive.mjs --self-test
 *      node check-jd-archive.mjs --help
 *
 * Exit codes: 1 if any hard `missing-jd-archive` finding, 0 otherwise —
 * `jd-archive-review-due` alone never fails the run (matches
 * check-table-freshness.mjs's `review-due`).
 *
 * Issue #2789 — github.com/santifer/career-ops
 */

import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { flagValue } from './lib/cli-flags.mjs';
import { findCaptureForReport } from './jd-capture.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { resolveColumns, parseTrackerRow, extractTrackerReportNumbers } from './tracker-parse.mjs';
import { loadCanonicalStates, resolveCanonicalState, resolveTrackerPath } from './tracker-utils.mjs';
import { isMainModule } from './lib/is-main-module.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = getCareerOpsRoot();
const DEFAULT_REPORTS_DIR = join(DATA_ROOT, 'reports');
const DEFAULT_JDS_DIR = join(DATA_ROOT, 'jds');
const DEFAULT_TRACKER_PATH = resolveTrackerPath(DATA_ROOT);
const STATES_FILE = join(CAREER_OPS, 'templates/states.yml');

// The retroactive-enforcement terminal set (PR #2791, santifer 2026-08-17:
// "build the state-based split you described" — Schlaflied 2026-08-16).
// Confirmed against templates/states.yml's own canonical labels. "Offer" is
// deliberately EXCLUDED even though states.yml marks it `terminal: true` for
// lifecycle-ordering purposes (tracker-sync-check.mjs) — an offer in hand is
// still an active, undecided application, not a closed file, and the JD may
// still be needed for negotiation or comparison.
const RETROACTIVE_TERMINAL_LABELS = new Set(['Rejected', 'Discarded', 'SKIP', 'Hired']);

// Below this many non-whitespace characters, a "## Job Description" section
// is treated as an unfilled placeholder, not an archive — a bare heading
// with nothing under it (or a one-line "(see URL above)" stub) should not
// pass as verbatim JD text.
const MIN_ARCHIVE_CHARS = 40;

const USAGE = `Usage:
  node check-jd-archive.mjs                      # full JSON findings to stdout
  node check-jd-archive.mjs --summary             # human-readable table
  node check-jd-archive.mjs --reports-dir <path>  # override reports/ (testing)
  node check-jd-archive.mjs --jds-dir <path>      # override jds/ (testing)
  node check-jd-archive.mjs --tracker <path>      # override data/applications.md (testing)
  node check-jd-archive.mjs --no-tracker          # skip the tracker join (legacy hard-only behavior)
  node check-jd-archive.mjs --self-test           # run the in-memory test suite
  node check-jd-archive.mjs --help                # print this usage block and exit`;

// --- CLI args ---
const args = process.argv.slice(2);
const summaryMode = args.includes('--summary');
const selfTestMode = args.includes('--self-test');
const reportsDirArg = flagValue(args, '--reports-dir') ?? null;
const jdsDirArg = flagValue(args, '--jds-dir') ?? null;
const trackerArg = flagValue(args, '--tracker') ?? null;
const noTrackerMode = args.includes('--no-tracker');

// --- Report filename parsing ---
// reports/{###}-{company-slug}-{YYYY-MM-DD}.md (AGENTS.md "Save report .md").
// The company slug may itself contain hyphens (e.g. confidential-hays for
// agency-mediated postings, #1596), so the match is anchored on the fixed
// numeric-prefix and trailing-date shapes and everything between is the slug.
const REPORT_FILENAME_RE = /^(\d+)-(.+)-(\d{4}-\d{2}-\d{2})\.md$/;

export function parseReportFilename(filename) {
  const m = REPORT_FILENAME_RE.exec(filename);
  if (!m) return null;
  return { reportNum: parseInt(m[1], 10), companySlug: m[2], date: m[3] };
}

// --- Archive-section detection ---
// Matches "## Job Description", with or without a parenthetical/suffix (the
// canonical heading is "## Job Description (archived verbatim)"). Content is
// read up to the next KNOWN report-section heading or end of file — not any
// "## " line, because a JD pasted verbatim can itself contain markdown-style
// sub-headings (e.g. "## Responsibilities"), which would otherwise truncate
// the section and falsely report a real archive as missing (CodeRabbit,
// PR #2791). The allowlist below is every section name modes/oferta.md's
// report template actually uses; a real JD's own text is vanishingly
// unlikely to collide with one verbatim. HTML comments are stripped before
// the length check so a commented-out template stub doesn't count as
// archived text.
const JD_HEADING_RE = /^##\s+Job Description\b.*$/im;
const NEXT_REPORT_SECTION_RE =
  /^##\s+(?:Machine Summary|Keywords extracted|[A-Z]\)|Block\s[A-Z]\b|Risk Summary|Cover Letter Draft|Post-evaluation|Liveness gate|Blacklist gate|Bounded Research Budget|Step 0\b)/im;

// The unfilled modes/oferta.md template placeholder ("(the posting's full
// text, pasted verbatim — see requirement below)") is 66 characters — longer
// than MIN_ARCHIVE_CHARS, so a report where the evaluator copied the
// template heading but never filled it in would otherwise pass validation
// (CodeRabbit, PR #2791). Reject it explicitly rather than relying on length
// alone.
const UNFILLED_TEMPLATE_PLACEHOLDER =
  "(the posting's full text, pasted verbatim — see requirement below)";

// modes/oferta.md documents a second legitimate shape for this section: a
// pointer to a jds/ capture in place of the verbatim text, for a JD too long
// to paste inline. A pointer sentence like "See jds/042-acme-2026-01-15.md
// for the full archive (archive-posting.mjs --report=042)." easily clears
// MIN_ARCHIVE_CHARS on length alone, which would let a WRONG or NONEXISTENT
// path pass validation without ever being resolved (CodeRabbit, PR #2791
// round 3).
//
// A section counts as a path-only pointer — and is NOT credited as embedded
// text, forcing checkJdArchive()'s findCaptureForReport() resolution to
// actually verify the capture — only when the ENTIRE section (after an
// optional leading "Posted: ..." line) matches nothing but the canonical
// pointer sentence below. Substantive JD prose that merely mentions a jds/
// path in passing must still be credited directly (CodeRabbit, PR #2791
// round 4) — an earlier version of this check treated ANY jds/*.md
// reference anywhere in the section as pointer-only, which wrongly rejected
// real archived text alongside an incidental path mention.
const JDS_PATH_RE = /jds\/[^\s()]+\.md/;
const POSTED_LINE_RE = /^Posted:.*$/im;
const POINTER_SENTENCE_RE =
  /^See\s+jds\/[^\s()]+\.md\s+for the full archive(?:\s*\(archive-posting\.mjs\s+--report=\d+\))?\.?$/i;

function isPathOnlyPointer(strippedSection) {
  const withoutPostedLine = strippedSection.replace(POSTED_LINE_RE, '').trim();
  return POINTER_SENTENCE_RE.test(withoutPostedLine);
}

// A third rejection category, alongside the unfilled-template placeholder and
// the path-only pointer sentence above: content that clears MIN_ARCHIVE_CHARS
// on length alone but was never a job posting to begin with — a fetch that
// hit a login/auth wall, a 404 shell, a paywall interstitial, or a "please
// enable JavaScript" placeholder instead of the real page (#3829). Without
// this, a report archives e.g. "Sign in to view this job · Join LinkedIn to
// see who you know at Acme" (well past 40 chars) under a heading that
// promises "(archived verbatim)", and the validator reports green — a false
// positive worse than no archive at all, since the user believes the real
// posting is saved.
//
// Each pattern is anchored to phrasing distinctive enough not to collide
// with real JD prose. Deliberately NOT included: generic "this posting has
// closed" / "no longer available" phrasing standing alone — an ATS that
// shows a genuine "this posting has closed" message for an EXPIRED listing
// is legitimate content worth keeping for the record (the report may still
// need the JD's substance for a later comparison). Only the specific
// login-wall/404-shell/paywall/JS-required shapes the issue calls out are
// rejected here, not every possible "closed" phrasing — over-rejecting a
// real archived-but-closed posting would be its own bug (#3829 analysis).
const NON_CONTENT_MARKERS = [
  {
    category: 'login-wall',
    reason: 'looks like a sign-in/login wall, not a posting',
    re: /(sign in to view this job|join linkedin to see who you know at|please log in to continue|sign in to continue)/i,
  },
  {
    category: '404-shell',
    reason: 'looks like a 404 / page-not-found shell, not a posting',
    re: /(404\s*(?:error|not found)|page not found|this job posting is no longer available)/i,
  },
  {
    category: 'paywall',
    reason: 'looks like a paywall/subscription interstitial, not a posting',
    re: /(subscribe to continue reading|this content is for subscribers)/i,
  },
  {
    category: 'js-required',
    reason: 'looks like a "please enable JavaScript" shell, not a posting',
    re: /(please enable javascript|this site requires javascript|<noscript)/i,
  },
];

// Returns the first matching marker ({category, reason}) or null. Exported
// so checkJdArchive() can surface the specific reason in a finding's detail
// (per #3829: "`--summary` should name the reason so a user reads 'looks
// like a sign-in wall, not a posting' rather than a generic miss") — a
// separate lookup from the boolean hasEmbeddedJdArchive() below so the two
// stay independently testable while sharing the exact same stripped-section
// input.
export function detectNonContentMarker(strippedSection) {
  for (const marker of NON_CONTENT_MARKERS) {
    if (marker.re.test(strippedSection)) return marker;
  }
  return null;
}

// Shared section extraction, used by both hasEmbeddedJdArchive() and the
// non-content-marker lookup in checkJdArchive() so the two never drift on
// what counts as "the stripped section text" (heading match, next-heading
// truncation, and the fixed-point comment strip all applied identically).
// Returns the trimmed section text, or null when there is no
// "## Job Description" heading at all.
export function extractStrippedJdSection(content) {
  const text = String(content ?? '');
  const m = JD_HEADING_RE.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const nextHeadingOffset = rest.search(NEXT_REPORT_SECTION_RE);
  const section = nextHeadingOffset === -1 ? rest : rest.slice(0, nextHeadingOffset);
  // Loop the comment-strip to a fixed point rather than a single pass: a
  // single `.replace()` can leave a reconstructible `<!--...-->` behind when
  // the input has overlapping/nested comment-marker fragments (removing an
  // inner match splices the surrounding characters into a new valid match
  // the single pass never re-scans) — CodeQL "incomplete multi-character
  // sanitization" on PR #2791.
  let stripped = section;
  let prev;
  do {
    prev = stripped;
    stripped = stripped.replace(/<!--[\s\S]*?-->/g, '');
  } while (stripped !== prev);
  return stripped.trim();
}

export function hasEmbeddedJdArchive(content) {
  const stripped = extractStrippedJdSection(content);
  if (stripped === null) return false;
  if (stripped === UNFILLED_TEMPLATE_PLACEHOLDER) return false;
  if (isPathOnlyPointer(stripped)) return false;
  if (detectNonContentMarker(stripped)) return false;
  return stripped.length >= MIN_ARCHIVE_CHARS;
}

// --- Tracker join (retroactive-enforcement classification) ---
/**
 * Classify every report number the tracker links to as 'terminal' or 'live',
 * for the retroactive-enforcement severity split (PR #2791 review). Read-only
 * — never writes, never touches applications.md's own lock.
 *
 * Reuses tracker-parse.mjs's own row parsing and report<->row lookup
 * (extractTrackerReportNumbers, the same one set-status.mjs's `--report N`
 * selector calls) and tracker-utils.mjs's loadCanonicalStates /
 * resolveCanonicalState for states.yml — no second tracker parser, no second
 * alias table.
 *
 * Returns null when there is nothing to join against at all (no tracker
 * file, unreadable tracker, or an unparseable/missing states.yml) — the
 * caller's contract is that null means "fall back to legacy hard
 * enforcement," NOT "treat every report as live." A report number simply
 * absent from the returned map (no linking row, or 2+ rows linking it) is
 * the fail-soft case instead: the caller treats a missing map entry as
 * 'live', matching santifer's "a row the join can't resolve gets the
 * warning, not an error" instruction.
 *
 * @param {string|null} trackerPath - Path to applications.md, or null/absent to skip the join.
 * @param {string} statesPath - Path to templates/states.yml.
 * @returns {Map<number,'terminal'|'live'>|null}
 */
export function classifyReportsByTrackerState(trackerPath, statesPath) {
  if (!trackerPath || !existsSync(trackerPath)) return null;

  let lines;
  try {
    lines = readFileSync(trackerPath, 'utf-8').split('\n');
  } catch {
    return null; // unreadable tracker — fall back to legacy hard enforcement, not a crash
  }

  let states;
  try {
    states = loadCanonicalStates(statesPath);
  } catch {
    return null; // unreadable/malformed states.yml — same fallback
  }

  const colmap = resolveColumns(lines);
  const byReport = new Map(); // reportNum -> matching tracker rows

  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row) continue;
    for (const num of extractTrackerReportNumbers(row.report, row.notes)) {
      if (!byReport.has(num)) byReport.set(num, []);
      byReport.get(num).push(row);
    }
  }

  const classification = new Map();
  for (const [num, matches] of byReport) {
    // Ambiguous — 2+ rows link the same report number — is the fail-soft
    // case, same as "no row at all": leave it OUT of the map so the caller
    // defaults it to 'live' rather than guessing which row is authoritative.
    if (matches.length !== 1) continue;
    const canonicalLabel = resolveCanonicalState(matches[0].status, states);
    if (canonicalLabel && RETROACTIVE_TERMINAL_LABELS.has(canonicalLabel)) {
      classification.set(num, 'terminal');
    }
    // An unrecognized/unresolvable status cell also stays out of the map —
    // fail-soft to 'live', not an error.
  }

  return classification;
}

// --- Core check ---
// Pure function over an already-resolved reports/jds directory pair, so the
// self-test runs entirely on its own fixtures. `trackerPath`/`statesPath` are
// optional — omitting trackerPath (or pointing it at a file that doesn't
// exist) preserves the pre-#2791-review hard-enforcement-only behavior, which
// is what every fixture-only self-test below still exercises.
export function checkJdArchive(reportsDir, jdsDir, { trackerPath = null, statesPath = STATES_FILE } = {}) {
  const findings = [];
  const warnings = [];
  let reportsScanned = 0;

  if (!existsSync(reportsDir)) {
    return { reportsScanned, findings, warnings };
  }

  const classification = classifyReportsByTrackerState(trackerPath, statesPath);

  const files = readdirSync(reportsDir).filter((f) => f.endsWith('.md')).sort();

  for (const file of files) {
    reportsScanned += 1;

    let content;
    try {
      content = readFileSync(join(reportsDir, file), 'utf-8');
    } catch (e) {
      warnings.push({ type: 'warning', file, detail: `could not read file: ${e.message.split('\n')[0]}` });
      continue;
    }

    if (hasEmbeddedJdArchive(content)) continue;

    const meta = parseReportFilename(file);
    let capture = null;
    if (meta && existsSync(jdsDir)) {
      capture = findCaptureForReport(jdsDir, meta.reportNum, { companySlug: meta.companySlug });
    }
    if (capture !== null) continue;

    const reportNum = meta ? meta.reportNum : null;
    // No tracker joined at all -> legacy hard behavior (going-forward /
    // fresh-install case: nothing to classify against, so full enforcement).
    // Tracker joined -> 'terminal' skips entirely; anything else (explicit
    // 'live', or absent from the map at all — no row, ambiguous rows, or an
    // unresolvable status) is the soft review-due finding.
    const state = classification === null
      ? null
      : (reportNum !== null && classification.get(reportNum) === 'terminal' ? 'terminal' : 'live');

    if (state === 'terminal') continue; // done deal, zero retroactive risk — not even a warning

    // A rejected section may carry a specific reason (fetch-failure/
    // non-content marker, #3829) rather than just being absent or too
    // short — surface it so a user reads "looks like a sign-in wall, not a
    // posting" instead of a generic miss.
    const strippedSection = extractStrippedJdSection(content);
    const marker = strippedSection !== null ? detectNonContentMarker(strippedSection) : null;

    const detail = marker
      ? `"## Job Description" section ${marker.reason} — not credited as an archive, and no jds/ capture found${meta ? ` for report ${meta.reportNum} (company slug "${meta.companySlug}")` : ''}`
      : meta
        ? `no "## Job Description" section with archived JD text, and no jds/ capture found for report ${meta.reportNum} (company slug "${meta.companySlug}")`
        : `no "## Job Description" section with archived JD text, and the filename does not match the {###}-{company-slug}-{YYYY-MM-DD}.md convention so no jds/ capture could be resolved`;

    findings.push(state === 'live'
      ? {
        type: 'jd-archive-review-due',
        file,
        report: reportNum,
        companySlug: meta ? meta.companySlug : null,
        detail: `${detail} — tracker row is still live (or unresolved), so this is a soft warning, not a blocker`,
      }
      : {
        type: 'missing-jd-archive',
        file,
        report: reportNum,
        companySlug: meta ? meta.companySlug : null,
        detail,
      });
  }

  return { reportsScanned, findings, warnings };
}

export const hasMissingArchive = (findings) => findings.some((f) => f.type === 'missing-jd-archive');

// --- Summary mode ---
function printSummary(result) {
  const { reportsScanned, findings, warnings } = result;
  console.log(`\n${'='.repeat(78)}`);
  console.log('  JD Archive Coverage — career-ops');
  console.log(`  reports scanned: ${reportsScanned}`);
  console.log(`${'='.repeat(78)}\n`);

  if (findings.length === 0) {
    console.log(reportsScanned === 0
      ? '  No report files found under reports/.\n'
      : '  Every report has an archived JD (embedded section or jds/ capture).\n');
  } else {
    const header = '  ' + 'Type'.padEnd(22) + 'Report'.padEnd(10) + 'File'.padEnd(30) + 'Detail';
    console.log(header);
    console.log('  ' + '-'.repeat(90));
    for (const f of findings) {
      const typeCol = f.type.padEnd(22);
      const reportCol = (f.report !== null ? String(f.report) : '?').padEnd(10);
      const fileCol = f.file.substring(0, 28).padEnd(30);
      console.log('  ' + typeCol + reportCol + fileCol + f.detail);
    }
    console.log('');
  }

  if (warnings.length) {
    console.log(`  ${warnings.length} warning${warnings.length === 1 ? '' : 's'} (files skipped, never fatal):`);
    for (const w of warnings) {
      console.log(`    ${w.file}: ${w.detail}`);
    }
    console.log('');
  }
}

// --- Self-test (fixtures only — never reads the real reports/ for findings) ---
function runSelfTest() {
  let pass = 0;
  let fail = 0;
  const check = (cond, label) => {
    if (cond) { pass += 1; } else { fail += 1; console.error(`  FAIL: ${label}`); }
  };

  // --- Unit-level checks on the pure functions ---
  check(parseReportFilename('042-acme-2026-01-15.md')?.reportNum === 42, 'parseReportFilename extracts the report number');
  check(parseReportFilename('042-acme-2026-01-15.md')?.companySlug === 'acme', 'parseReportFilename extracts a simple company slug');
  check(parseReportFilename('042-confidential-hays-2026-01-15.md')?.companySlug === 'confidential-hays',
    'parseReportFilename extracts a hyphenated company slug (agency-mediated posting, #1596)');
  check(parseReportFilename('not-a-report.md') === null, 'parseReportFilename rejects a non-conforming filename');
  check(parseReportFilename('042-acme-2026-01-15.txt') === null, 'parseReportFilename requires the .md extension');

  check(hasEmbeddedJdArchive('## Job Description (archived verbatim)\n\n' + 'A'.repeat(50) + '\n\n## Machine Summary\nfoo'),
    'hasEmbeddedJdArchive recognizes the canonical heading with substantive content');
  check(hasEmbeddedJdArchive('## Job Description\n\nWe are looking for a Senior Widget Engineer to join our growing platform team.'),
    'hasEmbeddedJdArchive recognizes a bare "## Job Description" heading (no parenthetical) with content');
  check(!hasEmbeddedJdArchive('## Job Description (archived verbatim)\n\n<!-- paste JD here -->\n\n## Machine Summary'),
    'hasEmbeddedJdArchive rejects a section containing only an HTML-comment placeholder');
  check(!hasEmbeddedJdArchive('## Job Description (archived verbatim)\n\n<!--<!---->-->\n\n## Machine Summary'),
    'hasEmbeddedJdArchive strips nested/overlapping comment markers to a fixed point rather than leaving a reconstructed <!-- --> behind after one pass (CodeQL incomplete-sanitization fix, PR #2791)');
  check(!hasEmbeddedJdArchive('## Job Description (archived verbatim)\n\nTBD\n\n## Machine Summary'),
    'hasEmbeddedJdArchive rejects a section too short to be real JD text');
  check(!hasEmbeddedJdArchive('# Evaluation: Acme — Engineer\n\n**URL:** https://example.com\n'),
    'hasEmbeddedJdArchive returns false when there is no Job Description section at all');
  check(hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nWe are looking for a Senior Widget Engineer.\n\n## Responsibilities\n\nShip widgets and mentor the team.\n\n## Machine Summary\nfoo'),
    'hasEmbeddedJdArchive keeps a JD-internal "## Responsibilities" sub-heading inside the section instead of truncating on it (CodeRabbit, PR #2791)');
  check(!hasEmbeddedJdArchive(
    "## Job Description (archived verbatim)\n(the posting's full text, pasted verbatim — see requirement below)\n\n## Machine Summary"),
    'hasEmbeddedJdArchive rejects the unfilled modes/oferta.md template placeholder even though it exceeds MIN_ARCHIVE_CHARS by length alone (CodeRabbit, PR #2791)');
  check(!hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nSee jds/042-acme-corp-2026-01-15.md for the full archive (archive-posting.mjs --report=042).\n\n## Machine Summary'),
    'hasEmbeddedJdArchive does not credit a path-only pointer sentence as embedded text, even though it clears MIN_ARCHIVE_CHARS by length alone — the pointer must resolve via findCaptureForReport instead (CodeRabbit, PR #2791)');
  check(hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nThis role owns curriculum design end to end, including SCORM packaging and LMS rollout, across three regional teams and a portfolio of concurrent projects.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive still credits substantive real prose with no jds/ path reference at all');
  check(hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nThis role owns curriculum design end to end, including SCORM packaging and LMS rollout. See jds/legacy-notes.md for historical context on the prior version of this posting.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive credits substantive JD prose even when it also mentions a jds/*.md path in passing — the section is not JUST the canonical pointer sentence, so it is read as archived text, not a pointer (CodeRabbit, PR #2791 round 4)');

  // --- Fetch-failure / non-content markers (#3829) ---
  // A LinkedIn-style login wall clears MIN_ARCHIVE_CHARS comfortably on
  // length alone, so each shape needs its own rejection, mirroring the
  // placeholder/pointer checks above.
  check(!hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nSign in to view this job · Join LinkedIn to see who you know at Acme Corporation.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive rejects a LinkedIn-style login-wall shell even though it clears MIN_ARCHIVE_CHARS by length alone (#3829)');
  check(!hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nPlease log in to continue. You must sign in to view this content and manage your job alerts.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive rejects a generic "please log in to continue" auth-wall shell (#3829)');
  // CodeRabbit review on #3837: a bare "please log in" alternative (with no
  // "to continue"/"to view" qualifier) was too broad and matched legitimate
  // JD prose instructing the eventual HIRE to log in to an internal system —
  // narrowed to the full "please log in to continue" phrase. Regression test
  // for the exact false-positive shape CodeRabbit flagged.
  check(hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nThis role manages our online course catalog. Please log in to our internal LMS after onboarding to review the current curriculum before your first day.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive does not false-positive on real JD prose containing a bare "Please log in" instruction unrelated to the archive itself being a login wall (CodeRabbit, PR #3837)');
  check(!hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\n404 Not Found. The page you requested could not be located on this server.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive rejects a 404 error shell (#3829)');
  check(!hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nThis job posting is no longer available. It may have been filled or removed by the employer.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive rejects a "this job posting is no longer available" removed-posting shell (#3829)');
  check(!hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nSubscribe to continue reading. This content is for subscribers only — create a free account to keep reading.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive rejects a paywall/subscription interstitial (#3829)');
  check(!hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nPlease enable JavaScript to run this application. This site requires JavaScript to display job listings.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive rejects a "please enable JavaScript" shell (#3829)');
  check(detectNonContentMarker('Sign in to view this job · Join LinkedIn to see who you know at Acme.')?.category === 'login-wall',
    'detectNonContentMarker classifies a login-wall shell with the login-wall category');
  check(detectNonContentMarker('404 Not Found. Page not found.')?.category === '404-shell',
    'detectNonContentMarker classifies a 404 shell with the 404-shell category');
  check(detectNonContentMarker('Subscribe to continue reading this article.')?.category === 'paywall',
    'detectNonContentMarker classifies a paywall interstitial with the paywall category');
  check(detectNonContentMarker('Please enable JavaScript to run this application.')?.category === 'js-required',
    'detectNonContentMarker classifies a JS-required shell with the js-required category');
  check(detectNonContentMarker('This role owns curriculum design end to end, including SCORM packaging and LMS rollout across three teams.') === null,
    'detectNonContentMarker returns null for substantive real JD prose with no non-content phrasing');
  // A genuine, terse-but-real JD excerpt must still pass — proves the new
  // rejection category is not over-aggressive on legitimate short postings.
  check(hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nWe are hiring a part-time Instructional Design Assistant to support course updates in our LMS, 10 hours/week, remote, $28/hr. Email your resume to hiring@example.com.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive still credits a genuine, terse real JD excerpt — the non-content-marker rejection is not over-aggressive (#3829)');
  // A real posting that legitimately says the ROLE requires signing in to an
  // internal portal (not that the ARCHIVE itself is a login wall) should not
  // false-positive just because it mentions "sign in" in passing without any
  // of the anchored login-wall phrasing.
  check(hasEmbeddedJdArchive(
    '## Job Description (archived verbatim)\n\nOnce hired, you will sign in to our internal LMS daily to manage learner rosters and publish course updates across three regional campuses.\n\n## Machine Summary'),
    'hasEmbeddedJdArchive does not false-positive on real JD prose that merely mentions signing in to an internal system, since it does not match the anchored login-wall phrasing (#3829)');

  // --- Fixture directory tree (mkdtempSync, mirrors the repo's own test convention) ---
  const tmpDir = mkdtempSync(join(tmpdir(), 'check-jd-archive-test-'));
  const reportsDir = join(tmpDir, 'reports');
  const jdsDir = join(tmpDir, 'jds');
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(jdsDir, { recursive: true });

  try {
    // Fixture 1: no archive section, no jds/ capture -> flagged.
    writeFileSync(join(reportsDir, '001-acme-2026-01-15.md'), [
      '# Evaluation: Acme — Senior Widget Engineer',
      '',
      '**Date:** 2026-01-15',
      '**URL:** https://example.com/jobs/acme-widget-engineer',
      '**Score:** 4.2/5',
      '',
      '## Machine Summary',
      'score: 4.2',
    ].join('\n'));

    // Fixture 2: embedded archive section with substantive content -> not flagged.
    writeFileSync(join(reportsDir, '002-globex-2026-01-16.md'), [
      '# Evaluation: Globex — Instructional Designer',
      '',
      '**Date:** 2026-01-16',
      '**URL:** https://example.com/jobs/globex-id',
      '**Score:** 4.5/5',
      '',
      '## Job Description (archived verbatim)',
      '',
      'Globex Corporation is seeking an Instructional Designer to build learning',
      'experiences for our internal enablement platform. Requirements: 3+ years',
      'of L&D experience, familiarity with Articulate 360, strong stakeholder',
      'communication skills.',
      '',
      '## Machine Summary',
      'score: 4.5',
    ].join('\n'));

    // Fixture 3: no archive section, but a matching jds/ capture (report-number
    // prefixed, per archive-posting.mjs --report=N) -> not flagged (either form counts).
    writeFileSync(join(reportsDir, '003-initech-2026-01-17.md'), [
      '# Evaluation: Initech — EdTech Specialist',
      '',
      '**Date:** 2026-01-17',
      '**URL:** https://example.com/jobs/initech-edtech',
      '**Score:** 4.0/5',
      '',
      '## Machine Summary',
      'score: 4.0',
    ].join('\n'));
    writeFileSync(join(jdsDir, '003-2026-01-17_initech_edtech-specialist.pdf'), 'fake-pdf-bytes');

    // Fixture 4: filename doesn't match the {###}-{slug}-{date}.md convention ->
    // still flagged (can't be resolved to a jds/ capture), but with the
    // "no meta" detail branch rather than a crash.
    writeFileSync(join(reportsDir, 'hand-named-report.md'), '# Evaluation: Weyland — Analyst\n\n**URL:** https://example.com\n');

    // Fixture 5: the archive section is a path-only pointer to a jds/ capture
    // that does NOT exist -> flagged, not silently accepted on length alone
    // (CodeRabbit, PR #2791).
    writeFileSync(join(reportsDir, '005-umbrella-2026-01-20.md'), [
      '# Evaluation: Umbrella Corp — Analyst',
      '',
      '**URL:** https://example.com/jobs/umbrella-analyst',
      '',
      '## Job Description (archived verbatim)',
      'See jds/005-umbrella-2026-01-20.md for the full archive (archive-posting.mjs --report=005).',
      '',
      '## Machine Summary',
      'score: 4.0',
    ].join('\n'));
    // Deliberately no matching file written under jdsDir for report 005.

    // Fixture 6: the archive section is a path-only pointer to a jds/ capture
    // that DOES exist -> not flagged, the pointer correctly resolves.
    writeFileSync(join(reportsDir, '006-oscorp-2026-01-21.md'), [
      '# Evaluation: Oscorp — Analyst',
      '',
      '**URL:** https://example.com/jobs/oscorp-analyst',
      '',
      '## Job Description (archived verbatim)',
      'Posted: 2026-01-18',
      'See jds/006-oscorp-2026-01-21.md for the full archive (archive-posting.mjs --report=006).',
      '',
      '## Machine Summary',
      'score: 4.0',
    ].join('\n'));
    writeFileSync(join(jdsDir, '006-2026-01-21_oscorp_analyst.pdf'), 'fake-pdf-bytes');

    // Fixture 7: the archive section is a LinkedIn-style login wall that
    // clears MIN_ARCHIVE_CHARS on length alone, with no jds/ capture to fall
    // back on -> flagged, and the finding's detail names the specific reason
    // rather than a generic miss (#3829).
    writeFileSync(join(reportsDir, '007-wayne-2026-01-22.md'), [
      '# Evaluation: Wayne Enterprises — Analyst',
      '',
      '**URL:** https://linkedin.com/jobs/view/wayne-analyst',
      '',
      '## Job Description (archived verbatim)',
      '',
      'Sign in to view this job · Join LinkedIn to see who you know at Wayne Enterprises.',
      '',
      '## Machine Summary',
      'score: 4.0',
    ].join('\n'));

    const result = checkJdArchive(reportsDir, jdsDir);

    check(result.reportsScanned === 7, `all 7 fixture reports scanned (got ${result.reportsScanned})`);

    const flaggedFiles = new Set(result.findings.map((f) => f.file));
    check(flaggedFiles.has('001-acme-2026-01-15.md'), 'report with neither archive form is flagged missing-jd-archive');
    check(!flaggedFiles.has('002-globex-2026-01-16.md'), 'report with an embedded archive section is not flagged');
    check(!flaggedFiles.has('003-initech-2026-01-17.md'), 'report with a matching jds/ capture (no embedded section) is not flagged');
    check(flaggedFiles.has('005-umbrella-2026-01-20.md'), 'a path-only pointer to a NONEXISTENT jds/ capture is flagged, not accepted on length alone');
    check(!flaggedFiles.has('006-oscorp-2026-01-21.md'), 'a path-only pointer to an EXISTING jds/ capture is not flagged — resolves via findCaptureForReport');
    check(flaggedFiles.has('007-wayne-2026-01-22.md'), 'a LinkedIn-style login-wall archive is flagged, not accepted on length alone (#3829)');
    check(flaggedFiles.has('hand-named-report.md'), 'report with a non-conforming filename and no archive section is flagged');

    const handNamedFinding = result.findings.find((f) => f.file === 'hand-named-report.md');
    check(handNamedFinding?.report === null, 'non-conforming filename finding carries report: null instead of guessing');

    const loginWallFinding = result.findings.find((f) => f.file === '007-wayne-2026-01-22.md');
    check(loginWallFinding?.detail?.includes('sign-in/login wall'),
      'the login-wall finding names the specific reason in its detail, not a generic miss (#3829)');

    check(result.findings.every((f) => f.type === 'missing-jd-archive'), 'every finding uses the missing-jd-archive type');
    check(hasMissingArchive(result.findings) === true, 'hasMissingArchive is true when findings are present');

    // Company-slug disambiguation: a jds/ capture with the right report-number
    // prefix but a DIFFERENT company must not be credited to this report.
    const mismatchReportsDir = join(tmpDir, 'reports-mismatch');
    const mismatchJdsDir = join(tmpDir, 'jds-mismatch');
    mkdirSync(mismatchReportsDir, { recursive: true });
    mkdirSync(mismatchJdsDir, { recursive: true });
    writeFileSync(join(mismatchReportsDir, '005-umbrella-2026-01-20.md'), '# Evaluation: Umbrella — Analyst\n\n**URL:** https://example.com\n');
    writeFileSync(join(mismatchJdsDir, '005-2026-01-20_othercorp_analyst.pdf'), 'fake-pdf-bytes');
    const mismatchResult = checkJdArchive(mismatchReportsDir, mismatchJdsDir);
    check(mismatchResult.findings.some((f) => f.file === '005-umbrella-2026-01-20.md'),
      'a jds/ capture for the same report number but a different company is not credited (company-slug guard)');

    // Empty reports dir -> clean empty result, exit 0 path.
    const emptyReportsDir = join(tmpDir, 'reports-empty');
    mkdirSync(emptyReportsDir, { recursive: true });
    const emptyResult = checkJdArchive(emptyReportsDir, jdsDir);
    check(emptyResult.reportsScanned === 0 && emptyResult.findings.length === 0 && !hasMissingArchive(emptyResult.findings),
      'no report files -> empty result, exit 0 (the designed empty-repo case, matches a fresh checkout with reports/*.md gitignored)');

    // Missing reports dir entirely (never created) -> same clean empty result, no crash.
    const neverCreatedResult = checkJdArchive(join(tmpDir, 'does-not-exist'), jdsDir);
    check(neverCreatedResult.reportsScanned === 0 && neverCreatedResult.findings.length === 0,
      'missing reports directory -> empty result, no crash');

    // Missing jds dir (never created) with no embedded section -> still flagged, no crash.
    const noJdsDirResult = checkJdArchive(reportsDir, join(tmpDir, 'jds-does-not-exist'));
    check(noJdsDirResult.findings.some((f) => f.file === '001-acme-2026-01-15.md'),
      'missing jds/ directory does not crash the lookup — falls through to flagged');

    // --- Retroactive-enforcement classification (PR #2791 review, 2026-08-17) ---
    // Four reports, all missing their archive, joined against one synthetic
    // tracker exercising all four classification outcomes at once: a
    // terminal-state row, a live-state row, a report number with no linking
    // row at all, and one linked by two rows (ambiguous).
    const trackerReportsDir = join(tmpDir, 'reports-tracker');
    mkdirSync(trackerReportsDir, { recursive: true });
    writeFileSync(join(trackerReportsDir, '101-acme-2026-01-01.md'), '# Evaluation: Acme — Analyst\n\n**URL:** https://example.com\n');
    writeFileSync(join(trackerReportsDir, '102-globex-2026-01-02.md'), '# Evaluation: Globex — Analyst\n\n**URL:** https://example.com\n');
    writeFileSync(join(trackerReportsDir, '103-initech-2026-01-03.md'), '# Evaluation: Initech — Analyst\n\n**URL:** https://example.com\n');
    writeFileSync(join(trackerReportsDir, '104-umbrella-2026-01-04.md'), '# Evaluation: Umbrella — Analyst\n\n**URL:** https://example.com\n');

    const trackerPath = join(tmpDir, 'applications.md');
    writeFileSync(trackerPath, [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      // 101: terminal state (Rejected) -> no finding at all.
      '| 1 | 2026-01-01 | Acme | Analyst | 4.0/5 | Rejected | ✅ | [101](reports/101-acme-2026-01-01.md) | |',
      // 102: live state (Applied) -> soft review-due finding.
      '| 2 | 2026-01-02 | Globex | Analyst | 4.0/5 | Applied | ✅ | [102](reports/102-globex-2026-01-02.md) | |',
      // 103 (Initech) is deliberately unlinked by any row -> unresolved join.
      // 104: linked by TWO rows -> ambiguous join, fails soft.
      '| 3 | 2026-01-04 | Umbrella | Analyst A | 4.0/5 | Applied | ✅ | [104](reports/104-umbrella-2026-01-04.md) | |',
      '| 4 | 2026-01-04 | Umbrella | Analyst B | 3.5/5 | Interview | ✅ | [104](reports/104-umbrella-2026-01-04.md) | |',
    ].join('\n'));

    const trackerResult = checkJdArchive(trackerReportsDir, jdsDir, { trackerPath });
    const findingTypeByFile = new Map(trackerResult.findings.map((f) => [f.file, f.type]));

    check(!findingTypeByFile.has('101-acme-2026-01-01.md'),
      'terminal-state (Rejected) tracker row -> report missing its archive gets NO finding at all, not even a warning');
    check(findingTypeByFile.get('102-globex-2026-01-02.md') === 'jd-archive-review-due',
      'live-state (Applied) tracker row -> report missing its archive gets a soft jd-archive-review-due finding, not a hard blocker');
    check(findingTypeByFile.get('103-initech-2026-01-03.md') === 'jd-archive-review-due',
      'report number with NO linking tracker row -> unresolved join fails soft to the same review-due warning, not an error');
    check(findingTypeByFile.get('104-umbrella-2026-01-04.md') === 'jd-archive-review-due',
      'report number linked by 2+ tracker rows (ambiguous) -> fails soft to review-due rather than guessing which row is authoritative');
    check(!hasMissingArchive(trackerResult.findings),
      'a tracker-joined run touching only terminal/live/unresolved rows never trips the hard-blocking hasMissingArchive/exit-1 path');

    // Going-forward / no-tracker enforcement is unaffected: the SAME 4
    // fixtures, with the tracker join disabled, are the pre-existing hard
    // blocker — the retroactive softening only ever activates when there IS
    // a resolvable tracker to join against, never as a blanket downgrade.
    const noTrackerResult = checkJdArchive(trackerReportsDir, jdsDir); // no options -> trackerPath stays null
    check(noTrackerResult.findings.filter((f) => f.type === 'missing-jd-archive').length === 4,
      'without a tracker to join against, all 4 fixtures stay the legacy hard missing-jd-archive finding (going-forward/fresh-install enforcement unaffected)');
    check(hasMissingArchive(noTrackerResult.findings) === true,
      'no-tracker run still trips hasMissingArchive (exit 1) — retroactive softening never applies without a resolvable tracker');

    // --no-tracker is the CLI's own opt-out; verify it via the same
    // options-object contract the CLI wires it through.
    const explicitNoTrackerResult = checkJdArchive(trackerReportsDir, jdsDir, { trackerPath: null });
    check(hasMissingArchive(explicitNoTrackerResult.findings) === true,
      'passing trackerPath: null explicitly reproduces the --no-tracker CLI path (hard enforcement)');

    // classifyReportsByTrackerState in isolation: nonexistent tracker file -> null.
    check(classifyReportsByTrackerState(join(tmpDir, 'does-not-exist.md'), STATES_FILE) === null,
      'classifyReportsByTrackerState returns null (the fall-back-to-hard signal) when the tracker file does not exist');
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n  check-jd-archive self-test: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

// --- Run (CLI only; guarded so the module is safely importable for tests) ---
if (isMainModule(import.meta.url)) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  if (selfTestMode) {
    runSelfTest();
  }

  const reportsDir = reportsDirArg || DEFAULT_REPORTS_DIR;
  const jdsDir = jdsDirArg || DEFAULT_JDS_DIR;
  const trackerPath = noTrackerMode ? null : (trackerArg || DEFAULT_TRACKER_PATH);

  const result = checkJdArchive(reportsDir, jdsDir, { trackerPath });

  if (summaryMode) {
    printSummary(result);
  } else {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      reportsScanned: result.reportsScanned,
      findings: result.findings,
      warnings: result.warnings,
    }, null, 2));
  }

  process.exit(hasMissingArchive(result.findings) ? 1 : 0);
}
