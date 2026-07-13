/**
 * process-quality.test.mjs — Systematic test suite for process-quality.mjs
 *
 * Tests every exported function across:
 * - Markdown table parsing (well-formed, malformed, empty, header-only)
 * - Friction tag extraction (bare tag, tag with reason, no tag, case sensitivity)
 * - Aggregation (grouping, dedup, threshold filtering, sort order)
 * - CLI behavior (args, flags, missing file)
 *
 * Run: node process-quality.test.mjs
 */

import { parseActiveInterviews, extractFriction, aggregateProcessQuality } from './process-quality.mjs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

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

function table(rows) {
  const header = '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |';
  const sep = '|---------|------|-------|-----------|-------------|--------|-------|';
  return [header, sep, ...rows].join('\n');
}

// ============================================================================
// 1. parseActiveInterviews — input validation
// ============================================================================
console.log('\n--- 1. parseActiveInterviews input validation ---');

eq('null input -> empty', parseActiveInterviews(null), []);
eq('undefined input -> empty', parseActiveInterviews(undefined), []);
eq('empty string -> empty', parseActiveInterviews(''), []);
eq('whitespace-only -> empty', parseActiveInterviews('   \n  \n'), []);
eq('non-string input (number) -> empty', parseActiveInterviews(42), []);
eq('non-string input (object) -> empty', parseActiveInterviews({}), []);
eq('prose with no table -> empty', parseActiveInterviews('# Active Interviews\n\nNothing here yet.'), []);
eq('header only, no rows -> empty', parseActiveInterviews(table([])), []);

// ============================================================================
// 2. parseActiveInterviews — well-formed rows
// ============================================================================
console.log('\n--- 2. well-formed rows ---');

const basic = parseActiveInterviews(table([
  '| Acme | Backend Engineer | Prescreen | 2026-06-01 | Jane | Scheduled | Clean process |',
]));
eq('parses 1 row', basic.length, 1);
eq('row has Company field', basic[0].Company, 'Acme');
eq('row has Role field', basic[0].Role, 'Backend Engineer');
eq('row has Notes field', basic[0].Notes, 'Clean process');

const multi = parseActiveInterviews(table([
  '| Acme | Backend Engineer | Prescreen | 2026-06-01 | Jane | Scheduled | note 1 |',
  '| Beta | Coordinator | Round 1 | 2026-06-08 | HM | Scheduled | note 2 |',
]));
eq('parses 2 rows', multi.length, 2);

// ============================================================================
// 3. parseActiveInterviews — malformed / edge-case rows
// ============================================================================
console.log('\n--- 3. malformed rows ---');

const withMalformed = parseActiveInterviews(table([
  '| Acme | Backend Engineer | Prescreen | 2026-06-01 | Jane | Scheduled | ok |',
  '| Too | Few | Cells |',
  '| Beta | Coordinator | Round 1 | 2026-06-08 | HM | Scheduled | ok 2 |',
]));
eq('malformed (wrong column count) row is dropped, valid rows kept', withMalformed.length, 2);

const preambleAndTable = parseActiveInterviews(
  '# Active Interviews\n\nSome free text here.\n\n' + table([
    '| Acme | Backend Engineer | Prescreen | 2026-06-01 | Jane | Scheduled | ok |',
  ])
);
eq('non-table prose lines before the table are ignored', preambleAndTable.length, 1);

const noSeparator = parseActiveInterviews(
  '| Company | Role | Round | Date/Time | Interviewer | Status | Notes |\n' +
  '| Acme | Backend Engineer | Prescreen | 2026-06-01 | Jane | Scheduled | ok |'
);
ok('table without a separator row still parses the data row', noSeparator.length === 1);

// A second, unrelated markdown table later in the document must not be
// merged into the parsed rows — only the first contiguous table block is
// scoped as "the" table (CodeRabbit review, PR #1467).
const twoTables = parseActiveInterviews(
  table(['| Acme | Backend Engineer | Prescreen | 2026-06-01 | Jane | Scheduled | ok |']) +
  '\n\nSome unrelated section.\n\n' +
  '| Foo | Bar |\n|-----|-----|\n| unrelated | table |\n'
);
eq('second markdown table later in the document is not merged in', twoTables.length, 1);
ok('second-table columns (Foo/Bar) never leak into the result', !('Foo' in twoTables[0]));

