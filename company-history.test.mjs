/**
 * company-history.test.mjs — External test suite for company-history.mjs
 *
 * Complements the 38 in-file `--self-test` fixtures (join/label goldens,
 * right-censoring, rejection-is-an-answer, confidence-vs-label, staleness,
 * absent-source degradation, --company lookup, vocabulary). This suite
 * covers scenarios the self-test does NOT: a full multi-source 3-company
 * JSON-shape scenario (tracker + follow-ups + repost clusters joined
 * together), the --silence-window boundary (window-1 / window / window+1),
 * dateBasis provenance (notes / evaluation-date / status-log priority),
 * loading real files from disk via the exported loaders, and CLI smoke
 * tests.
 *
 * Run: node company-history.test.mjs
 */

import {
  resolveDefaultSilenceWindow,
  today,
  loadTrackerRows,
  loadFollowupRows,
  loadRepostClusters,
  buildFollowupCountsByAppNum,
  resolveAppliedDate,
  computeResponsiveness,
  buildCompanyCards,
  getCompanyCard,
  renderSummary,
} from './company-history.mjs';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';

let passed = 0;
let failed = 0;
const failures = [];

function ok(label, cond) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  }
}

// Tracker-row fixture — mirrors the shape parseTrackerRow() produces.
function row(num, company, status, date, notes = '') {
  return { num, date, company, role: 'Engineer', score: '4/5', status, pdf: '✅', report: `reports/${num}.md`, notes };
}

// Follow-up-row fixture — mirrors parseFollowups() output.
function followup(num, appNum, date, company, role = 'Engineer', channel = 'Email', contact = 'jane@co.com', notes = '') {
  return { num, appNum, date, company, role, channel, contact, notes };
}

// Repost-cluster fixture — mirrors detect-reposts.mjs's detectReposts() output shape.
function cluster(company, role, repostCount, firstSeen, lastSeen, daysSpan, appearances) {
  return { company, role, repostCount, firstSeen, lastSeen, daysSpan, appearances };
}

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'company-history.mjs');
const NOW = new Date('2026-07-09T00:00:00Z');

// ============================================================================
// 1. Full multi-source 3-company scenario (buildCompanyCards end-to-end)
// ============================================================================
console.log('\n--- 1. multi-source 3-company scenario ---');

