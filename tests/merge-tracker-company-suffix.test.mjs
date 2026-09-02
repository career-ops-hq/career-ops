// tests/merge-tracker-company-suffix.test.mjs — corporate-suffix company variants.
//
// One employer reaches the tracker under two spellings ("Acme" from one board,
// "Acme Technologies" from the next). normalizeCompany() folds case and
// punctuation but not corporate suffixes, so the fuzzy company+role tier never
// fired and a duplicate row was written (#3665).
//
// Every case drives the REAL merge-tracker.mjs CLI against a temp tracker via
// the CAREER_OPS_TRACKER / CAREER_OPS_ADDITIONS env hooks: the merge path is
// where the bug lives, so the resulting rows are what proves the fix. The
// over-merge guards below matter more than the fix itself, because folding two
// rows is destructive and splitting them is only untidy.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MERGE = join(HERE, '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';

function makeEnv() {
  const base = mkdtempSync(join(tmpdir(), 'merge-suffix-test-'));
  const dataDir = join(base, 'data');
  const addDir = join(base, 'additions');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(addDir, { recursive: true });
  return { base, addDir, tracker: join(dataDir, 'applications.md') };
}
function writeTracker(env, rows) {
  writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
}
function addTsv(env, name, cols) {
  writeFileSync(join(env.addDir, name), cols.join('\t'));
}
function runMerge(env, args = []) {
  return execFileSync('node', [MERGE, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, CAREER_OPS_TRACKER: env.tracker, CAREER_OPS_ADDITIONS: env.addDir },
  });
}
function trackerRows(env) {
  return readFileSync(env.tracker, 'utf-8').split('\n')
    .filter(l => l.startsWith('|') && !/^\|[\s|:-]+\|\s*$/.test(l) && !/^\|\s*#\s*\|/.test(l));
}
const cleanup = (env) => rmSync(env.base, { recursive: true, force: true });

// One row plus one addition, with row and report numbers deliberately different
// on the two sides so tiers 1 and 2 cannot fire and only the fuzzy company+role
// tier is left to decide.
function mergeOne({ existingCompany, existingRole, existingNotes = 'n',
                    addCompany, addRole, addNotes = 'n' }) {
  const env = makeEnv();
  try {
    writeTracker(env, [
      `| 1 | 2026-06-01 | ${existingCompany} | ${existingRole} | 4.0/5 | Evaluated | ❌ | [1](reports/1-a.md) | ${existingNotes} |`,
    ]);
    addTsv(env, '2-b.tsv', ['2', '2026-06-03', addCompany, addRole, 'Evaluated', '4.1/5', '❌', '[2](reports/2-b.md)', addNotes]);
    runMerge(env);
    return trackerRows(env);
  } finally { cleanup(env); }
}

console.log('\nmerge-tracker — corporate-suffix company variants (#3665)');

ok('THE BUG: a generic-descriptor variant of one employer merges into its row', () => {
  const rows = mergeOne({
    existingCompany: 'Acme Technologies', existingRole: 'Director of Marketing',
    addCompany: 'Acme', addRole: 'Director of Marketing',
  });
  assert.equal(rows.length, 1, `expected the row to be UPDATED, got ${rows.length} rows (duplicate)`);
  assert.ok(rows[0].includes('4.1/5'), 're-eval score written through');
});

ok('THE BUG: a legal-suffix variant merges too, and chains', () => {
  const rows = mergeOne({
    existingCompany: 'Acme', existingRole: 'Director of Marketing',
    addCompany: 'Acme Holdings Inc.', addRole: 'Director of Marketing',
  });
  assert.equal(rows.length, 1, `expected 1 row, got ${rows.length}`);
});

ok('THE OVER-MERGE GUARD: two employers sharing a stem stay two rows', () => {
  // Both names end in a word from the descriptor vocabulary, so any rule that
  // strips descriptors before comparing keys folds these to the same "acme"
  // and destroys one row. Neither name is a prefix of the other, which is the
  // property the tier is built on.
  const rows = mergeOne({
    existingCompany: 'Acme Solutions', existingRole: 'Director of Marketing',
    addCompany: 'Acme Technologies', addRole: 'Director of Marketing',
  });
  assert.equal(rows.length, 2, 'a shared stem is not a shared employer');
});

ok('THE OVER-MERGE GUARD: an extra word that is not a corporate form stays distinct', () => {
  const rows = mergeOne({
    existingCompany: 'Acme', existingRole: 'Director of Marketing',
    addCompany: 'Acme Robotics', addRole: 'Director of Marketing',
  });
  assert.equal(rows.length, 2, '"Robotics" is part of the name, not a legal form');
});

ok('THE OVER-MERGE GUARD: a stem under three characters is refused', () => {
  // A deliberate miss. Two characters is weak identity, and the cost of
  // refusing is the duplicate row that exists today anyway.
  const rows = mergeOne({
    existingCompany: 'AB', existingRole: 'Director of Marketing',
    addCompany: 'AB Inc.', addRole: 'Director of Marketing',
  });
  assert.equal(rows.length, 2, 'short stems fall through to the previous behavior');
});

ok('req-number mismatch still proves two postings apart (#1524 precedence)', () => {
  const rows = mergeOne({
    existingCompany: 'Acme Technologies', existingRole: 'Director of Marketing', existingNotes: 'req R-1001',
    addCompany: 'Acme', addRole: 'Director of Marketing', addNotes: 'req R-1002',
  });
  assert.equal(rows.length, 2, 'the wider company match must not outrank a req mismatch');
});

ok('an employer-board URL mismatch still proves two postings apart', () => {
  const env = makeEnv();
  try {
    const H = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
    const S = '|---|---|---|---|---|---|---|---|---|---|';
    writeFileSync(env.tracker, ['# Applications Tracker', '', H, S,
      '| 1 | 2026-06-01 | Acme Technologies | Director of Marketing | 4.0/5 | Evaluated | ❌ | [1](reports/1-a.md) | n | https://boards.greenhouse.io/acme/jobs/7001 |', ''].join('\n'));
    addTsv(env, '2-b.tsv', ['2', '2026-06-03', 'Acme', 'Director of Marketing', 'Evaluated', '4.1/5', '❌', '[2](reports/2-b.md)', 'n', 'https://boards.greenhouse.io/acme/jobs/7002']);
    runMerge(env);
    assert.equal(trackerRows(env).length, 2, 'two requisitions on the employer board stay two rows');
  } finally { cleanup(env); }
});

ok('a role that does not fuzzy-match is unaffected by the wider company match', () => {
  const rows = mergeOne({
    existingCompany: 'Acme Technologies', existingRole: 'Director of Marketing',
    addCompany: 'Acme', addRole: 'Staff Accountant',
  });
  assert.equal(rows.length, 2, 'the tier still requires the role to match');
});

ok('CONTROL: exact company match still merges, unchanged', () => {
  const rows = mergeOne({
    existingCompany: 'Acme', existingRole: 'Director of Marketing',
    addCompany: 'Acme', addRole: 'Director of Marketing',
  });
  assert.equal(rows.length, 1, 'the existing exact tier is untouched');
});

ok('CONTROL: unrelated employers still stay apart', () => {
  const rows = mergeOne({
    existingCompany: 'Globex', existingRole: 'Director of Marketing',
    addCompany: 'Initech', addRole: 'Director of Marketing',
  });
  assert.equal(rows.length, 2);
});

ok('CONTROL: a blind-employer row cannot reach the tier (empty stem)', () => {
  const rows = mergeOne({
    existingCompany: '?', existingRole: 'Director of Marketing',
    addCompany: 'Acme Ltd', addRole: 'Director of Marketing',
  });
  assert.equal(rows.length, 2, 'an unknown employer never matches a named one');
});