// A blank-line gap between two table blocks still stops at the first block
// (blank lines are not pipe-formatted, so they naturally break contiguity).
const gappedTables = parseActiveInterviews(
  table(['| Acme | Backend Engineer | Prescreen | 2026-06-01 | Jane | Scheduled | ok |']) +
  '\n\n' +
  table(['| Beta | Coordinator | Round 1 | 2026-06-08 | HM | Scheduled | ok 2 |'])
);
eq('a gapped second table block is excluded, only first block parsed', gappedTables.length, 1);
eq('first block company preserved', gappedTables[0].Company, 'Acme');

// ============================================================================
// 4. extractFriction
// ============================================================================
console.log('\n--- 4. extractFriction ---');

eq('null row -> no friction', extractFriction(null), { hasFriction: false, reason: '' });
eq('undefined row -> no friction', extractFriction(undefined), { hasFriction: false, reason: '' });
eq('row with no Notes key -> no friction', extractFriction({ Company: 'Acme' }), { hasFriction: false, reason: '' });
eq('empty Notes -> no friction', extractFriction({ Notes: '' }), { hasFriction: false, reason: '' });
eq('Notes without tag -> no friction', extractFriction({ Notes: 'Everything went smoothly' }), { hasFriction: false, reason: '' });

eq('bare tag -> friction, no reason', extractFriction({ Notes: '[process-friction]' }), { hasFriction: true, reason: '' });
eq('tag with reason -> friction + reason', extractFriction({ Notes: '[process-friction: recruiter overrode stated availability]' }),
  { hasFriction: true, reason: 'recruiter overrode stated availability' });
eq('tag embedded mid-sentence', extractFriction({ Notes: 'Confirmed Wed 2pm. [process-friction: took 3 rounds to land a time] Prep done.' }),
  { hasFriction: true, reason: 'took 3 rounds to land a time' });
eq('tag is case-insensitive', extractFriction({ Notes: '[PROCESS-FRICTION: caps test]' }),
  { hasFriction: true, reason: 'caps test' });
eq('tag lookup is case-insensitive on the Notes key', extractFriction({ notes: '[process-friction: lowercase key]' }),
  { hasFriction: true, reason: 'lowercase key' });
eq('reason with internal whitespace is trimmed', extractFriction({ Notes: '[process-friction:   padded reason   ]' }),
  { hasFriction: true, reason: 'padded reason' });

// ============================================================================
// 5. aggregateProcessQuality — input validation
// ============================================================================
console.log('\n--- 5. aggregateProcessQuality input validation ---');

eq('null input -> empty', aggregateProcessQuality(null), []);
eq('undefined input -> empty', aggregateProcessQuality(undefined), []);
eq('empty array -> empty', aggregateProcessQuality([]), []);
eq('rows missing Company field are skipped', aggregateProcessQuality([{ Notes: 'x' }, null, undefined]), []);
eq('row with empty Company is skipped', aggregateProcessQuality([{ Company: '', Notes: 'x' }]), []);
eq('row with whitespace-only Company is skipped', aggregateProcessQuality([{ Company: '   ', Notes: 'x' }]), []);

// ============================================================================
// 6. aggregateProcessQuality — grouping and counting
// ============================================================================
console.log('\n--- 6. grouping and counting ---');

const rows = [
  { Company: 'Acme', Notes: 'no issue' },
  { Company: 'Acme', Notes: '[process-friction: reason A]' },
  { Company: 'acme', Notes: 'no issue either' }, // case-insensitive grouping
  { Company: 'Beta', Notes: '[process-friction]' },
];
const agg = aggregateProcessQuality(rows, 1);

const acmeSignal = agg.find(s => s.company.toLowerCase() === 'acme');
ok('Acme/acme grouped into a single entry', !!acmeSignal);
if (acmeSignal) {
  eq('Acme total interviews = 3 (case-insensitive dedup)', acmeSignal.totalInterviews, 3);
  eq('Acme friction count = 1', acmeSignal.frictionCount, 1);
  eq('Acme friction rate = 0.33', acmeSignal.frictionRate, 0.33);
  eq('Acme reasons = ["reason A"]', acmeSignal.reasons, ['reason A']);
}

