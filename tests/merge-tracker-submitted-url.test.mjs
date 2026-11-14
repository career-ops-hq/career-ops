// A submitted row keeps the posting that was submitted. A title match that
// cannot prove the incoming URL is that posting must not rewrite the row,
// and it must not hide a later Evaluated row with the same title.
// Every changed tracker write also keeps the previous bytes in a .bak.
import { pass, fail, isolatedBatchStatePath } from './helpers.mjs';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractCellUrl } from '../tracker-parse.mjs';
import { syncTrackerPdfFlags } from '../sync-pdf-flags.mjs';
import { backupFileAtomically } from '../tracker-utils.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MERGE = join(HERE, '..', 'merge-tracker.mjs');
const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';

function makeEnv() {
  const base = mkdtempSync(join(tmpdir(), 'merge-submitted-url-'));
  const dataDir = join(base, 'data');
  const addDir = join(base, 'additions');
  const reportsDir = join(base, 'reports');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(addDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  const tracker = join(dataDir, 'applications.md');
  return { base, dataDir, addDir, reportsDir, tracker };
}
function writeTracker(env, rows) {
  writeFileSync(env.tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
}
function addTsv(env, name, cols) {
  writeFileSync(join(env.addDir, name), cols.join('\t'));
}
function runMerge(env, args = []) {
  const childEnv = {
    ...process.env,
    CAREER_OPS_ROOT: env.base,
    CAREER_OPS_TRACKER: env.tracker,
    CAREER_OPS_ADDITIONS: env.addDir,
    CAREER_OPS_BATCH_STATE: isolatedBatchStatePath(env.addDir),
  };
  delete childEnv.CAREER_OPS_DATA_DIR;
  delete childEnv.CAREER_OPS_CODE_ROOT;
  return execFileSync('node', [MERGE, '--allow-headerless', ...args], { encoding: 'utf-8', env: childEnv });
}
function trackerRows(env) {
  return readFileSync(env.tracker, 'utf-8').split('\n').filter(l => l.startsWith('|') && !/^\|[\s|:-]+\|\s*$/.test(l) && !/^\|\s*#\s*\|/.test(l));
}
function urlCell(row) {
  const cells = row.split('|').map(s => s.trim());
  return cells[cells.length - 2] ?? '';
}
function urlHref(row) {
  return extractCellUrl(urlCell(row));
}
function rowNum(row) {
  return row.split('|')[1].trim();
}
const cleanup = (env) => rmSync(env.base, { recursive: true, force: true });

console.log('\nmerge-tracker — submitted rows keep their posting URL');

ok('an Applied row is not retargeted onto an unmapped second listing', () => {
  const env = makeEnv();
  try {
    const appliedUrl = 'https://www.glassdoor.com/job-listing/director-of-marketing-fixture-co-JV_1.htm';
    const otherUrl = 'https://www.glassdoor.com/job-listing/director-of-marketing-fixture-co-JV_2.htm';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.5/5 | Applied | ❌ | [1](reports/1-fixture.md) | n | ${appliedUrl} |`,
    ]);
    addTsv(env, '2-fixture.tsv', ['2', '2026-06-03', 'Fixture Co', 'Director of Marketing', 'Evaluated', '3.2/5', '❌',
      '[2](reports/2-fixture.md)', 'n', otherUrl]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, `the second listing must get its own row, got ${rows.length}`);
    const applied = rows.find(r => rowNum(r) === '1');
    assert.equal(urlHref(applied), appliedUrl, 'the Applied row keeps the URL that was submitted');
    assert.ok(applied.includes('4.5/5') && applied.includes('Applied') && applied.includes('1-fixture.md'),
      'the Applied score and report stay');
    const bak = readFileSync(`${env.tracker}.bak`, 'utf-8');
    assert.ok(bak.includes('JV_1') && bak.includes('4.5/5') && !bak.includes('JV_2'),
      'the backup is the tracker from before the rewrite');
  } finally { cleanup(env); }
});

ok('an Applied aggregator row is not retargeted onto another board', () => {
  const env = makeEnv();
  try {
    const appliedUrl = 'https://www.linkedin.com/jobs/view/4001';
    const otherUrl = 'https://boards.greenhouse.io/fixtureco/jobs/9001';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.6/5 | Applied | ❌ | [1](reports/1-fixture.md) | n | ${appliedUrl} |`,
    ]);
    addTsv(env, '2-fixture.tsv', ['2', '2026-06-03', 'Fixture Co', 'Director of Marketing', 'Evaluated', '3.4/5', '❌',
      '[2](reports/2-fixture.md)', 'n', otherUrl]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, `the other board must get its own row, got ${rows.length}`);
    const applied = rows.find(r => rowNum(r) === '1');
    assert.equal(urlHref(applied), appliedUrl, 'the Applied row keeps the LinkedIn URL');
    assert.ok(applied.includes('4.6/5') && applied.includes('1-fixture.md') && !applied.includes('3.4/5'),
      'the Applied score and report are not replaced');
    assert.ok(existsSync(`${env.tracker}.bak`), 'a rewrite leaves a backup');
  } finally { cleanup(env); }
});

ok('a same-URL re-eval of an Applied row still updates, and keeps a backup', () => {
  const env = makeEnv();
  try {
    const url = 'https://boards.greenhouse.io/fixtureco/jobs/7001';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.0/5 | Applied | ❌ | [1](reports/1-fixture.md) | n | ${url} |`,
    ]);
    addTsv(env, '1-fixture.tsv', ['1', '2026-06-03', 'Fixture Co', 'Director of Marketing', 'Evaluated', '4.4/5', '❌',
      '[1](reports/1-fixture.md)', 're-eval', url]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 1, `same posting updates in place, got ${rows.length}`);
    assert.ok(rows[0].includes('4.4/5') && rows[0].includes('Applied'), 'score updates, status stays Applied');
    assert.equal(urlHref(rows[0]), url, 'the URL stays');
    const bak = readFileSync(`${env.tracker}.bak`, 'utf-8');
    assert.ok(bak.includes('4.0/5') && !bak.includes('4.4/5'), 'the backup is the row from before the update');
  } finally { cleanup(env); }
});

ok('an earlier Applied title match does not hide a later Evaluated row', () => {
  const env = makeEnv();
  try {
    const appliedUrl = 'https://www.linkedin.com/jobs/view/4001';
    const incomingUrl = 'https://boards.greenhouse.io/fixtureco/jobs/9002';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.6/5 | Applied | ❌ | [1](reports/1-fixture.md) | n | ${appliedUrl} |`,
      '| 3 | 2026-06-02 | Fixture Co | Director of Marketing | 3.0/5 | Evaluated | ❌ | [3](reports/3-fixture.md) | n | — |',
    ]);
    addTsv(env, '2-fixture.tsv', ['2', '2026-06-03', 'Fixture Co', 'Director of Marketing', 'Evaluated', '3.9/5', '❌',
      '[2](reports/2-fixture.md)', 'n', incomingUrl]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, `the Evaluated row is updated, not a third row, got ${rows.length}`);
    assert.ok(!rows.some(r => rowNum(r) === '2'), 'no new row was added');
    const applied = rows.find(r => rowNum(r) === '1');
    assert.equal(urlHref(applied), appliedUrl, 'the Applied row keeps the LinkedIn URL');
    assert.ok(applied.includes('4.6/5') && applied.includes('1-fixture.md'),
      'the Applied score and report stay');
    const evaluated = rows.find(r => rowNum(r) === '3');
    assert.equal(urlHref(evaluated), incomingUrl, 'the Evaluated row takes the incoming URL');
    assert.ok(evaluated.includes('3.9/5') && evaluated.includes('2-fixture.md'),
      'the Evaluated score and report update');
  } finally { cleanup(env); }
});

