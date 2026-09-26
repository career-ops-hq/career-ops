// tests/localized-tracker-tsv-templates.test.mjs — every mode prompt that
// dictates a tracker-addition row must dictate the form ingestion can actually
// read: a header row of column labels, a `url` column, and one data row (#3702).
//
// Why a test and not a review note. Headerless additions stay valid forever
// (AGENTS.md keeps the legacy path), so a stale localized template never goes
// red on its own — it just keeps that market on the content-sniffing path,
// where `—` is both a score sentinel (#1799) and a status meaning Discarded, so
// a discarded, never-scored row is undecidable and skipped. The missing `url`
// is quieter still: it drops the row out of the deterministic dedup key (#1298)
// and never warns at all. Neither failure surfaces anywhere except here.
//
// DISCOVERY IS FAIL-LOUD BY DESIGN. The first survey of #3702 found four of the
// five affected files, because it matched on the `{num}\t…` template shape and
// one file dictates its row as a prose field list instead — a pattern that
// silently drops what it does not recognize turned "I could not read it" into
// "it does not exist". So this suite uses two independent recognizers, asserts
// the known-affected files are all still seen, and FAILS on a tab-shaped block
// it cannot classify rather than passing over it.
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, relative } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { isNestedCheckout } from '../lib/mjs-files.mjs';
import { pass, fail, NODE, ROOT } from './helpers.mjs';

console.log('\nLocalized tracker-addition templates (#3702)');

const MODES = join(ROOT, 'modes');
const ALIASES = JSON.parse(readFileSync(join(ROOT, 'tracker-aliases.json'), 'utf-8'));

// The files #3702 catalogued as showing a concrete row. A tripwire, not the
// input: discovery below runs over all of modes/, and this set only asserts it
// never silently narrows again.
//
// `modes/ru/oferta.md` was the fifth and is deliberately NOT here any more.
// Removing an entry from a narrowing tripwire is the exact move it exists to
// prevent, so the reason is recorded rather than assumed: #3830 re-synced that
// file to the canonical A–H structure, and the canonical structure — English
// `modes/oferta.md` — dictates no TSV row at all. It lists the fields in prose
// and defers the row shape to AGENTS.md and rule 9 of `_shared.md`. The
// re-synced file no longer contains the string `batch/tracker-additions/`, so
// it is not merely unrecognized, it is genuinely out of this suite's scope.
// That is a better end state than #3702 asked for: one canonical spec instead
// of a sixth copy that can drift. If a row template ever returns to that file,
// discovery picks it up again and the full contract below applies to it.
const KNOWN_TEMPLATE_FILES = [
  'modes/ko/gonggo.md',
  'modes/nl/vacature.md',
  'modes/tr/is-ilani.md',
  'modes/ua/oferta.md',
];

// Column labels a header must carry before merge-tracker can resolve a row by
// name; mirrors TSV_REQUIRED_FIELDS in tracker-parse.mjs.
const REQUIRED = ['num', 'date', 'company', 'role', 'score', 'status', 'pdf', 'report'];

/** Cells of one template line: real tabs, or the literal two-character `\t`. */
const cells = (line) => line.split(/\t|\\t/).map((s) => s.trim());
const fieldOf = (label) => ALIASES[String(label ?? '').trim().toLowerCase()];

// Fields that only a tracker row has. `batch-state.tsv` also labels columns
// `url`, `status` and `score`, so "resolves three labels" alone is not enough
// to call a block a tracker addition. A block that resolves labels but names
// none of these is reported as a near-miss below rather than silently dropped.
const TRACKER_ONLY = ['num', 'company', 'role', 'report', 'pdf'];

/** Which recognized fields does this line's cells resolve to? */
function labelsOf(line) {
  const c = cells(line);
  if (c.length < 6) return null;
  const keys = new Set(c.map(fieldOf).filter(Boolean));
  return keys.size >= 3 ? keys : null;
}

/** Does this line read as a row of column LABELS for a TRACKER addition? */
function isLabelRow(line) {
  const keys = labelsOf(line);
  return !!keys && TRACKER_ONLY.some((k) => keys.has(k));
}