{
  const trackerRows = [
    // Company A: Responsive Corp — one Rejected row -> responded-before.
    row(1, 'Responsive Corp', 'Rejected', '2026-06-01'),
    // Company B: Silent Systems — old Applied row, applied date from notes.
    row(2, 'Silent Systems', 'Applied', '2026-03-01', 'Applied 2026-03-10'),
    // Company C: unjoinable non-Latin name -> excluded from companies, counted unjoinable.
    row(3, '株式会社テスト', 'Applied', '2026-01-01'),
  ];
  const followupRows = [
    followup(1, 2, '2026-03-20', 'Silent Systems'),
  ];
  const repostClusters = [
    cluster('Silent Systems', 'Engineer', 2, '2026-01-01', '2026-02-01', 31, [
      { url: 'https://silentsystems.example/jobs/1', date: '2026-01-01', title: 'Engineer' },
      { url: 'https://silentsystems.example/jobs/2', date: '2026-02-01', title: 'Engineer' },
    ]),
  ];

  const result = buildCompanyCards(
    {
      trackerRows,
      followupRows,
      repostClusters,
      sourcesLoaded: { tracker: true, followups: true, scanHistory: true, statusLog: false },
    },
    { now: NOW, silenceWindowDays: 28 },
  );

  // --- metadata shape ---
  eq('metadata.silenceWindowDays', result.metadata.silenceWindowDays, 28);
  eq('metadata.staleAfterDays defaults to 365', result.metadata.staleAfterDays, 365);
  eq('metadata.companies excludes the unjoinable company', result.metadata.companies, 2);
  eq('metadata.sources reflects sourcesLoaded', result.metadata.sources, { tracker: true, followups: true, scanHistory: true, statusLog: false });

  // --- data quality ---
  eq('dataQuality.unjoinable counts the non-Latin company', result.dataQuality.unjoinable, 1);

  // --- card ordering (alphabetical by company name) ---
  eq('cards ordered alphabetically: Responsive Corp first', result.companies[0].company, 'Responsive Corp');
  eq('cards ordered alphabetically: Silent Systems second', result.companies[1].company, 'Silent Systems');

  const responsive = result.companies[0];
  const silent = result.companies[1];

  // --- Responsive Corp: responded-before, no churn data, no explanations ---
  eq('Responsive Corp label: responded-before', responsive.responsiveness.label, 'responded-before');
  eq('Responsive Corp churn: none-detected (scan-history loaded, no clusters for this company)', responsive.postingChurn.label, 'none-detected');
  eq('Responsive Corp has no explanations (no silent facts)', responsive.explanations.length, 0);
  eq('Responsive Corp medianResponseDays is null', responsive.responsiveness.medianResponseDays, null);

  // --- Silent Systems: silent-on-you, reposts-detected, confirmed-by-followups ---
  eq('Silent Systems label: silent-on-you', silent.responsiveness.label, 'silent-on-you');
  eq('Silent Systems churn: reposts-detected', silent.postingChurn.label, 'reposts-detected');
  ok('Silent Systems has explanations (has a silent fact)', silent.explanations.length > 0);
  ok('Silent Systems explanation mentions facts-not-verdicts framing', /facts, not verdicts/.test(silent.explanations[0]));
  eq('Silent Systems medianResponseDays is null', silent.responsiveness.medianResponseDays, null);

  const silentFact = silent.responsiveness.facts[0];
  eq('Silent Systems silent fact dateBasis is notes (notes-derived applied date)', silentFact.dateBasis, 'notes');
  eq('Silent Systems silent fact appliedDate comes from notes, not the date column', silentFact.appliedDate, '2026-03-10');
  eq('Silent Systems silent fact confidence: confirmed-by-followups (1 follow-up joined by appNum)', silentFact.confidence, 'confirmed-by-followups');
  ok('Silent Systems silent fact clearInstruction references set-status', typeof silentFact.clearInstruction === 'string' && silentFact.clearInstruction.includes('set-status'));

  // --- postingChurn cluster shape (only role/repostCount/daysSpan/lastSeen survive the mapping) ---
  const churnCluster = silent.postingChurn.clusters[0];
  ok('churn cluster has role', 'role' in churnCluster);
  ok('churn cluster has repostCount', 'repostCount' in churnCluster);
  ok('churn cluster has daysSpan', 'daysSpan' in churnCluster);
  ok('churn cluster has lastSeen', 'lastSeen' in churnCluster);
  eq('churn cluster repostCount', churnCluster.repostCount, 2);
  eq('churn cluster lastSeen', churnCluster.lastSeen, '2026-02-01');

  // --- hygiene.agedApplied ---
  eq('hygiene.agedApplied has exactly the Silent Systems entry', result.hygiene.agedApplied.length, 1);
  eq('hygiene entry num', result.hygiene.agedApplied[0].num, 2);
  eq('hygiene entry company', result.hygiene.agedApplied[0].company, 'Silent Systems');
  eq('hygiene entry silentDays (2026-03-10 -> 2026-07-09 = 121d)', result.hygiene.agedApplied[0].silentDays, 121);

  // --- renderSummary: hygiene message + company names present, banned vocabulary absent ---
  const summary = renderSummary(result);
  ok('summary mentions the aged-Applied hygiene nudge', summary.includes('aged-Applied row(s) look silent'));
  ok('summary includes Responsive Corp', summary.includes('Responsive Corp'));
  ok('summary includes Silent Systems', summary.includes('Silent Systems'));
  ok('summary never says "risk"', !/risk/i.test(summary));
  ok('summary never says "ghost"', !/ghost/i.test(summary));
}

// ============================================================================
// 2. --silence-window boundary: window-1 (pending) / window (silent) / window+1 (silent)
// ============================================================================
console.log('\n--- 2. silence-window boundary ---');

