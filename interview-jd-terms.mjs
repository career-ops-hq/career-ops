#!/usr/bin/env node

/**
 * interview-jd-terms.mjs — which words do the postings that reached an
 * interview share, that your content_filter.positive does not list yet?
 *
 * Zero-LLM, read-only, deterministic. Advisory only: it never edits
 * portals.yml or any other file.
 *
 * Two groups of tracker rows, split with the same stage recovery that stats.mjs
 * and analyze-patterns.mjs use (funnel-stages.mjs), so a row rejected AFTER an
 * interview still counts as having reached one:
 *
 *   positives  reached Interview or higher
 *   baseline   reached Applied / Responded / Assessment, never Interview
 *
 * For each row the archived job description is read: the report's
 * "## Job Description (archived verbatim)" section, else a text capture in
 * jds/ resolved by report number (jd-capture.mjs). Rows with no readable JD
 * are counted and reported, never guessed at.
 *
 * Terms are single words and word pairs (document frequency: a term counts once
 * per JD) plus the canonical skills skill-extract.mjs recognises. Each term gets
 * a smoothed log2 lift:
 *
 *   lift = log2( ((pos + 1) / (P + 2)) / ((base + 1) / (B + 2)) )
 *
 * where pos/base are the documents containing the term and P/B the group sizes
 * (Laplace smoothing, so a term seen in no baseline JD does not divide by zero).
 *
 * A minimum-support guard applies: below MIN_POSITIVE positive or MIN_BASELINE
 * baseline documents only the counts are printed, no ratios, the way
 * analyze-patterns.mjs does. Terms already covered by content_filter.positive
 * are left out of the suggestions; a separate list shows the commonest terms
 * overall so boilerplate is visible.
 *
 * Usage:
 *   node interview-jd-terms.mjs              markdown report
 *   node interview-jd-terms.mjs --json       JSON
 *   node interview-jd-terms.mjs --top 40     how many suggestions to list
 *   node interview-jd-terms.mjs --self-test  built-in check on synthetic data
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';
import { resolveColumns, parseTrackerRow, extractTrackerReportNumbers } from './tracker-parse.mjs';
import { normalizeStatus } from './followup-cadence.mjs';
import { parseStatusLogStages, recoverFunnelStages } from './funnel-stages.mjs';
import { findCaptureForReport } from './jd-capture.mjs';
import { extractSkills } from './skill-extract.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags, flagValue, hasFlag, safeIntFlag } from './lib/cli-flags.mjs';

export const MIN_POSITIVE = 8;
export const MIN_BASELINE = 20;
/** A suggested term must appear in at least this many interview JDs. */
export const MIN_TERM_POSITIVE = 3;
export const DEFAULT_TOP = 25;
const COMMON_TOP = 15;

const JD_HEADING = /^##[ \t]+Job Description \(archived verbatim\)[ \t]*$/im;
const MIN_JD_CHARS = 40;
const TEXT_CAPTURE_EXTS = new Set(['.md', '.txt']);

const KNOWN_FLAGS = ['--json', '--top', '--self-test', '--help', '-h'];
const USAGE = `interview-jd-terms.mjs — terms from the JDs of postings that reached an interview

  node interview-jd-terms.mjs              markdown report
  node interview-jd-terms.mjs --json       JSON
  node interview-jd-terms.mjs --top 40     number of suggested terms (default ${DEFAULT_TOP})
  node interview-jd-terms.mjs --self-test  run the built-in check, no user files read

Read-only and advisory: suggests content_filter.positive terms, never edits
portals.yml. Needs at least ${MIN_POSITIVE} interview and ${MIN_BASELINE} baseline JDs before it prints ratios.`;

// ── Term extraction ─────────────────────────────────────────────────