/** Does this line read as a row of VALUES (placeholders and/or literals)? */
function isDataRow(line) {
  const c = cells(line);
  return c.length >= 6 && /\{[^}]+\}/.test(line) && !isLabelRow(line);
}

/** Every ```fenced``` block of a markdown file, with its 1-based start line. */
function fences(text) {
  const out = [];
  const lines = text.split('\n');
  let open = null;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      if (open === null) open = { start: i + 2, body: [] };
      else { out.push({ start: open.start, lines: open.body }); open = null; }
      return;
    }
    if (open) open.body.push(line);
  });
  return out;
}

// ---- Discovery -------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      // A checkout placed under modes/ is another tree's content, and its mode
      // files are not this repository's to hold to this contract (#3681/#3762).
      if (isNestedCheckout(full)) continue;
      out.push(...walk(full));
    } else if (e.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

const dictating = [];   // files that show a concrete row
const unreadable = [];  // tab-shaped blocks no recognizer could classify
const nearMisses = [];  // labelled blocks that are some other .tsv, set aside

for (const abs of walk(MODES)) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  const text = readFileSync(abs, 'utf-8');
  if (!text.includes('batch/tracker-additions/')) continue;

  for (const fence of fences(text)) {
    const labels = fence.lines.filter(isLabelRow);
    const data = fence.lines.filter(isDataRow);
    if (labels.length || data.length) {
      dictating.push({ rel, abs, text, fence, labels, data });
      continue;
    }
    // A labelled block that names no tracker-only field is some OTHER tsv
    // (batch-state.tsv, the discard log). Set aside, but named in the output so
    // the exclusion is visible rather than a silent narrowing of scope.
    const nearMiss = fence.lines.find((l) => labelsOf(l));
    if (nearMiss) { nearMisses.push({ rel, line: fence.start, sample: nearMiss.trim().slice(0, 70) }); continue; }
    // Neither recognizer fired, but the block is tab-shaped and sits in a file
    // about tracker additions — exactly the case that must not pass silently.
    const tabbed = fence.lines.filter((l) => /\t|\\t/.test(l) && l.trim());
    if (tabbed.length) unreadable.push({ rel, line: fence.start, sample: tabbed[0].slice(0, 90) });
  }
}

for (const n of nearMisses) {
  console.log(`  ℹ️  ${n.rel}:${n.line} — labelled block set aside as a non-tracker .tsv: "${n.sample}"`);
}

if (unreadable.length) {
  for (const u of unreadable) {
    fail(`${u.rel}:${u.line} — tab-separated block in a tracker-additions file that neither recognizer could classify: "${u.sample}". Classify it (teach the recognizer, or reword the block) rather than leaving it unread`);
  }
} else {
  pass('every tab-shaped block in a tracker-additions mode file was classifiable');
}

const seen = new Set(dictating.map((d) => d.rel));
const missed = KNOWN_TEMPLATE_FILES.filter((f) => !seen.has(f));
if (missed.length) {
  fail(`discovery narrowed: #3702 catalogued a row template in ${missed.join(', ')} and this run did not see it`);
} else {
  pass(`discovery sees all ${KNOWN_TEMPLATE_FILES.length} known template files under modes/ (${seen.size} total)`);
}

// ---- Per-file contract -----------------------------------------------------

// Prose that only made sense before the header: a fixed column count, or the
// score/status order restated as a fact about the format. Under a header the
// order carries no meaning, so restating it is what goes stale next (#3702).
const STALE_PROSE = [
  { re: /\b8\s*(?:or|veya|или|або|of|oder|ou|o|nebo|veya)\s*9\b/i, why: 'a fixed column count' },
  { re: /status\s*(?:before|önce|перед|voor|vóór|前)\s*score/i, why: 'the "status before score" framing' },
  // True of the PARSER, unsafe as instruction to an emitter: it licenses
  // reordering one line and not the other, and the resulting company/role swap
  // is undetectable (#3813 review).
  { re: /(?:порядок колонок (?:значення не має|роли не играет)|sütun sırası önemsizdir|kolomvolgorde doet er niet toe|컬럼 순서는 의미가 없)/i, why: 'that the column order carries no meaning' },
];