{
  const NOW2 = new Date('2026-01-11T00:00:00Z');
  const rows = [
    row(200, 'PendingWindowCo', 'Applied', '2026-01-02'), // 9 days old — window(10) - 1
    row(201, 'AtWindowCo', 'Applied', '2026-01-01'), // 10 days old — exactly the window
    row(202, 'PastWindowCo', 'Applied', '2025-12-31'), // 11 days old — window(10) + 1
  ];
  const result = buildCompanyCards(
    { trackerRows: rows, followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: false, statusLog: false } },
    { now: NOW2, silenceWindowDays: 10 },
  );

  const pending = getCompanyCard(result, 'PendingWindowCo');
  const atWindow = getCompanyCard(result, 'AtWindowCo');
  const pastWindow = getCompanyCard(result, 'PastWindowCo');

  eq('window-1 (9d): produces no fact (still pending)', pending.responsiveness.facts.length, 0);
  eq('window-1 (9d): label is no-history, not silent-on-you', pending.responsiveness.label, 'no-history');

  // Implementation uses `silentDays < silenceWindowDays` to continue (pending);
  // exactly at the window (10 !< 10) falls through and IS silent.
  eq('exactly-at-window (10d): produces a silent fact', atWindow.responsiveness.facts.length, 1);
  eq('exactly-at-window (10d): silentDays is 10', atWindow.responsiveness.facts[0].silentDays, 10);
  eq('exactly-at-window (10d): label is silent-on-you', atWindow.responsiveness.label, 'silent-on-you');

  eq('window+1 (11d): produces a silent fact', pastWindow.responsiveness.facts.length, 1);
  eq('window+1 (11d): silentDays is 11', pastWindow.responsiveness.facts[0].silentDays, 11);
  eq('window+1 (11d): label is silent-on-you', pastWindow.responsiveness.label, 'silent-on-you');

  // hygiene only picks up the two silent facts, sorted by silentDays descending.
  eq('hygiene.agedApplied has exactly 2 entries (pending excluded)', result.hygiene.agedApplied.length, 2);
  eq('hygiene sorted descending: PastWindowCo (11d) first', result.hygiene.agedApplied[0].company, 'PastWindowCo');
  eq('hygiene sorted descending: AtWindowCo (10d) second', result.hygiene.agedApplied[1].company, 'AtWindowCo');
  ok('PendingWindowCo never appears in hygiene', !result.hygiene.agedApplied.some(h => h.company === 'PendingWindowCo'));
}

// ============================================================================
// 3. dateBasis provenance (notes / evaluation-date / status-log priority)
// ============================================================================
console.log('\n--- 3. dateBasis provenance ---');

{
  const rowEval = row(300, 'EvalDateCo', 'Applied', '2026-01-01', ''); // no notes -> falls back to date column
  const rowNotes = row(301, 'NotesDateCo', 'Applied', '2026-01-15', 'Applied 2026-01-01'); // notes override the column

  const evalResult = computeResponsiveness([rowEval], new Map(), { now: NOW, silenceWindowDays: 28 });
  eq('no notes -> dateBasis evaluation-date', evalResult.facts[0].dateBasis, 'evaluation-date');
  eq('no notes -> appliedDate uses the date column', evalResult.facts[0].appliedDate, '2026-01-01');

  const notesResult = computeResponsiveness([rowNotes], new Map(), { now: NOW, silenceWindowDays: 28 });
  eq('notes present -> dateBasis notes', notesResult.facts[0].dateBasis, 'notes');
  eq('notes present -> appliedDate uses the notes date, not the column', notesResult.facts[0].appliedDate, '2026-01-01');

  // Direct resolveAppliedDate() checks, including status-log's top priority.
  const statusLogMap = new Map([[300, '2026-05-05']]);
  eq('resolveAppliedDate: status-log outranks both notes and the column', resolveAppliedDate(rowEval, statusLogMap), { dateStr: '2026-05-05', dateBasis: 'status-log' });
  eq('resolveAppliedDate: falls back to evaluation-date column when nothing else applies', resolveAppliedDate(rowEval, null), { dateStr: '2026-01-01', dateBasis: 'evaluation-date' });
  eq('resolveAppliedDate: notes outrank the date column', resolveAppliedDate(rowNotes, null), { dateStr: '2026-01-01', dateBasis: 'notes' });

  // A truthy but unparsable status-log date must NOT take precedence — it
  // would later fail parseDate() in computeResponsiveness and silently drop a
  // row that had perfectly valid notes/tracker evidence.
  const badLogMap = new Map([[301, 'not-a-date']]);
  eq('resolveAppliedDate: unparsable status-log date falls back to notes', resolveAppliedDate(rowNotes, badLogMap), { dateStr: '2026-01-01', dateBasis: 'notes' });
  const badLogMapEval = new Map([[300, 'not-a-date']]);
  eq('resolveAppliedDate: unparsable status-log date falls back to the date column', resolveAppliedDate(rowEval, badLogMapEval), { dateStr: '2026-01-01', dateBasis: 'evaluation-date' });
}