ok('an Applied entry-number match does not hide a later Evaluated row', () => {
  const env = makeEnv();
  try {
    const appliedUrl = 'https://www.linkedin.com/jobs/view/4001';
    const incomingUrl = 'https://boards.greenhouse.io/fixtureco/jobs/9002';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.6/5 | Applied | ❌ | [1](reports/1-fixture.md) | n | ${appliedUrl} |`,
      '| 3 | 2026-06-02 | Fixture Co | Director of Marketing | 3.0/5 | Evaluated | ❌ | [3](reports/3-fixture.md) | n | — |',
    ]);
    addTsv(env, '1-fixture.tsv', ['1', '2026-06-03', 'Fixture Co', 'Director of Marketing', 'Evaluated', '3.9/5', '❌',
      '[2](reports/2-fixture.md)', 'n', incomingUrl]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, `the Evaluated row is updated, not a new row, got ${rows.length}`);
    assert.ok(!rows.some(r => rowNum(r) === '4'), 'no fourth row was added');
    const applied = rows.find(r => rowNum(r) === '1');
    assert.equal(urlHref(applied), appliedUrl, 'the Applied row keeps the LinkedIn URL');
    assert.ok(applied.includes('4.6/5') && applied.includes('1-fixture.md'),
      'the Applied score and report stay');
    const evaluated = rows.find(r => rowNum(r) === '3');
    assert.equal(urlHref(evaluated), incomingUrl, 'the Evaluated row takes the incoming URL');
    assert.ok(evaluated.includes('3.9/5') && evaluated.includes('2-fixture.md'),
      'the Evaluated score and report update');
  } finally { cleanup(env); }
});

ok('a matching entry number still leaves a lone Applied row unchanged', () => {
  const env = makeEnv();
  try {
    const appliedUrl = 'https://www.linkedin.com/jobs/view/4001';
    const incomingUrl = 'https://boards.greenhouse.io/fixtureco/jobs/9002';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.6/5 | Applied | ❌ | [1](reports/1-fixture.md) | n | ${appliedUrl} |`,
    ]);
    addTsv(env, '1-fixture.tsv', ['1', '2026-06-03', 'Fixture Co', 'Director of Marketing', 'Evaluated', '3.4/5', '❌',
      '[2](reports/2-fixture.md)', 'n', incomingUrl]);
    runMerge(env);
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, `the other posting gets its own row, got ${rows.length}`);
    const applied = rows.find(r => rowNum(r) === '1');
    assert.equal(urlHref(applied), appliedUrl, 'the Applied row keeps the LinkedIn URL');
    assert.ok(applied.includes('4.6/5') && applied.includes('1-fixture.md') && !applied.includes('3.4/5'),
      'the Applied score and report are not replaced');
  } finally { cleanup(env); }
});

