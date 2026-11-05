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
import { extractTrackerReportLinks } from '../tracker-parse.mjs';

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
  const setCell = (name, value) => {
    const before = readFileSync(tracker, 'utf8');
    const row = rows()[0], cells = row.split('|'), index = fields.indexOf(name) + 1;
    assert.ok(index > 0, 'fixture column exists');
    cells[index] = ` ${value} `;
    writeFileSync(tracker, before.replace(row, cells.join('|')));
  };
  const add = ({ num = '101', url = PRIMARY, official = FIRST, score = '3.7/5', file = fileFor(num), notes = 'initial', preamble = '', body = '' } = {}) => {
    const markdown = report(url, official, { score, preamble, body });
    assert.deepEqual(writeEvaluationArtifacts(root, { markdown, num, today: '2026-01-01', company: 'ExampleCo', role: 'Product Lead', score, url, notes, reportFile: file }), { ok: true });
    return file;
  };
  // Replaying an already-written artifact is a TSV operation, not permission
  // to overwrite its immutable report file (the archive writer uses wx).
  const replay = ({ num = '101', url = FIRST, score = '3.7/5', file = fileFor(num) } = {}) => {
    mkdirSync(additions, { recursive: true });
    writeFileSync(join(additions, `${num}-exampleco-replay.tsv`), trackerTsvLine({ num, today: '2026-01-01', company: 'ExampleCo', role: 'Product Lead', score, url, notes: 'same-file replay', reportFile: file }));
  };
  const merge = () => mergeTracker({ appsFile: tracker, dataRoot: root, logger: { log() {}, warn() {}, error() {} } });
  const reportImages = () => Object.fromEntries(flatFiles(join(root, 'reports')).map(name => [name, readFileSync(join(root, 'reports', name), 'utf8')]));
  const reportLinks = () => rows().flatMap(row => extractTrackerReportLinks(reportColumn ? cell(row, 'Report') : '', cell(row, 'Notes')));
  return { root, tracker, additions, rows, cell, setCell, add, replay, merge, reportImages, reportLinks };
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

for (const [kind, target] of [
  ['external', 'https://portfolio.example/reports/case-study.pdf'],
  ['local nonnumeric', '../reports/portfolio-case.md'],
]) {
  test(`an arbitrary ${kind} Portfolio label cannot claim report-number ownership`, async t => {
    const f = fixture(t);
    f.add({ num: '900', url: FIRST, official: '' });
    assert.equal(await f.merge(), 0);
    if (kind === 'local nonnumeric') writeFileSync(join(f.root, 'reports', 'portfolio-case.md'), 'A fictional portfolio case study.');
    f.setCell('Notes', `Portfolio [101](${target}).`);
    const prior = f.rows()[0];
    assert.deepEqual(f.reportLinks(), [], 'the native parser finds no report-number owner in that prose link');
    assert.ok(!Object.keys(f.reportImages()).some(name => name.startsWith('101-')), 'no report 101 artifact exists before the new evaluation');
    f.add({ num: '101', url: SECOND, official: SECOND, score: '4.0/5' });
    const images = f.reportImages();
    assert.equal(flatFiles(f.additions).filter(name => name.endsWith('.tsv')).length, 1);
    assert.equal(await f.merge(), 0);
    assert.equal(f.rows().length, 2);
    assert.ok(f.rows().includes(prior), 'the row with unowned prose stays byte-exact');
    assert.ok(f.rows().some(row => row.includes(fileFor('101')) && f.cell(row, 'Score') === '4.0/5'));
    assert.deepEqual(f.reportLinks().map(link => link.target), [101], 'the new report has exactly one native owner');
    assert.deepEqual(flatFiles(f.additions).filter(name => name.endsWith('.tsv')), [], 'the distinct opening is consumed');
    assert.deepEqual(f.reportImages(), images, 'the merger edits no artifact');
  });
}