// ============================================================================
// 4. Loading real files from disk via the exported loaders
// ============================================================================
console.log('\n--- 4. real-file loaders ---');

{
  const tmpDir = mkdtempSync(join(tmpdir(), 'company-history-test-'));
  try {
    mkdirSync(join(tmpDir, 'data'), { recursive: true });

    const trackerContent = [
      '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
      '|---|------|---------|------|-------|--------|-----|--------|-------|',
      '| 1 | 2026-01-01 | LoaderCo | Engineer | 4/5 | Applied | ✅ | [1](reports/1.md) | Applied 2026-01-05 |',
    ].join('\n');
    writeFileSync(join(tmpDir, 'data/applications.md'), trackerContent);

    const tracker = loadTrackerRows(tmpDir);
    ok('loadTrackerRows: real file reports loaded=true', tracker.loaded === true);
    eq('loadTrackerRows: parses 1 row', tracker.rows.length, 1);
    eq('loadTrackerRows: row company parses correctly', tracker.rows[0].company, 'LoaderCo');

    const followupsContent = [
      '| # | App# | Date | Company | Role | Channel | Contact | Notes |',
      '|---|------|------|---------|------|---------|---------|-------|',
      '| 1 | 1 | 2026-01-10 | LoaderCo | Engineer | Email | a@a.com | first nudge |',
    ].join('\n');
    writeFileSync(join(tmpDir, 'data/follow-ups.md'), followupsContent);

    const followups = loadFollowupRows(tmpDir);
    ok('loadFollowupRows: real file reports loaded=true', followups.loaded === true);
    eq('loadFollowupRows: parses 1 row', followups.rows.length, 1);
    eq('loadFollowupRows: appNum joins to tracker row 1', followups.rows[0].appNum, 1);

    const scanTsv = [
      'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation',
      'https://loaderco.example/jobs/1\t2026-01-01\tgreenhouse\tEngineer\tLoaderCo\tadded\tRemote',
      'https://loaderco.example/jobs/2\t2026-02-01\tgreenhouse\tEngineer\tLoaderCo\tadded\tRemote',
    ].join('\n');
    const scanPath = join(tmpDir, 'custom-scan-history.tsv');
    writeFileSync(scanPath, scanTsv);

    const scanHistory = loadRepostClusters(tmpDir, scanPath);
    ok('loadRepostClusters: overridePath file reports loaded=true', scanHistory.loaded === true);
    eq('loadRepostClusters: finds 1 cluster via overridePath', scanHistory.clusters.length, 1);
    eq('loadRepostClusters: cluster company matches', scanHistory.clusters[0].company, 'LoaderCo');

    const counts = buildFollowupCountsByAppNum(followups.rows);
    eq('buildFollowupCountsByAppNum: counts appNum 1 once', counts.get(1), 1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================================
// 5. Misc exports: resolveDefaultSilenceWindow, today()
// ============================================================================
console.log('\n--- 5. misc exports ---');

{
  const bogusRoot = join(dirname(scriptPath), '__does-not-exist-benchmarks__');
  eq('resolveDefaultSilenceWindow: falls back to 28 when benchmarks.yml is absent', resolveDefaultSilenceWindow(bogusRoot), 28);
  ok('today() returns a Date instance', today() instanceof Date);
}

// ============================================================================
// 6. --company lookup: unknown company with scan-history loaded reports none-detected
// ============================================================================
console.log('\n--- 6. unknown-company churn label depends on scanHistory load state ---');

{
  const result = buildCompanyCards(
    { trackerRows: [row(400, 'KnownCo', 'Applied', '2026-01-01')], followupRows: [], repostClusters: [], sourcesLoaded: { tracker: true, followups: false, scanHistory: true, statusLog: false } },
    { now: NOW, silenceWindowDays: 28 },
  );
  const unknown = getCompanyCard(result, 'NeverSeenCo');
  eq('unknown company + scan-history loaded -> none-detected (not no-scan-data)', unknown.postingChurn.label, 'none-detected');
}

// ============================================================================
// 7. CLI smoke tests
// ============================================================================
console.log('\n--- 7. CLI smoke tests ---');

try {
  execFileSync('node', [scriptPath, '--self-test'], { encoding: 'utf-8', timeout: 10000 });
  ok('--self-test exits 0', true);
} catch (e) {
  ok('--self-test exits 0', false);
  console.log(`    exit code: ${e.status}, stderr: ${e.stderr?.slice(0, 200)}`);
}

try {
  const bareOut = execFileSync('node', [scriptPath], { encoding: 'utf-8', timeout: 10000, cwd: dirname(scriptPath) });
  const bareJson = JSON.parse(bareOut);
  ok('bare run produces valid JSON', typeof bareJson === 'object' && bareJson !== null);
  ok('bare run JSON has metadata key', 'metadata' in bareJson);
  ok('bare run JSON has companies key', 'companies' in bareJson && Array.isArray(bareJson.companies));
} catch (e) {
  ok('bare run produces valid JSON', false);
  console.log(`    exit code: ${e.status}, stderr: ${e.stderr?.slice(0, 200)}`);
}

try {
  execFileSync('node', [scriptPath, '--bogus-flag-xyz'], { encoding: 'utf-8', timeout: 10000, cwd: dirname(scriptPath) });
  ok('unknown flag exits 1', false);
} catch (e) {
  ok('unknown flag exits 1', e.status === 1);
}

// --silence-window validation: non-numeric, zero, and negative must fail fast
// (a silent fallback hides typos; a 0/negative window labels everything silent).
for (const bad of ['abc', '0', '--silence-window=-5']) {
  const flagArgs = bad.startsWith('--') ? [bad] : ['--silence-window', bad];
  try {
    execFileSync('node', [scriptPath, ...flagArgs], { encoding: 'utf-8', timeout: 10000, cwd: dirname(scriptPath) });
    ok(`--silence-window rejects "${bad}" with exit 1`, false);
  } catch (e) {
    ok(`--silence-window rejects "${bad}" with exit 1`,
      e.status === 1 && /positive integer/.test(String(e.stderr)));
  }
}

try {
  const winOut = execFileSync('node', [scriptPath, '--silence-window', '21'], { encoding: 'utf-8', timeout: 10000, cwd: dirname(scriptPath) });
  ok('--silence-window accepts a positive integer', JSON.parse(winOut).metadata.silenceWindowDays === 21);
} catch (e) {
  ok('--silence-window accepts a positive integer', false);
  console.log(`    exit code: ${e.status}, stderr: ${e.stderr?.slice(0, 200)}`);
}

// Value-taking flags must not consume the next flag as their value:
// `--company --summary` would otherwise filter to a company named "--summary".
for (const flagArgs of [['--company', '--summary'], ['--company'], ['--scan-history', '--summary'], ['--followups='], ['--company=']]) {
  const label = flagArgs.join(' ');
  try {
    execFileSync('node', [scriptPath, ...flagArgs], { encoding: 'utf-8', timeout: 10000, cwd: dirname(scriptPath) });
    ok(`value flag without a value ("${label}") exits 1`, false);
  } catch (e) {
    ok(`value flag without a value ("${label}") exits 1`,
      e.status === 1 && /expects a (non-empty )?value/.test(String(e.stderr)));
  }
}

// ============================================================================
// RESULTS
// ============================================================================
console.log(`\n${'='.repeat(78)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\n  Failed tests:`);
  for (const f of failures) console.log(`    - ${f}`);
}
console.log(`${'='.repeat(78)}`);

process.exit(failed > 0 ? 1 : 0);