ok('a sort with no pending additions leaves a backup of the previous tracker', () => {
  const env = makeEnv();
  try {
    writeTracker(env, [
      '| 4 | 2026-01-01 | Delta | Eng | 4.0/5 | Evaluated | ❌ | [4](reports/4-delta.md) | n | — |',
      '| 1 | 2026-01-01 | Alfa | Eng | 3.1/5 | Evaluated | ❌ | [1](reports/1-alfa.md) | n | — |',
    ]);
    const before = readFileSync(env.tracker, 'utf-8');
    runMerge(env);
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), before,
      'the backup is the tracker from before the sort');
    assert.deepEqual(trackerRows(env).map(rowNum), ['1', '4'], 'the table is sorted by #');
  } finally { cleanup(env); }
});

ok('a report-link migration backs up the tracker, and a second run leaves that backup', () => {
  const env = makeEnv();
  try {
    writeTracker(env, [
      '| 1 | 2026-01-01 | Alfa | Eng | 3.1/5 | Evaluated | ❌ | [1](reports/1-alfa.md) | n | — |',
    ]);
    const before = readFileSync(env.tracker, 'utf-8');
    runMerge(env, ['--migrate']);
    const migrated = readFileSync(env.tracker, 'utf-8');
    assert.ok(migrated.includes('../reports/1-alfa.md'), 'the report link is relative to data/');
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), before,
      'the backup is the tracker from before the migration');
    runMerge(env, ['--migrate']);
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), before,
      'an unchanged second migration does not replace the backup');
    assert.equal(readFileSync(env.tracker, 'utf-8'), migrated, 'the second migration leaves the tracker');
  } finally { cleanup(env); }
});

function writeLivePdf(env, reportNum) {
  const pdfDir = join(env.base, 'output');
  mkdirSync(pdfDir, { recursive: true });
  writeFileSync(join(pdfDir, `${reportNum}.pdf`), '%PDF-1.1\n');
  writeFileSync(join(env.dataDir, 'pdf-index.tsv'),
    `${reportNum}\toutput/${reportNum}.pdf\toutput/${reportNum}.html\tpdf\t2026-06-01\n`);
}

ok('an unchanged merge followed by PDF sync backs up the tracker', () => {
  const env = makeEnv();
  try {
    const url = 'https://boards.greenhouse.io/fixtureco/jobs/7001';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.0/5 | Evaluated | — | [1](reports/1-fixture.md) | n | ${url} |`,
    ]);
    writeLivePdf(env, 1);
    addTsv(env, '1-fixture.tsv', ['1', '2026-06-03', 'Fixture Co', 'Director of Marketing', 'Evaluated', 'N/A', '—',
      '[1](reports/1-fixture.md)', 're-eval', url]);
    const before = readFileSync(env.tracker, 'utf-8');
    runMerge(env);
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), before,
      'the backup is the tracker from before the PDF flag update');
    const row = trackerRows(env)[0];
    assert.ok(row.includes('✅') && row.includes('4.0/5'), 'the PDF flag updates and the score stays');
    assert.equal(urlHref(row), url, 'the URL stays');
  } finally { cleanup(env); }
});

ok('a PDF sync after a real merge leaves the pre-merge backup in place', () => {
  const env = makeEnv();
  try {
    const url = 'https://boards.greenhouse.io/fixtureco/jobs/7001';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.0/5 | Evaluated | — | [1](reports/1-fixture.md) | n | ${url} |`,
    ]);
    writeLivePdf(env, 1);
    addTsv(env, '2-fixture.tsv', ['2', '2026-06-03', 'Other Co', 'Analyst', 'Evaluated', '3.2/5', '❌',
      '[2](reports/2-fixture.md)', 'n', 'https://boards.greenhouse.io/otherco/jobs/8001']);
    const before = readFileSync(env.tracker, 'utf-8');
    runMerge(env);
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), before,
      'the PDF flag update does not replace the pre-merge backup');
    const rows = trackerRows(env);
    assert.equal(rows.length, 2, 'the new company is on the tracker');
    assert.ok(rows.some(r => r.includes('Other Co')) && rows.some(r => r.includes('✅')),
      'the merged row and the updated PDF flag are both in the tracker');
  } finally { cleanup(env); }
});

