// Native headed TSV writer + merger, with fictional reports and posting IDs.
// The first native merge creates the Notes reference in a supported layout
// without a Report column; the second merge must read that same reference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { mergeTracker } from '../merge-tracker.mjs';
import { writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';
import { trackerTsvLine } from '../lib/tracker-addition.mjs';
import { listTree } from '../lib/walk-tree.mjs';

const PRIMARY = 'https://himalayas.app/companies/exampleco/jobs/product-lead-123456';
const FIRST = 'https://jobs.ashbyhq.com/exampleco/11111111-1111-4111-8111-111111111111';
const SECOND = 'https://jobs.ashbyhq.com/exampleco/22222222-2222-4222-8222-222222222222';
const fileFor = num => `${num}-exampleco-2026-01-01.md`;
const flatFiles = dir => listTree(dir).filter(file => dirname(file) === dir).map(file => basename(file)).sort();

function report(url, official, { score = '3.7/5', preamble = '', body = '' } = {}) {
  return `# Evaluation: ExampleCo\n\n${preamble}**Score:** ${score} | **URL:** ${url} | **PDF:** not generated\n`
    + (official ? `**Official employer posting:** ${official}\n` : '')
    + `\n<!-- Machine Summary: fictional test -->\n## A. Summary\nA fictional evaluation.\n${body}\n`
    + '## Job Description (archived verbatim)\nA fictional posting, without candidate data.\n';
}

function fixture(t, { reportColumn = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-notes-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
  mkdirSync(join(root, 'data')); mkdirSync(join(root, 'reports'));
  const tracker = join(root, 'data/applications.md');
  const fields = ['#', 'Date', 'Company', 'Role', 'Score', 'Status', 'PDF', ...(reportColumn ? ['Report'] : []), 'Notes', 'URL'];
  writeFileSync(tracker, `| ${fields.join(' | ')} |\n|${fields.map(() => '---').join('|')}|\n`);
  const additions = join(root, 'batch/tracker-additions');
  const rows = () => readFileSync(tracker, 'utf8').split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
  const cell = (row, name) => row.split('|')[fields.indexOf(name) + 1].trim();
  const add = ({ num = '101', url = PRIMARY, official = FIRST, score = '3.7/5', file = fileFor(num), notes = 'initial', preamble = '', body = '' } = {}) => {
    const markdown = report(url, official, { score, preamble, body });
    assert.deepEqual(writeEvaluationArtifacts(root, { markdown, num, today: '2026-01-01', company: 'ExampleCo', role: 'Product Lead', score, url, notes, reportFile: file }), { ok: true });
    return file;
  };
  const merge = () => mergeTracker({ appsFile: tracker, dataRoot: root, logger: { log() {}, warn() {}, error() {} } });
  const reportImages = () => Object.fromEntries(flatFiles(join(root, 'reports')).map(name => [name, readFileSync(join(root, 'reports', name), 'utf8')]));
  return { root, tracker, additions, rows, cell, add, merge, reportImages };
}

async function existing(t, options = {}, layout = {}) {
  const f = fixture(t, layout); f.add(options);
  assert.equal(await f.merge(), 0);
  assert.equal(f.rows().length, 1);
  if (!layout.reportColumn) assert.match(f.cell(f.rows()[0], 'Notes'), /Report: \[101\]\(/, 'the native writer stored its report reference in Notes');
  return f;
}

test('the same aggregator URL cannot replace a distinct employer named in the Notes-backed report', async t => {
  const f = await existing(t); const prior = f.rows()[0];
  f.add({ num: '102', official: SECOND, score: '4.0/5' });
  const images = f.reportImages();
  assert.equal(await f.merge(), 0);
  assert.equal(f.rows().length, 2); assert.ok(f.rows().includes(prior), 'prior tracker row stays byte-exact');
  assert.ok(f.rows().some(row => row.includes(fileFor('102')) && f.cell(row, 'Score') === '4.0/5'));
  assert.deepEqual(f.reportImages(), images, 'neither report is edited');
});

for (const earlierMarkedReference of [false, true]) {
  test(`a conflicting shared report number stays pending${earlierMarkedReference ? ' with an earlier marked decoy' : ''}`, async t => {
    const f = await existing(t, { notes: earlierMarkedReference ? 'Report: [900](../reports/900-decoy.md).' : 'initial' });
    if (earlierMarkedReference) writeFileSync(join(f.root, 'reports', '900-decoy.md'), report(PRIMARY, SECOND));
    const before = readFileSync(f.tracker, 'utf8');
    f.add({ num: '101', file: '101-exampleco-other-2026-01-01.md', official: SECOND, score: '4.0/5' });
    const images = f.reportImages();
    const pending = flatFiles(f.additions).filter(name => name.endsWith('.tsv'));
    assert.equal(pending.length, 1);
    const contribution = readFileSync(join(f.additions, pending[0]), 'utf8');
    assert.equal(await f.merge(), 1);
    assert.equal(readFileSync(f.tracker, 'utf8'), before);
    assert.deepEqual(flatFiles(f.additions).filter(name => name.endsWith('.tsv')), pending);
    assert.equal(readFileSync(join(f.additions, pending[0]), 'utf8'), contribution);
    assert.deepEqual(f.reportImages(), images);
  });
}

test('the same declared employer in Notes still permits ordinary re-evaluation', async t => {
  const f = await existing(t);
  f.add({ num: '102', official: FIRST, score: '4.0/5' });
  const images = f.reportImages();
  assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 1);
  assert.ok(f.rows()[0].includes(fileFor('102'))); assert.equal(f.cell(f.rows()[0], 'Score'), '4.0/5');
  assert.deepEqual(f.reportImages(), images);
});

test('Notes-backed report lookups are cached separately for different existing rows', async t => {
  const f = await existing(t, { url: FIRST });
  f.add({ num: '102', url: SECOND, official: SECOND, score: '3.6/5' });
  assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 2);
  const first = f.rows().find(row => row.includes(fileFor('101')));
  f.add({ num: '103', url: PRIMARY, official: SECOND, score: '4.0/5' });
  const images = f.reportImages();
  assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 2);
  assert.ok(f.rows().includes(first), 'the different first employer must not be replaced');
  assert.ok(f.rows().some(row => row.includes(fileFor('103')) && f.cell(row, 'Score') === '4.0/5'));
  assert.deepEqual(f.reportImages(), images);
});