const betaSignal = agg.find(s => s.company === 'Beta');
ok('Beta present', !!betaSignal);
if (betaSignal) {
  eq('Beta total interviews = 1', betaSignal.totalInterviews, 1);
  eq('Beta friction count = 1', betaSignal.frictionCount, 1);
  eq('Beta friction rate = 1', betaSignal.frictionRate, 1);
  eq('Beta reasons empty (bare tag)', betaSignal.reasons, []);
}

// Company name in output preserves the first-seen casing.
eq('output company name preserves first-seen casing', acmeSignal.company, 'Acme');

// ============================================================================
// 7. aggregateProcessQuality — threshold filtering
// ============================================================================
console.log('\n--- 7. threshold filtering ---');

const thresholdRows = [
  { Company: 'OneShot', Notes: '[process-friction]' },
  { Company: 'TwoShot', Notes: '[process-friction]' },
  { Company: 'TwoShot', Notes: 'fine' },
];

eq('threshold=1: both companies included', aggregateProcessQuality(thresholdRows, 1).map(s => s.company).sort(), ['OneShot', 'TwoShot']);
eq('threshold=2: only TwoShot included', aggregateProcessQuality(thresholdRows, 2).map(s => s.company), ['TwoShot']);
eq('threshold=3: neither included', aggregateProcessQuality(thresholdRows, 3), []);
eq('negative threshold falls back to 1', aggregateProcessQuality(thresholdRows, -5).map(s => s.company).sort(), ['OneShot', 'TwoShot']);
eq('non-numeric threshold falls back to 1', aggregateProcessQuality(thresholdRows, NaN).map(s => s.company).sort(), ['OneShot', 'TwoShot']);
eq('threshold=0: all companies included', aggregateProcessQuality(thresholdRows, 0).map(s => s.company).sort(), ['OneShot', 'TwoShot']);

// ============================================================================
// 8. aggregateProcessQuality — sort order
// ============================================================================
console.log('\n--- 8. sort order ---');

const sortRows = [
  { Company: 'LowFriction', Notes: '[process-friction]' },
  { Company: 'LowFriction', Notes: 'fine' },
  { Company: 'LowFriction', Notes: 'fine' },
  { Company: 'LowFriction', Notes: 'fine' },
  { Company: 'HighFriction', Notes: '[process-friction]' },
  { Company: 'HighFriction', Notes: '[process-friction]' },
  { Company: 'HighFriction', Notes: '[process-friction]' },
  { Company: 'NoFriction', Notes: 'fine' },
  { Company: 'AlphabeticalTieA', Notes: '[process-friction]' },
  { Company: 'AlphabeticalTieB', Notes: '[process-friction]' },
];
const sorted = aggregateProcessQuality(sortRows, 1);
eq('sorted by frictionCount descending first', sorted[0].company, 'HighFriction');
ok('NoFriction sorts last (frictionCount 0)', sorted[sorted.length - 1].company === 'NoFriction');

// Alphabetical tie-break when frictionCount and frictionRate are equal.
const tieIdxA = sorted.findIndex(s => s.company === 'AlphabeticalTieA');
const tieIdxB = sorted.findIndex(s => s.company === 'AlphabeticalTieB');
ok('alphabetical tie-break: TieA before TieB', tieIdxA < tieIdxB);

// ============================================================================
// 9. Integration — full markdown round-trip
// ============================================================================
console.log('\n--- 9. integration round-trip ---');

const fullMd = table([
  '| Sun Life | Regional Coordinator | Prescreen | 2026-07-08 | Sasha (bot) | Scheduled | [process-friction: stated availability overridden across multiple rounds] |',
  '| Sun Life | Digital Employee Experience | Prescreen | 2026-06-16 | Recruiter | Rejected | clean process |',
  '| Rentsync | Onboarding Specialist | Intro Call | 2026-06-25 | Evan | Scheduled | clean process |',
]);
const fullRows = parseActiveInterviews(fullMd);
const fullSignals = aggregateProcessQuality(fullRows, 1);