const STOP_WORDS = new Set((
  'a about above across after again against all also am an and any are as at be because been before being below ' +
  'between both but by can could did do does doing down during each either else etc few for from further had has ' +
  'have having he her here hers him his how however i if in into is it its itself just may me might more most must ' +
  'my no nor not now of off on once one only or other our ours out over own per same she should so some such than ' +
  'that the their theirs them then there these they this those through to too under until up upon us very via was ' +
  'we were what when where whether which while who whom why will with within without would you your yours ' +
  'able ability well new including include includes using use used get make like need needs want ' +
  'work working works role team teams join looking help helps ensure ensuring support supporting ' +
  'strong good great excellent plus preferred required requirements responsibilities qualifications ' +
  'experience years year day days time part full'
).split(/\s+/));

/** Recruiting boilerplate: kept out of the suggestions. */
const BOILERPLATE = new Set((
  'equal opportunity employer employers benefits salary insurance dental vision vacation holiday holidays ' +
  'diversity inclusive inclusion applicants applicant applicable candidate candidates race color ' +
  'gender sex religion orientation disability disabilities veteran veterans accommodation accommodations ' +
  'compensation range apply application applications resume cover letter privacy policy position positions ' +
  'job jobs company companies opportunities location locations remote hybrid onsite office offer offers ' +
  'perks paid pto'
).split(/\s+/));