test('an unrelated Notes link before Report is not read as employer provenance', async t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'reports', '900-decoy.md'), report(PRIMARY, SECOND));
  f.add({ notes: 'Portfolio [900](../reports/900-decoy.md).' });
  assert.equal(await f.merge(), 0);
  f.add({ num: '102', official: SECOND, score: '4.0/5' });
  assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 2);
});

test('the native writer appended Report reference wins over an earlier marked decoy', async t => {
  const f = await existing(t, { notes: 'Report: [900](../reports/900-decoy.md).' });
  writeFileSync(join(f.root, 'reports', '900-decoy.md'), report(PRIMARY, SECOND));
  assert.match(f.cell(f.rows()[0], 'Notes'), /Report: \[900\].*Report: \[101\]/, 'both references came through the native writer');
  f.add({ num: '102', official: SECOND, score: '4.0/5' });
  const images = f.reportImages();
  assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 2);
  assert.deepEqual(f.reportImages(), images);
});

test('a populated Report column remains preferred over a different Notes reference', async t => {
  const f = fixture(t, { reportColumn: true });
  writeFileSync(join(f.root, 'reports', '900-decoy.md'), report(PRIMARY, SECOND));
  f.add({ notes: 'Report: [900](../reports/900-decoy.md).' });
  assert.equal(await f.merge(), 0);
  f.add({ num: '102', official: SECOND, score: '4.0/5' });
  assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 2);
});

test('the shared Markdown parser reads a parenthesized report filename in Notes', async t => {
  const f = fixture(t);
  // Existing hand-authored filenames can contain parentheses; the current
  // artifact writer deliberately restricts slugs for newly generated reports.
  const file = '101-exampleco-(fictional-team)-2026-01-01.md';
  writeFileSync(join(f.root, 'reports', file), report(PRIMARY, FIRST));
  mkdirSync(f.additions, { recursive: true });
  writeFileSync(join(f.additions, '101-exampleco.tsv'), trackerTsvLine({ num: '101', today: '2026-01-01', company: 'ExampleCo', role: 'Product Lead', score: '3.7/5', url: PRIMARY, notes: 'initial', reportFile: file }));
  assert.equal(await f.merge(), 0);
  assert.match(f.cell(f.rows()[0], 'Notes'), /Report: \[101\]\(/);
  f.add({ num: '102', official: SECOND, score: '4.0/5' });
  assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 2);
});

for (const [name, options] of [
  ['missing metadata', {}],
  ['body metadata', { body: `**Official employer posting:** ${FIRST}` }],
  ['fenced metadata', { preamble: `\`\`\`markdown\n**Official employer posting:** ${FIRST}\n\`\`\`\n` }],
  ['quoted metadata', { preamble: `> **Official employer posting:** ${FIRST}\n` }],
]) {
  test(`a Notes reference never promotes ${name} into a conflicting employer declaration`, async t => {
    const f = await existing(t, { official: '', ...options });
    f.add({ num: '102', official: SECOND, score: '4.0/5' });
    assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 1);
    assert.equal(f.cell(f.rows()[0], 'Score'), '4.0/5');
  });
}

test('a Notes metadata alias grants no positive identity across distinct primary ATS postings', async t => {
  const f = await existing(t, { url: FIRST });
  f.add({ num: '102', url: SECOND, official: FIRST, score: '4.0/5' });
  assert.equal(await f.merge(), 0); assert.equal(f.rows().length, 2);
});