test('a local numbered Portfolio target remains report ownership regardless of its prose label', async t => {
  const f = fixture(t);
  f.add({ num: '900', url: FIRST, official: '' });
  assert.equal(await f.merge(), 0);
  writeFileSync(join(f.root, 'reports', '101-portfolio.md'), report(FIRST, FIRST));
  f.setCell('Notes', 'Portfolio [900](../reports/101-portfolio.md).');
  assert.deepEqual(f.reportLinks().map(link => link.target), [101], 'ownership follows the actual target, not the label');
  const before = readFileSync(f.tracker, 'utf8');
  f.add({ num: '101', url: SECOND, official: SECOND, score: '4.0/5' });
  const images = f.reportImages();
  const pending = flatFiles(f.additions).filter(name => name.endsWith('.tsv'));
  assert.equal(pending.length, 1);
  const contribution = readFileSync(join(f.additions, pending[0]), 'utf8');
  assert.equal(await f.merge(), 1);
  assert.equal(readFileSync(f.tracker, 'utf8'), before);
  assert.deepEqual(f.reportLinks().map(link => link.target), [101], 'no second owner is added');
  assert.deepEqual(flatFiles(f.additions).filter(name => name.endsWith('.tsv')), pending);
  assert.equal(readFileSync(join(f.additions, pending[0]), 'utf8'), contribution);
  assert.deepEqual(f.reportImages(), images);
});

test('a canonical Notes reference permits same-file re-evaluation of the same employer posting', async t => {
  const f = await existing(t, { url: FIRST });
  const images = f.reportImages();
  f.replay({ url: FIRST });
  assert.equal(await f.merge(), 0);
  assert.equal(f.rows().length, 1);
  assert.ok(f.rows()[0].includes(fileFor('101')));
  assert.equal(f.cell(f.rows()[0], 'Score'), '3.7/5', 'the replay score still matches the immutable report');
  assert.deepEqual(f.reportLinks().map(link => link.target), [101], 'the native parser finds one authoritative reference');
  assert.deepEqual(flatFiles(f.additions).filter(name => name.endsWith('.tsv')), []);
  assert.deepEqual(f.reportImages(), images);
});