function tokenize(sentence) {
  const out = [];
  for (const raw of sentence.match(/[a-z0-9][a-z0-9+#.-]*[a-z0-9+#]|[a-z0-9]/g) || []) {
    const t = raw.replace(/^[.-]+|[.-]+$/g, '');
    if (t) out.push(t);
  }
  return out;
}

/**
 * Remove HTML comments. Scans with indexOf instead of a regex replace, so a
 * nested or reassembled opener (`<!<!---->--`) cannot survive: the loop only
 * ends when no opener is left, and an unterminated comment drops the rest.
 */
export function stripHtmlComments(text, replacement = ' ') {
  let out = String(text ?? '');
  for (;;) {
    const start = out.indexOf('<!--');
    if (start === -1) return out;
    const end = out.indexOf('-->', start + 4);
    out = end === -1 ? out.slice(0, start) : out.slice(0, start) + replacement + out.slice(end + 3);
  }
}

const isNumeric = (t) => /^[\d.,-]+$/.test(t);
const usableWord = (t) => t.length >= 2 && !isNumeric(t) && !STOP_WORDS.has(t) && !BOILERPLATE.has(t);

/**
 * The terms in one JD, each counted once (document frequency).
 * Returns Map term -> kind ('word' | 'phrase' | 'skill').
 */
export function termsOf(text) {
  const terms = new Map();
  const uncommented = stripHtmlComments(text);
  const clean = uncommented
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[`*_>#|]/g, ' ')
    .toLowerCase();
  // Word pairs never span a sentence, line, comma or bracket.
  for (const sentence of clean.split(/[\n;:,()[\]{}"]+|[.!?]+(?=\s|$)/)) {
    const tokens = tokenize(sentence);
    for (let i = 0; i < tokens.length; i++) {
      const a = tokens[i];
      if (!usableWord(a)) continue;
      terms.set(a, 'word');
      const b = tokens[i + 1];
      if (b !== undefined && usableWord(b)) terms.set(`${a} ${b}`, 'phrase');
    }
  }
  for (const skill of extractSkills(uncommented)) terms.set(skill.toLowerCase(), 'skill');
  return terms;
}

/** True when `entry` appears in `term` as a whole-word sequence (or equals it). */
function coveredBy(term, entry) {
  const t = tokenize(term.toLowerCase());
  const e = tokenize(String(entry).toLowerCase());
  if (e.length === 0 || e.length > t.length) return false;
  for (let i = 0; i + e.length <= t.length; i++) {
    if (e.every((w, j) => t[i + j] === w)) return true;
  }
  return false;
}

// ── Row classification and JD resolution ────────────────────────────

/**
 * Split tracker rows into interview positives and applied-but-no-interview
 * baseline. Pure: takes file contents.
 *
 * @returns {{positives: object[], baseline: object[]}} rows are {num, reportNums}
 */
export function classifyRows(trackerContent, statusLogContent = '') {
  const lines = String(trackerContent ?? '').replace(/\r/g, '').split('\n');
  const colmap = resolveColumns(lines);
  const rows = new Map();
  const statusByNum = new Map();
  for (const line of lines) {
    const row = parseTrackerRow(line, colmap);
    if (!row || rows.has(row.num)) continue;
    rows.set(row.num, row);
    statusByNum.set(row.num, normalizeStatus(String(row.status ?? '')));
  }
  const reached = recoverFunnelStages(statusByNum, parseStatusLogStages(statusLogContent));
  const positives = [];
  const baseline = [];
  for (const [num, row] of rows) {
    const rank = reached.get(num) || 0;
    // Only an unambiguous report link is followed: two different numbers in
    // one row mean the link is inconsistent, and guessing could read another
    // posting's JD.
    const linked = extractTrackerReportNumbers(row.report, row.notes);
    const entry = { num, reportNums: linked.length === 1 ? linked : [] };
    if (rank >= 4) positives.push(entry);
    else if (rank >= 1) baseline.push(entry);
  }
  return { positives, baseline };
}

/** Text of the archived-JD section of a report, or '' when absent or a placeholder. */
export function jdFromReport(reportText) {
  const text = String(reportText ?? '').replace(/\r/g, '');
  const m = JD_HEADING.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = rest.search(/^##[ \t]/m);
  const body = stripHtmlComments(next === -1 ? rest : rest.slice(0, next), '').trim();
  return body.length >= MIN_JD_CHARS ? body : '';
}

/**
 * Find the JD text for one row: report section first, then a text capture in
 * jds/ by report number. A capture that is not text (PDF) is not read and is
 * flagged with pdfOnly.
 */
export function resolveJd(root, reportNums) {
  const reportsDir = join(root, 'reports');
  const jdsDir = join(root, 'jds');
  let pdfOnly = false;
  for (const n of reportNums) {
    if (existsSync(reportsDir)) {
      for (const name of readdirSync(reportsDir).sort()) {
        const m = /^(\d+)-.*\.md$/.exec(name);
        if (!m || Number(m[1]) !== n) continue;
        let jd = '';
        try {
          jd = jdFromReport(readFileSync(join(reportsDir, name), 'utf-8'));
        } catch { /* unreadable report: try the next source, never stop the run */ }
        if (jd) return { text: jd, source: 'report' };
      }
    }
    // Captures: take the newest readable text capture, not just the newest file.
    // A PDF that is newer than a valid .txt must not hide the text JD.
    const cap = findCaptureForReport(jdsDir, n);
    if (cap) {
      let sawPdf = false;
      let found = null;
      for (const filename of cap.candidates ?? [cap.filename]) {
        const dot = filename.lastIndexOf('.');
        const ext = dot === -1 ? '' : filename.slice(dot).toLowerCase();
        if (!TEXT_CAPTURE_EXTS.has(ext)) { sawPdf = true; continue; }
        try {
          const text = readFileSync(join(jdsDir, filename), 'utf-8').trim();
          if (text.length >= MIN_JD_CHARS) { found = text; break; }
        } catch { /* unreadable capture: try the next candidate */ }
      }
      if (found) return { text: found, source: 'capture' };
      if (sawPdf) pdfOnly = true;
    }
  }
  return { text: '', source: null, pdfOnly };
}

// ── Statistics ──────────────────────────────────────────────────────

export function smoothedLog2Lift(pos, base, P, B) {
  return Math.log2(((pos + 1) / (P + 2)) / ((base + 1) / (B + 2)));
}

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Rank terms. Pure: takes two arrays of JD texts and the current
 * content_filter.positive list. Below the minimum-support guard it returns the
 * document counts only.
 */
export function rankTerms(positiveTexts, baselineTexts, existingPositive = [], { top = DEFAULT_TOP } = {}) {
  const P = positiveTexts.length;
  const B = baselineTexts.length;
  const base = { positiveDocs: P, baselineDocs: B, minPositive: MIN_POSITIVE, minBaseline: MIN_BASELINE };
  if (P < MIN_POSITIVE || B < MIN_BASELINE) {
    return { ...base, sufficient: false, suggestions: null, common: null, excludedAlreadyCovered: null };
  }

  const df = new Map(); // term -> {kind, pos, base}
  const tally = (texts, field) => {
    for (const text of texts) {
      for (const [term, kind] of termsOf(text)) {
        let s = df.get(term);
        if (!s) { s = { term, kind, pos: 0, base: 0 }; df.set(term, s); }
        if (kind === 'skill') s.kind = 'skill';
        s[field]++;
      }
    }
  };
  tally(positiveTexts, 'pos');
  tally(baselineTexts, 'base');

  const existing = (Array.isArray(existingPositive) ? existingPositive : [])
    .filter((e) => typeof e === 'string' && e.trim());
  let excluded = 0;
  const candidates = [];
  for (const s of df.values()) {
    if (s.pos < MIN_TERM_POSITIVE) continue;
    if (existing.some((e) => coveredBy(s.term, e))) { excluded++; continue; }
    const lift = smoothedLog2Lift(s.pos, s.base, P, B);
    if (lift <= 0) continue;
    candidates.push({
      term: s.term,
      kind: s.kind,
      positiveDocs: s.pos,
      baselineDocs: s.base,
      lift: r2(lift),
    });
  }
  candidates.sort((a, b) => b.lift - a.lift || b.positiveDocs - a.positiveDocs || a.term.localeCompare(b.term));

  const common = [...df.values()]
    .map((s) => ({ term: s.term, docs: s.pos + s.base, share: r2((s.pos + s.base) / (P + B)) }))
    .sort((a, b) => b.docs - a.docs || a.term.localeCompare(b.term))
    .slice(0, COMMON_TOP);

  return { ...base, sufficient: true, suggestions: candidates.slice(0, top), common, excludedAlreadyCovered: excluded };
}

const CAVEATS = [
  'Small samples: a handful of interviews can make any word look predictive. Treat lift as a hint to read the JDs, not as evidence.',
  'Selection bias: you chose which postings to apply to, and employers chose whom to interview. Terms may reflect your own targeting or their screening, not what makes a posting good.',
  'The baseline matters: lift compares interview JDs with the applied-but-no-interview JDs you have. A different baseline gives different terms.',
  'Advisory only: nothing is written to portals.yml. Check each suggestion against your own targeting before adding it.',
];

/**
 * Whole analysis from file contents plus a JD reader. Pure apart from `readJd`.
 *
 * @param {object} input
 * @param {string} input.trackerContent
 * @param {string} [input.statusLogContent]
 * @param {string[]} [input.existingPositive] content_filter.positive
 * @param {(reportNums:number[]) => {text:string, source:string|null, pdfOnly?:boolean}} input.readJd
 */
export function analyze({ trackerContent, statusLogContent = '', existingPositive = [], readJd }, { top = DEFAULT_TOP } = {}) {
  const { positives, baseline } = classifyRows(trackerContent, statusLogContent);
  const gather = (rows) => {
    const texts = [];
    const stat = { rows: rows.length, fromReport: 0, fromCapture: 0, noJd: 0, pdfCaptureOnly: 0 };
    for (const r of rows) {
      const jd = readJd(r.reportNums);
      if (jd.text) {
        texts.push(jd.text);
        if (jd.source === 'capture') stat.fromCapture++;
        else stat.fromReport++;
      } else {
        stat.noJd++;
        if (jd.pdfOnly) stat.pdfCaptureOnly++;
      }
    }
    return { texts, stat };
  };
  const pos = gather(positives);
  const base = gather(baseline);
  return {
    rows: { positives: pos.stat, baseline: base.stat },
    ...rankTerms(pos.texts, base.texts, existingPositive, { top }),
    caveats: CAVEATS,
  };
}

// ── Output ──────────────────────────────────────────────────────────

export function renderMarkdown(result) {
  const out = [];
  const { positives, baseline } = result.rows;
  out.push('# Interview JD term suggestions', '');
  out.push(`- Interview rows: ${positives.rows} (${positives.fromReport} JD from report, ${positives.fromCapture} from a jds/ capture, ${positives.noJd} with no readable JD)`);
  out.push(`- Baseline rows (applied, no interview): ${baseline.rows} (${baseline.fromReport} from report, ${baseline.fromCapture} from capture, ${baseline.noJd} with no readable JD)`);
  const pdfOnly = positives.pdfCaptureOnly + baseline.pdfCaptureOnly;
  if (pdfOnly) out.push(`- ${pdfOnly} row(s) have only a non-text (PDF) capture, which is not read.`);
  out.push(`- Documents used: ${result.positiveDocs} interview, ${result.baselineDocs} baseline.`, '');

  if (!result.sufficient) {
    out.push(`Not enough data for ratios: needs at least ${result.minPositive} interview and ${result.minBaseline} baseline JDs. Counts only, no suggestions.`, '');
  } else {
    out.push('## Suggested terms not in content_filter.positive', '');
    if (result.suggestions.length === 0) {
      out.push('None cleared the bar.', '');
    } else {
      out.push('| Term | Lift (log2) | Interview JDs | Baseline JDs |', '|---|---|---|---|');
      for (const s of result.suggestions) {
        out.push(`| ${s.term} | ${s.lift} | ${s.positiveDocs}/${result.positiveDocs} | ${s.baselineDocs}/${result.baselineDocs} |`);
      }
      out.push('');
    }
    out.push(`${result.excludedAlreadyCovered} candidate term(s) skipped because content_filter.positive already covers them.`, '');
    out.push('## Most common terms overall (boilerplate check)', '');
    out.push(result.common.map((c) => `${c.term} (${Math.round(c.share * 100)}%)`).join(', '), '');
  }
  out.push('## Caveats', '');
  for (const c of result.caveats) out.push(`- ${c}`);
  return out.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────

function loadExistingPositive(root) {
  const portalsPath = process.env.CAREER_OPS_PORTALS || join(root, 'portals.yml');
  if (!existsSync(portalsPath)) return [];
  const cfg = loadYaml(readFileSync(portalsPath, 'utf-8')) || {};
  const list = cfg?.content_filter?.positive;
  return Array.isArray(list) ? list : [];
}

/** Read the user's files (read-only) and analyse them. */
export function analyzeRoot(root, opts = {}) {
  const trackerPath = resolveTrackerPath(root);
  const trackerContent = existsSync(trackerPath) ? readFileSync(trackerPath, 'utf-8') : '';
  const logPath = join(dirname(trackerPath), 'status-log.tsv');
  const statusLogContent = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
  return analyze({
    trackerContent,
    statusLogContent,
    existingPositive: loadExistingPositive(root),
    readJd: (nums) => resolveJd(root, nums),
  }, opts);
}

/** Built-in check on synthetic in-memory data; reads no user files. */
function selfTest() {
  const doc = (i, extra) => `Example Corp posting ${i}. ${extra} You will build things with the team.`;
  const pos = Array.from({ length: MIN_POSITIVE }, (_, i) => doc(i, 'Requires kubernetes and sql.'));
  const base = Array.from({ length: MIN_BASELINE }, (_, i) => doc(i, i < 2 ? 'Requires kubernetes.' : 'Requires sql.'));
  const r = rankTerms(pos, base, ['sql']);
  const checks = [
    ['sufficient with enough documents', r.sufficient === true],
    ['kubernetes is suggested', r.suggestions?.some((s) => s.term === 'kubernetes')],
    ['sql is already covered and left out', !r.suggestions?.some((s) => s.term === 'sql')],
    ['below the guard there are no ratios', rankTerms(pos.slice(0, 2), base, []).suggestions === null],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed++;
  }
  return failed === 0;
}

function main() {
  const args = process.argv.slice(2);
  validateFlags(args, KNOWN_FLAGS, USAGE, { valueFlags: ['--top'], requireOperand: true });
  if (hasFlag(args, '--self-test')) process.exit(selfTest() ? 0 : 1);
  const top = safeIntFlag(flagValue(args, '--top'), DEFAULT_TOP);
  const result = analyzeRoot(getCareerOpsRoot(), { top });
  console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : renderMarkdown(result));
}

if (isMainModule(import.meta.url)) main();