for (const rel of [...seen].sort()) {
  const entries = dictating.filter((d) => d.rel === rel);
  const entry = entries[0];

  // 1. Header row present, and a data row under it.
  const withBoth = entries.find((e) => e.labels.length && e.data.length);
  if (!withBoth) {
    fail(`${rel}: the tracker-addition template shows ${entry.labels.length ? 'labels but no data row' : 'a data row with no header row of column labels'} — write both lines (#3702)`);
    continue;
  }
  const header = cells(withBoth.labels[0]);
  const row = cells(withBoth.data[0]);

  // 2. The header resolves, carries every required field, and repeats none.
  const map = {};
  const dupes = [];
  const unknown = [];
  header.forEach((label, i) => {
    const key = fieldOf(label);
    if (!key) { unknown.push(label); return; }
    if (map[key] != null) { dupes.push(key); return; }
    map[key] = i;
  });
  const missing = REQUIRED.filter((k) => map[k] == null);
  if (missing.length || dupes.length || unknown.length) {
    fail(`${rel}: header row [${header.join(' ')}] is not resolvable — ${[
      missing.length ? `missing ${missing.join(', ')}` : '',
      dupes.length ? `repeats ${dupes.join(', ')}` : '',
      unknown.length ? `unrecognized label(s) ${unknown.join(', ')} (labels must be the English names in tracker-aliases.json)` : '',
    ].filter(Boolean).join('; ')}`);
    continue;
  }

  // 3. The `url` column — the deterministic dedup key (#1298). Without it every
  //    evaluation from this market falls to the fuzzy company+role tier, and
  //    unlike the score/status case nothing warns.
  if (map.url == null) {
    fail(`${rel}: header has no \`url\` column — rows from this market never reach the deterministic dedup key`);
    continue;
  }
  pass(`${rel}: header row resolves, carries url, and has a data row under it`);

  // 4. Header and data row describe the same width. A data row one cell short
  //    slides every optional value a column left of its label.
  if (row.length !== header.length) {
    fail(`${rel}: header declares ${header.length} columns but the data row has ${row.length}`);
  } else {
    pass(`${rel}: header and data row are both ${header.length} columns`);
  }

  // 5. The data row must be in the SAME order as its header. Name resolution
  //    maps a label to a POSITION and then reads that position from the data
  //    row, so labels and values only agree while both lines are written
  //    together. Reorder one line and not the other and `company`/`role` swap
  //    silently: both are free text, so the score-corroboration gate in
  //    merge-tracker (which catches a reorder that displaces `score`) cannot
  //    see it. Checked on the cells whose field is identifiable from content.
  const identify = (cell) => {
    const c = cell.trim();
    if (/\]\(reports\//.test(c)) return 'report';
    if (/^\{url\}$/i.test(c) || /^https?:\/\//i.test(c)) return 'url';
    if (/^\{num\}$/i.test(c)) return 'num';
    if (/^\{(date|datum|fecha|data)\}$/i.test(c)) return 'date';
    if (/^\{score\}(\/5)?$/i.test(c)) return 'score';
    if (/^\{pdf(_emoji)?\}$/i.test(c)) return 'pdf';
    if (/^\{status\}$/i.test(c) || /^(Evaluated|Applied|Responded|Interview|Offer|Hired|Rejected|Discarded|SKIP)$/.test(c)) return 'status';
    // company and role matter MOST here and are the hardest to catch any other
    // way: both are free text, so nothing downstream can tell a swap of the two
    // from a legitimate row. Each market names them in its own language, so the
    // placeholder vocabulary is listed rather than pattern-matched.
    if (/^\{(company|bedrijf|empresa|sirket|şirket|firma|会社|회사)\}$/i.test(c)) return 'company';
    if (/^\{(role|rol|rolle|puesto|poste|cargo|pozisyon|직무)\}$/i.test(c)) return 'role';
    if (/^\{(note|notes|notitie|nota|notiz|not|메모)\}$/i.test(c)) return 'notes';
    return null;
  };
  const misaligned = row
    .map((cell, i) => ({ i, cell, want: identify(cell) }))
    .filter(({ i, want }) => want && map[want] !== i);
  if (misaligned.length) {
    for (const { i, cell, want } of misaligned) {
      const labelHere = header[i] ?? '(none)';
      fail(`${rel}: data-row cell ${i + 1} is "${cell}" (a ${want} value) but the header labels that position "${labelHere}" — the two lines are not in the same order`);
    }
  } else {
    pass(`${rel}: data row is in header order on every identifiable cell`);
  }

  // 6. A literal (non-placeholder) status cell must be canonical.
  const statusCell = row[map.status] ?? '';
  if (statusCell && !/\{/.test(statusCell) && !/^(Evaluated|Applied|Responded|Interview|Offer|Hired|Rejected|Discarded|SKIP)$/.test(statusCell)) {
    fail(`${rel}: the data row's literal status cell is "${statusCell}", which is not a canonical state (templates/states.yml)`);
  }

  // 7. No prose that the header made wrong.
  for (const { re, why } of STALE_PROSE) {
    const hit = entry.text.split('\n').findIndex((l) => re.test(l));
    if (hit >= 0) fail(`${rel}:${hit + 1} still states ${why} — under a header the column order is not a fact about the format`);
  }
}

// ---- End to end: the dictated shape must actually merge ---------------------
//
// The static checks above describe the contract; this one asks merge-tracker.
// If it fails while the header rows above are well-formed, the ingestion side
// of #3517 (PR #3706) is not in this tree — headed additions are refused there,
// so these prompts and this repo's parser disagree.

const VALUES = {
  num: '901',
  date: '2026-09-04',
  company: 'Acme GmbH',
  role: 'Staff AI Engineer',
  status: 'Evaluated',
  score: '4.2/5',
  pdf: '❌',
  report: '[901](reports/901-acme-gmbh-2026-09-04.md)',
  notes: 'end-to-end check',
  url: 'https://boards.greenhouse.io/acme/jobs/901',
};

const TRACKER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|-----|',
  '',
].join('\n');

for (const rel of [...seen].sort()) {
  const entry = dictating.filter((d) => d.rel === rel).find((e) => e.labels.length && e.data.length);
  if (!entry) continue;
  const header = cells(entry.labels[0]);
  // Render from the file's OWN header: whatever order it labels its columns in
  // is the order the row is built in, which is the property being tested.
  const data = header.map((label) => VALUES[fieldOf(label)] ?? '');

  const work = mkdtempSync(join(tmpdir(), 'cops-i18n-tsv-'));
  try {
    const tracker = join(work, 'applications.md');
    const adds = join(work, 'adds');
    mkdirSync(adds, { recursive: true });
    writeFileSync(tracker, TRACKER);
    writeFileSync(join(adds, '901-acme-gmbh.tsv'), `${header.join('\t')}\n${data.join('\t')}\n`);

    let out = '';
    try {
      out = execFileSync(NODE, [join(ROOT, 'merge-tracker.mjs')], {
        encoding: 'utf-8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CAREER_OPS_TRACKER: tracker, CAREER_OPS_ADDITIONS: adds },
      });
    } catch (e) { out = String(e.stdout ?? '') + String(e.stderr ?? ''); }

    const merged = readFileSync(tracker, 'utf-8');
    const line = merged.split('\n').find((l) => /^\|\s*901\s*\|/.test(l));
    if (line && /Acme GmbH/.test(line) && /4\.2\/5/.test(line) && /Evaluated/.test(line) && /greenhouse\.io\/acme\/jobs\/901/.test(line)) {
      pass(`${rel}: the dictated row merges, with the posting URL kept as the dedup key`);
    } else {
      fail(`${rel}: the dictated row did NOT merge — if the header checks above passed, headed-addition ingestion (#3517, PR #3706) is missing from this tree. merge output: ${out.trim().split('\n').slice(-2).join(' | ') || '(none)'} | row: ${line ?? '(none)'}`);
    }
  } finally {
    try { rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* best effort */ }
  }
}
