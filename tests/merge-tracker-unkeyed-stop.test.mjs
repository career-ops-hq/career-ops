// A historical stop with no posting identity cannot identify a later opening.
// Exercise the native writer and merge with fictional reports and ATS IDs.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeTracker } from '../merge-tracker.mjs';
import { writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';
import { trackerTsvLine } from '../lib/tracker-addition.mjs';

const URL = 'https://jobs.ashbyhq.com/exampleco/11111111-1111-4111-8111-111111111111';
const OLD_ROLE = 'Product Owner, Technical - AI Finance';
const NEW_ROLE = 'Technical Product Manager - AI Finance';
const NEW_FILE = '078-exampleco-2026-10-01.md';
const OLD_FILE = '050-exampleco-2026-10-01.md';
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';
const MARKDOWN = (url) => `# Evaluation: ExampleCo\n\n**Score:** 4.0/5 | **URL:** ${url || 'N/A'} | **PDF:** not generated\n\n## A. Summary\nA fictional evaluation.\n\n## Job Description (archived verbatim)\nA fictional complete posting about product planning and delivery; no candidate data.\n`;

async function scenario(name, {
  status = 'SKIP', oldNotes = 'A previous decision; original posting identity was not recorded.',
  newNotes = 'fresh evaluation', newUrl = URL, oldUrl = '', oldReport = '-',
  entryNum = '69', newNum = '078', expected = 2, sameFile = false, directTsv = false,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-unkeyed-stop-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'reports'));
    const tracker = join(root, 'data', 'applications.md');
    const oldRow = `| ${entryNum} | 2026-10-01 | ExampleCo | ${OLD_ROLE} | N/A | ${status} | ❌ | ${oldReport} | ${oldNotes} |`;
    // Include unrelated rows to prove the stopped record and neighbouring data
    // survive the insert, rather than merely counting the resulting rows.
    const otherRow = '| 2 | 2026-10-01 | OtherCo | Analyst | 3.5/5 | Applied | ❌ | - | preserve this decision |';
    writeFileSync(tracker, [HEADER, SEP, otherRow, oldRow, ''].join('\n'));
    if (oldReport !== '-') writeFileSync(join(root, 'reports', sameFile ? NEW_FILE : OLD_FILE), MARKDOWN(oldUrl));
    const payload = { markdown: MARKDOWN(newUrl), num: newNum, today: '2026-10-01', company: 'ExampleCo', role: NEW_ROLE, score: '4.0/5', url: newUrl, notes: newNotes, reportFile: NEW_FILE };
    if (sameFile || directTsv) {
      mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
      if (directTsv) writeFileSync(join(root, 'reports', NEW_FILE), MARKDOWN(newUrl));
      writeFileSync(join(root, 'batch', 'tracker-additions', 'same-file.tsv'), trackerTsvLine(payload));
    } else {
      assert.deepEqual(writeEvaluationArtifacts(root, payload), { ok: true });
    }
    const beforeReport = readFileSync(join(root, 'reports', NEW_FILE), 'utf8');
    const result = await mergeTracker({ appsFile: tracker, dataRoot: root, logger: { log() {}, warn() {}, error() {} } });
    assert.equal(result, 0, 'native merge succeeds');
    const rows = readFileSync(tracker, 'utf8').split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
    assert.equal(rows.length, expected + 1, 'unrelated row plus expected posting rows');
    assert.ok(rows.includes(otherRow), 'unrelated tracker row is byte-exact');
    assert.equal(new Set(rows.map(row => row.split('|')[1].trim())).size, rows.length, 'row IDs stay unique');
    const fresh = rows.find(row => row.includes(NEW_FILE));
    assert.ok(fresh?.includes('4.0/5'), 'actual new report and score remain referenced');
    if (expected === 2) {
      assert.ok(rows.includes(oldRow), 'historical stop is byte-exact');
      assert.ok(fresh.includes(NEW_ROLE) && fresh.includes('| Evaluated |'), 'new opening keeps its own role and completed evaluation state');
      assert.ok(!fresh.includes(oldNotes), 'old stop rationale is not transferred to the new opening');
    }
    assert.equal(readFileSync(join(root, 'reports', NEW_FILE), 'utf8'), beforeReport, 'merge never changes the report');
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await scenario('a known ATS opening does not inherit an unkeyed historical SKIP via a fuzzy title');
await scenario('weak entry-number equality does not claim an unkeyed SKIP', { entryNum: '78' });
await scenario('an unkeyed Discarded record remains a distinct decision', { status: 'Discarded' });
await scenario('canonical SKIP aliases protect historical decisions', { status: '**no aplicar** 2026-09-30' });
await scenario('canonical Discarded aliases protect historical decisions', { status: 'descartada' });
await scenario('canonical Unicode aliases use the shared status resolver', { status: 'UYGUN DEĞİL' });
await scenario('a known req key also protects an unkeyed stopped entry-number collision', { entryNum: '78', newUrl: '', newNotes: 'req EX-10423, fresh evaluation' });
await scenario('the same recorded req preserves normal re-evaluation', { oldNotes: 'req EX-10423, previous decision', newNotes: 'req EX-10423, fresh evaluation', expected: 1 });
await scenario('an Evaluated placeholder retains existing fuzzy completion behavior', { status: 'Evaluated', expected: 1 });
await scenario('unknown statuses are not invented as terminal decisions', { status: 'Unrecognized custom state', expected: 1 });
await scenario('a legacy invalid incoming URL does not invent a posting identity', { newUrl: 'N/A', directTsv: true, expected: 1 });
await scenario('a known report ID stays authoritative when its posting URL is absent', { oldReport: `[78](../reports/${OLD_FILE})`, newUrl: '', expected: 1 });
await scenario('a known report target is not an unkeyed historical stop', { oldReport: `[50](../reports/${OLD_FILE})`, expected: 1 });
await scenario('an exact known posting URL stays authoritative over a stopped status', { oldReport: `[50](../reports/${OLD_FILE})`, oldUrl: URL, expected: 1 });
await scenario('the identical report file stays authoritative over a stopped status', { oldReport: `[50](../reports/${NEW_FILE})`, sameFile: true, newUrl: '', expected: 1 });