ok('an unchanged migration does not create a backup', () => {
  const env = makeEnv();
  try {
    writeTracker(env, [
      '| 1 | 2026-01-01 | Alfa | Eng | 3.1/5 | Evaluated | ❌ | [1](../reports/1-alfa.md) | n | — |',
    ]);
    runMerge(env, ['--migrate']);
    assert.equal(existsSync(`${env.tracker}.bak`), false, 'identical bytes are not copied to .bak');
  } finally { cleanup(env); }
});

ok('a backup replaces .bak only after the copy finishes', () => {
  const env = makeEnv();
  try {
    writeFileSync(env.tracker, 'CURRENT\n');
    writeFileSync(`${env.tracker}.bak`, 'OLD BACKUP\n');
    backupFileAtomically(env.tracker);
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), 'CURRENT\n');
    assert.deepEqual(readdirSync(env.dataDir).filter(name => name.includes('.tmp')), []);
  } finally { cleanup(env); }
});

ok('a failed backup leaves the previous .bak in place', () => {
  const env = makeEnv();
  try {
    writeFileSync(env.tracker, 'CURRENT\n');
    writeFileSync(`${env.tracker}.bak`, 'OLD BACKUP\n');
    rmSync(env.tracker);
    assert.throws(() => backupFileAtomically(env.tracker));
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), 'OLD BACKUP\n');
    assert.deepEqual(readdirSync(env.dataDir).filter(name => name.includes('.tmp')), []);
  } finally { cleanup(env); }
});

const okAsync = async (name, fn) => {
  try { await fn(); pass(name); }
  catch (e) { fail(`${name} — ${e.message}`); }
};

await okAsync('PDF sync backs up again when the tracker changed after the merge released the lock', async () => {
  const env = makeEnv();
  try {
    const url = 'https://boards.greenhouse.io/fixtureco/jobs/7001';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.0/5 | Evaluated | — | [1](reports/1-fixture.md) | n | ${url} |`,
    ]);
    writeLivePdf(env, 1);
    const before = readFileSync(env.tracker, 'utf-8');
    writeFileSync(`${env.tracker}.bak`, 'STALE BACKUP\n');
    const code = await syncTrackerPdfFlags({
      appsFile: env.tracker,
      pdfManifest: join(env.dataDir, 'pdf-index.tsv'),
      dataRoot: env.base,
      keepExistingBackup: true,
      expectedText: 'not the tracker the merge wrote\n',
    });
    assert.equal(code, 0);
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), before,
      'the backup is the tracker this sync is about to change');
    assert.ok(trackerRows(env)[0].includes('✅'), 'the PDF flag still updates');
  } finally { cleanup(env); }
});

await okAsync('PDF sync keeps the merge backup when the locked tracker still matches', async () => {
  const env = makeEnv();
  try {
    const url = 'https://boards.greenhouse.io/fixtureco/jobs/7001';
    writeTracker(env, [
      `| 1 | 2026-06-01 | Fixture Co | Director of Marketing | 4.0/5 | Evaluated | — | [1](reports/1-fixture.md) | n | ${url} |`,
    ]);
    writeLivePdf(env, 1);
    const before = readFileSync(env.tracker, 'utf-8');
    writeFileSync(`${env.tracker}.bak`, 'PRE-MERGE\n');
    const code = await syncTrackerPdfFlags({
      appsFile: env.tracker,
      pdfManifest: join(env.dataDir, 'pdf-index.tsv'),
      dataRoot: env.base,
      keepExistingBackup: true,
      expectedText: before,
    });
    assert.equal(code, 0);
    assert.equal(readFileSync(`${env.tracker}.bak`, 'utf-8'), 'PRE-MERGE\n',
      'a matching tracker leaves the merge backup alone');
    assert.ok(trackerRows(env)[0].includes('✅'), 'the PDF flag still updates');
  } finally { cleanup(env); }
});