for (const reportColumn of [false, true]) {
  test(`conflicting employer identities in the same file stay pending with ${reportColumn ? 'a Report column' : 'a Notes reference'}`, async t => {
    const f = await existing(t, { url: FIRST }, { reportColumn });
    const before = readFileSync(f.tracker, 'utf8');
    const images = f.reportImages();
    // A contradictory contribution cannot make this existing report belong
    // to a second opening. The native report itself is never rewritten.
    f.replay({ url: SECOND });
    const pending = flatFiles(f.additions).filter(name => name.endsWith('.tsv'));
    assert.equal(pending.length, 1);
    const contribution = readFileSync(join(f.additions, pending[0]), 'utf8');
    assert.equal(await f.merge(), 1);
    assert.equal(readFileSync(f.tracker, 'utf8'), before);
    assert.equal(f.rows().length, 1);
    assert.deepEqual(f.reportLinks().map(link => link.target), [101], 'no duplicate report owner is added');
    assert.deepEqual(flatFiles(f.additions).filter(name => name.endsWith('.tsv')), pending);
    assert.equal(readFileSync(join(f.additions, pending[0]), 'utf8'), contribution);
    assert.deepEqual(f.reportImages(), images, 'the merger does not rewrite the artifact already on disk');
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

for (const placeholder of ['-', '—', 'N/A']) {
  test(`a ${placeholder} Report cell retains employer evidence from its Notes reference`, async t => {
    const f = await existing(t, { notes: `Report: [101](../reports/${fileFor('101')}).` }, { reportColumn: true });
    f.setCell('Report', placeholder);
    const prior = f.rows()[0];
    f.add({ num: '102', official: SECOND, score: '4.0/5' });
    const images = f.reportImages();
    assert.equal(await f.merge(), 0);
    assert.equal(f.rows().length, 2);
    assert.ok(f.rows().includes(prior), 'the existing placeholder row stays byte-exact');
    assert.ok(f.rows().some(row => row.includes(fileFor('102')) && f.cell(row, 'Score') === '4.0/5'));
    assert.deepEqual(f.reportImages(), images, 'neither report is edited');
  });
}

test('a non-placeholder Report value is not replaced by a Notes reference', async t => {
  const f = await existing(t, { notes: `Report: [101](../reports/${fileFor('101')}).` }, { reportColumn: true });
  f.setCell('Report', 'legacy-manual-reference');
  f.add({ num: '102', official: SECOND, score: '4.0/5' });
  const images = f.reportImages();
  assert.equal(await f.merge(), 0);
  assert.equal(f.rows().length, 1, 'unknown explicit metadata preserves existing matching semantics');
  assert.ok(f.rows()[0].includes(fileFor('102')));
  assert.deepEqual(f.reportImages(), images);
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


for (const reportColumn of [false, true]) {
  for (const sharedTarget of [true, false]) {
    test(`${sharedTarget ? 'shared' : 'distinct'} report targets retain declared identity across different company names with ${reportColumn ? 'Report' : 'Notes'} metadata`, async t => {
      const root = mkdtempSync(join(tmpdir(), 'tracker-lazy-shared-target-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      for (const dir of ['data', 'reports', 'batch/tracker-additions']) mkdirSync(join(root, dir), { recursive: true });
      const tracker = join(root, 'data/applications.md');
      const columns = ['#', 'Date', 'Company', 'Role', 'Score', 'Status', 'PDF', ...(reportColumn ? ['Report'] : []), 'Notes', 'URL'];
      const oldFile = '101-original-brand-2026-01-01.md';
      const incomingNum = sharedTarget ? '101' : '102';
      const incomingFile = `${incomingNum}-different-brand-2026-01-01.md`;
      const oldLink = `[101](../reports/${oldFile})`;
      const publisher = 'https://himalayas.app/companies/exampleco/jobs/product-lead-123456';
      const oldRow = `| ${['101', '2026-01-01', 'Original Brand', 'Product Lead', '3.7/5', 'Evaluated', '❌', ...(reportColumn ? [oldLink] : []), reportColumn ? 'original' : `Report: ${oldLink}.`, publisher].join(' | ')} |`;
      const before = `| ${columns.join(' | ')} |\n|${columns.map(() => '---').join('|')}|\n${oldRow}\n`;
      writeFileSync(tracker, before);
      const oldReport = report(publisher, FIRST);
      // The incoming report has no official-posting declaration. Its raw ATS
      // URL conflicts with the existing report's declared identity, regardless
      // of the two different company labels or distinct report filenames.
      const incomingReport = report(SECOND, '');
      writeFileSync(join(root, 'reports', oldFile), oldReport);
      writeFileSync(join(root, 'reports', incomingFile), incomingReport);
      const pending = join(root, 'batch/tracker-additions/incoming.tsv');
      const contribution = trackerTsvLine({ num: incomingNum, today: '2026-01-01', company: 'Different Brand', role: 'Product Lead', score: '3.7/5', reportFile: incomingFile, notes: 'fictional contribution', url: SECOND });
      writeFileSync(pending, contribution);
      writeFileSync(join(root, 'data/pdf-index.tsv'), '');
      writeFileSync(join(root, 'batch/batch-state.tsv'), '');
      const code = await mergeTracker({ appsFile: tracker, dataRoot: root, batchStateFile: join(root, 'batch/batch-state.tsv'), pdfIndexFile: join(root, 'data/pdf-index.tsv'), logger: { log() {}, warn() {}, error() {} } });
      assert.equal(code, sharedTarget ? 1 : 0);
      const after = readFileSync(tracker, 'utf8');
      const rows = after.split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
      const targets = rows.flatMap(row => {
        const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
        return extractTrackerReportLinks(reportColumn ? cells[columns.indexOf('Report')] : '', cells[columns.indexOf('Notes')]).map(link => link.target);
      });
      assert.deepEqual(targets, sharedTarget ? [101] : [101, 102], 'the native parser finds exactly one owner per report target');
      assert.equal(readFileSync(join(root, 'reports', oldFile), 'utf8'), oldReport);
      assert.equal(readFileSync(join(root, 'reports', incomingFile), 'utf8'), incomingReport);
      if (sharedTarget) {
        assert.equal(after, before, 'the conflicting contribution changes no tracker row');
        assert.equal(readFileSync(pending, 'utf8'), contribution, 'the exact native TSV remains pending');
      } else {
        assert.equal(rows.length, 2);
        assert.ok(rows.includes(oldRow), 'a distinct report target preserves the original row');
        assert.equal(readFileSync(join(root, 'batch/tracker-additions/merged/incoming.tsv'), 'utf8'), contribution, 'a distinct target consumes the unchanged contribution');
      }
    });
  }
}
