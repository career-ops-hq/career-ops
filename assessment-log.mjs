#!/usr/bin/env node
/**
 * assessment-log.mjs — Skills-assessment event logger (eSkill, HackerRank, Criteria, ...)
 *
 * "Received a skills assessment" is its own pipeline event — not Applied /
 * Interview / Rejected — so it gets logged structurally instead of buried in
 * free-text notes. Each event is an append-only observation, never mutated:
 *   { date, company, report#, platform, subject, threshold, score, stale_note }
 *
 * The staleness signal is candidate-observed and self-reported (e.g. "test
 * content references Adobe Acrobat 9, a 2008-era version") — an empty
 * stale_note means no staleness was observed, not that the bank is current.
 *
 * Log lives in data/assessments.tsv (user layer, append-only, created on first
 * `add`). Threshold/score are percentages; both optional — vendors often hide
 * the threshold, and some platforms never reveal the score.
 *
 * Future work (out of scope here): fold per-vendor staleness rates into
 * analyze-patterns.mjs the way ATS channel yield is analyzed today.
 *
 * Run: node assessment-log.mjs add --company <name> [--report <num>] \
 *        --platform <vendor> --subject <topic> [--threshold <pct>] \
 *        [--score <pct>] [--stale "<observed staleness note>"]
 *      node assessment-log.mjs             (JSON)
 *      node assessment-log.mjs --summary   (human-readable)
 *      node assessment-log.mjs --self-test
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(CAREER_OPS, 'data/assessments.tsv');

const HEADER_COMMENT = [
  '# assessments.tsv — append-only skills-assessment log (user layer). Never rewrite rows.',
  '# {YYYY-MM-DD}\\t{company}\\t{report#|-}\\t{platform}\\t{subject}\\t{threshold%|-}\\t{score%|-}\\t{stale_note}',
].join('\n');

// --- Percent parsing ---
// Tolerant: "70", "70%", "70.5 %" all parse; blank/-/? -> null (unknown, not zero).
export function parsePct(raw) {
  const s = String(raw ?? '').trim().replace(/%\s*$/, '').trim();
  if (!s || s === '-' || s === '?' || /^(n\/?a|null)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// --- Log parsing (TSV) ---
// line: {YYYY-MM-DD}\t{company}\t{report#|-}\t{platform}\t{subject}\t{threshold|-}\t{score|-}\t{stale_note}
// Optional trailing cells may be absent entirely (hand-written rows) — parsing
// stays tolerant; only date+company+platform+subject are structurally required.
export function parseAssessments(content) {
  const rows = [];
  const malformed = [];
  for (const line of String(content || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const cells = t.split('\t').map(c => c.trim());
    const [date, company, reportNum = '', platform = '', subject = '', threshold = '', score = '', staleNote = ''] = cells;
    if (cells.length < 5 || !date || !company || !platform || !subject) {
      malformed.push({ line: t.slice(0, 80) });
      continue;
    }
    const norm = (v) => (v === '' || v === '-' ? null : v);
    rows.push({
      date, company,
      reportNum: norm(reportNum),
      platform, subject,
      threshold: parsePct(threshold),
      score: parsePct(score),
      staleNote: norm(staleNote),
    });
  }
  return { rows, malformed };
}

// --- Aggregation ---
export function summarize(rows, malformed = []) {
  const byPlatform = {};
  let staleFlagged = 0;
  for (const r of rows) {
    byPlatform[r.platform] ??= { count: 0, staleFlagged: 0, passed: 0, failed: 0, unknownOutcome: 0 };
    const agg = byPlatform[r.platform];
    agg.count += 1;
    if (r.staleNote) { agg.staleFlagged += 1; staleFlagged += 1; }
    // Pass/fail only when BOTH threshold and score are known — a lone score
    // with a hidden threshold proves nothing either way.
    if (r.threshold !== null && r.score !== null) {
      if (r.score >= r.threshold) agg.passed += 1; else agg.failed += 1;
    } else {
      agg.unknownOutcome += 1;
    }
  }
  return {
    assessments: rows,
    aggregates: { byPlatform },
    quality: {
      total: rows.length,
      staleFlagged,
      withoutScore: rows.filter(r => r.score === null).length,
      withoutThreshold: rows.filter(r => r.threshold === null).length,
      malformedLines: malformed,
    },
  };
}

// --- Append (`add` subcommand) ---
export function buildRow(fields, today) {
  const req = (name) => {
    const v = String(fields[name] ?? '').trim();
    if (!v) throw new Error(`--${name} is required`);
    if (v.includes('\t') || v.includes('\n')) throw new Error(`--${name} must not contain tabs or newlines`);
    return v;
  };
  const opt = (name) => {
    const v = String(fields[name] ?? '').trim();
    if (v.includes('\t') || v.includes('\n')) throw new Error(`--${name} must not contain tabs or newlines`);
    return v || '-';
  };
  const optPct = (name) => {
    const v = String(fields[name] ?? '').trim();
    if (!v) return '-';
    if (parsePct(v) === null) throw new Error(`--${name} must be a percentage (e.g. 70 or 70%), got "${v}"`);
    return v;
  };
  return [
    today, req('company'), opt('report'), req('platform'), req('subject'),
    optPct('threshold'), optPct('score'), opt('stale') === '-' ? '' : opt('stale'),
  ].join('\t');
}

function addEntry(args) {
  const fields = {};
  for (let i = 0; i < args.length; i++) {
    const m = args[i].match(/^--(company|report|platform|subject|threshold|score|stale)$/);
    if (m) { fields[m[1]] = args[i + 1] ?? ''; i++; }
  }
  const today = new Date().toISOString().slice(0, 10);
  let row;
  try {
    row = buildRow(fields, today);
  } catch (e) {
    console.error(`assessment-log: ${e.message}`);
    console.error('Usage: node assessment-log.mjs add --company <name> [--report <num>] --platform <vendor> --subject <topic> [--threshold <pct>] [--score <pct>] [--stale "<note>"]');
    process.exit(1);
  }
  // Append-only: existing rows are never rewritten. Create with header comment on first use.
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  let prefix;
  if (existsSync(LOG_PATH)) {
    const existing = readFileSync(LOG_PATH, 'utf-8');
    prefix = existing.endsWith('\n') || existing === '' ? '' : '\n';
  } else {
    prefix = HEADER_COMMENT + '\n';
  }
  appendFileSync(LOG_PATH, prefix + row + '\n');
  console.log(JSON.stringify({ added: true, row: row.split('\t') }, null, 2));
}

// --- Self-test (in-memory fixtures, no file writes) ---
const LOG_FIXTURE = [
  '# comment line',
  '2026-07-01\tAcme\t042\teSkill\tMS Office\t70\t92\treferences Adobe Acrobat 9 (2008-era)',
  '2026-07-02\tGlobex\t-\tHackerRank\tJavaScript\t-\t85\t',
  '2026-07-03\tInitech\t013\tCriteria\tCognitive Aptitude\t65\t60\t',
  '2026-07-04\tHooli\t-\tPredictive Index\tBehavioral\t-\t-\t',
  '2026-07-05\tUmbrella\t017\teSkill\tOutlook\t70\t95\told Outlook web UI, nothing currently shipping',
  '2026-07-06\tAcme', // malformed on purpose — too few cells
].join('\n');

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) { console.error(`SELF-TEST FAIL: ${msg}`); process.exit(1); }
  };

  // parsePct
  assert(parsePct('70') === 70, '70 -> 70');
  assert(parsePct('70%') === 70, '70% -> 70');
  assert(parsePct('70.5 %') === 70.5, 'decimal with spaced % sign');
  assert(parsePct('-') === null, '- -> null');
  assert(parsePct('') === null, 'blank -> null');
  assert(parsePct('?') === null, '? -> null');
  assert(parsePct('n/a') === null, 'n/a -> null');
  assert(parsePct('high') === null, 'prose -> null');

  // parseAssessments
  const { rows, malformed } = parseAssessments(LOG_FIXTURE);
  assert(rows.length === 5, `5 rows parsed, got ${rows.length}`);
  assert(malformed.length === 1, `1 malformed line reported, got ${malformed.length}`);
  assert(rows[0].company === 'Acme' && rows[0].platform === 'eSkill' && rows[0].reportNum === '042', 'fields mapped');
  assert(rows[0].threshold === 70 && rows[0].score === 92, 'threshold/score parsed');
  assert(rows[0].staleNote.includes('Acrobat 9'), 'stale note preserved');
  assert(rows[1].reportNum === null && rows[1].threshold === null, 'optional cells -> null');
  assert(rows[3].score === null && rows[3].staleNote === null, 'no-score no-stale row tolerated');
  assert(parseAssessments('').rows.length === 0, 'empty log');
  // trailing cells absent entirely (hand-written short row) must still parse
  const short = parseAssessments('2026-07-01\tAcme\t-\teSkill\tExcel').rows;
  assert(short.length === 1 && short[0].score === null && short[0].staleNote === null, 'short row (5 cells) tolerated');

  // summarize
  const result = summarize(rows, malformed);
  assert(result.quality.total === 5, 'total 5');
  assert(result.quality.staleFlagged === 2, `2 stale-flagged, got ${result.quality.staleFlagged}`);
  assert(result.quality.withoutScore === 1 && result.quality.withoutThreshold === 2, 'missing-field counts');
  assert(result.quality.malformedLines.length === 1, 'malformed line surfaced in quality');
  const eskill = result.aggregates.byPlatform['eSkill'];
  assert(eskill.count === 2 && eskill.staleFlagged === 2 && eskill.passed === 2, 'eSkill: 2 events, both stale-flagged, both passed');
  const criteria = result.aggregates.byPlatform['Criteria'];
  assert(criteria.failed === 1 && criteria.passed === 0, 'Criteria: score below threshold -> failed');
  // lone score with hidden threshold must NOT count as passed
  const hr = result.aggregates.byPlatform['HackerRank'];
  assert(hr.passed === 0 && hr.unknownOutcome === 1, 'hidden threshold -> unknown outcome, not a pass');
  const pi = result.aggregates.byPlatform['Predictive Index'];
  assert(pi.unknownOutcome === 1, 'no threshold + no score -> unknown outcome');

  // buildRow
  const row = buildRow({ company: 'Acme', report: '042', platform: 'eSkill', subject: 'MS Office', threshold: '70', score: '92', stale: 'Acrobat 9' }, '2026-07-07');
  assert(row === '2026-07-07\tAcme\t042\teSkill\tMS Office\t70\t92\tAcrobat 9', 'full row built');
  const minimal = buildRow({ company: 'Acme', platform: 'eSkill', subject: 'Excel' }, '2026-07-07');
  assert(minimal === '2026-07-07\tAcme\t-\teSkill\tExcel\t-\t-\t', 'optional fields default to -/empty');
  // round-trip: built rows must parse back losslessly
  const rt = parseAssessments(row + '\n' + minimal).rows;
  assert(rt.length === 2 && rt[0].score === 92 && rt[1].threshold === null, 'built rows round-trip through parser');
  const throws = (fields, frag) => {
    try { buildRow(fields, '2026-07-07'); return false; } catch (e) { return e.message.includes(frag); }
  };
  assert(throws({ platform: 'eSkill', subject: 'Excel' }, '--company is required'), 'missing company rejected');
  assert(throws({ company: 'Acme', platform: 'eSkill', subject: 'Excel', threshold: 'high' }, '--threshold must be a percentage'), 'prose threshold rejected');
  assert(throws({ company: 'A\tcme', platform: 'eSkill', subject: 'Excel' }, 'tabs'), 'embedded tab rejected');

  console.log('assessment-log self-test OK (pct parser + TSV parser + aggregation + row builder)');
}

// --- Output ---
function printSummary(result) {
  const { aggregates, quality, assessments } = result;
  console.log('\nSKILLS ASSESSMENTS — per-application events\n');

  if (!assessments.length) {
    console.log('  No assessments logged yet.');
    console.log('  Log one: node assessment-log.mjs add --company <name> --platform <vendor> --subject <topic>');
  } else {
    console.log('  Events:');
    for (const a of assessments) {
      const ref = a.reportNum ? ` (#${a.reportNum})` : '';
      const outcome = a.threshold !== null && a.score !== null
        ? `${a.score}% vs threshold ${a.threshold}% — ${a.score >= a.threshold ? 'passed' : 'failed'}`
        : [a.score !== null ? `score ${a.score}%` : null, a.threshold !== null ? `threshold ${a.threshold}%` : null].filter(Boolean).join(', ') || 'no score/threshold reported';
      console.log(`  ${a.date} ${a.company}${ref} — ${a.platform}: ${a.subject}`);
      console.log(`      ${outcome}`);
      if (a.staleNote) console.log(`      ⚠ stale: ${a.staleNote}`);
    }
    console.log('\n  By platform:');
    for (const [platform, agg] of Object.entries(aggregates.byPlatform)) {
      const stale = agg.staleFlagged ? `, ${agg.staleFlagged} stale-flagged` : '';
      console.log(`  ${platform}: ${agg.count} event${agg.count === 1 ? '' : 's'} (${agg.passed} passed, ${agg.failed} failed, ${agg.unknownOutcome} unknown${stale})`);
    }
  }

  console.log('\n  Data quality:');
  console.log(`  stale-flagged (candidate-observed): ${quality.staleFlagged} of ${quality.total}`);
  console.log(`  without score: ${quality.withoutScore}, without threshold: ${quality.withoutThreshold}`);
  if (quality.malformedLines.length) {
    console.log(`  ⚠ ${quality.malformedLines.length} malformed line${quality.malformedLines.length === 1 ? '' : 's'} skipped (need date, company, platform, subject):`);
    for (const m of quality.malformedLines) console.log(`      "${m.line}"`);
  } else {
    console.log('  malformed lines: none');
  }
  console.log('');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) { selfTest(); return; }
  if (args[0] === 'add') { addEntry(args.slice(1)); return; }

  const content = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf-8') : '';
  const { rows, malformed } = parseAssessments(content);
  const result = summarize(rows, malformed);

  if (args.includes('--summary')) {
    printSummary(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