eq('round-trip: 3 rows parsed', fullRows.length, 3);
const sunLife = fullSignals.find(s => s.company === 'Sun Life');
ok('round-trip: Sun Life signal present', !!sunLife);
if (sunLife) {
  eq('round-trip: Sun Life total = 2', sunLife.totalInterviews, 2);
  eq('round-trip: Sun Life friction = 1', sunLife.frictionCount, 1);
  eq('round-trip: Sun Life reason captured', sunLife.reasons[0], 'stated availability overridden across multiple rounds');
}
const rentsync = fullSignals.find(s => s.company === 'Rentsync');
ok('round-trip: Rentsync signal present', !!rentsync);
if (rentsync) {
  eq('round-trip: Rentsync friction = 0', rentsync.frictionCount, 0);
}

// ============================================================================
// 10. CLI behavior
// ============================================================================
console.log('\n--- 10. CLI behavior ---');

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'process-quality.mjs');

try {
  execFileSync('node', [scriptPath, '--self-test'], { encoding: 'utf-8', timeout: 10000 });
  ok('--self-test exits 0', true);
} catch (e) {
  ok('--self-test exits 0', false);
  console.log(`    exit code: ${e.status}, stderr: ${e.stderr?.slice(0, 200)}`);
}

const defaultOut = execFileSync('node', [scriptPath], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
const defaultJson = JSON.parse(defaultOut);
ok('default produces valid JSON', typeof defaultJson === 'object');
ok('default has metadata', 'metadata' in defaultJson);
ok('default has signals array', 'signals' in defaultJson && Array.isArray(defaultJson.signals));
eq('default minThreshold = 1', defaultJson.metadata.minThreshold, 1);

// Missing-file CLI behavior, isolated via --file pointing at a path that
// deliberately does not exist inside a fresh temp dir. This must NOT depend
// on whether the caller's real data/active-interviews.md happens to exist —
// a contributor running this suite with real interview data in their own
// workspace must get the same result as CI.
const missingFileTmpDir = mkdtempSync(join(tmpdir(), 'process-quality-missing-'));
const missingFilePath = join(missingFileTmpDir, 'does-not-exist.md');
try {
  const missingOut = execFileSync('node', [scriptPath, '--file', missingFilePath], {
    encoding: 'utf-8', timeout: 10000,
    cwd: dirname(scriptPath),
  });
  ok('missing --file path: CLI does not throw', !!missingOut);
  const missingJson = JSON.parse(missingOut);
  eq('missing --file path: totalRows = 0', missingJson.metadata.totalRows, 0);
  eq('missing --file path: signals = []', missingJson.signals, []);
} finally {
  rmSync(missingFileTmpDir, { recursive: true, force: true });
}

// --file also works as a positive-path override: point it at a controlled
// fixture file and confirm the CLI reads exactly that file, isolated from
// whatever the caller's real workspace contains.
const fixtureTmpDir = mkdtempSync(join(tmpdir(), 'process-quality-fixture-'));
const fixturePath = join(fixtureTmpDir, 'active-interviews.md');
try {
  writeFileSync(fixturePath, table([
    '| FixtureCo | Role | Prescreen | 2026-07-01 | Someone | Scheduled | [process-friction: fixture reason] |',
  ]));
  const fixtureOut = execFileSync('node', [scriptPath, '--file', fixturePath], {
    encoding: 'utf-8', timeout: 10000,
    cwd: dirname(scriptPath),
  });
  const fixtureJson = JSON.parse(fixtureOut);
  eq('--file fixture: totalRows = 1', fixtureJson.metadata.totalRows, 1);
  eq('--file fixture: 1 signal (FixtureCo)', fixtureJson.signals.length, 1);
  eq('--file fixture: FixtureCo friction captured', fixtureJson.signals[0]?.reasons?.[0], 'fixture reason');
} finally {
  rmSync(fixtureTmpDir, { recursive: true, force: true });
}

const thresholdOut = execFileSync('node', [scriptPath, '--min-threshold', '3'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
const thresholdJson = JSON.parse(thresholdOut);
eq('--min-threshold sets minThreshold in metadata', thresholdJson.metadata.minThreshold, 3);

const badThresholdOut = execFileSync('node', [scriptPath, '--min-threshold', 'abc'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
const badThresholdJson = JSON.parse(badThresholdOut);
eq('--min-threshold abc falls back to 1', badThresholdJson.metadata.minThreshold, 1);

const summaryOut = execFileSync('node', [scriptPath, '--summary'], {
  encoding: 'utf-8', timeout: 10000,
  cwd: dirname(scriptPath),
});
ok('--summary produces human-readable output', summaryOut.includes('Process Quality Signal'));

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
