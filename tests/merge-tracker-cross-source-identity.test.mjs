// Real native writer + merge, using fictional reports and posting IDs only.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeTracker } from '../merge-tracker.mjs';
import { writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';

const PRIMARY = 'https://himalayas.app/companies/exampleco/jobs/product-lead-123456';
const FIRST = 'https://jobs.ashbyhq.com/exampleco/11111111-1111-4111-8111-111111111111';
const SECOND = 'https://jobs.ashbyhq.com/exampleco/22222222-2222-4222-8222-222222222222';
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';
const FILE = (num) => `${num}-exampleco-2026-10-01.md`;
const REPORT = (num, url, official, { preamble = '', body = '' } = {}) => `# Evaluation: ExampleCo\n\n${preamble}**Score:** ${num === '101' ? '3.7' : '4.0'}/5 | **URL:** ${url} | **PDF:** not generated\n${official ? `**Official employer posting:** ${official}\n` : ''}\n<!-- Machine Summary: fictional test -->\n## A. Summary\nA fictional evaluation.\n${body}\n## Job Description (archived verbatim)\nA fictional posting; no real candidate data.\n`;

async function scenario({ name, urlColumn = false, oldUrl = PRIMARY, oldOfficial = FIRST, newUrl = SECOND, newOfficial, preamble = '', body = '', expected = 2 }) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-cross-source-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'reports'));
    const tracker = join(root, 'data', 'applications.md');
    writeFileSync(join(root, 'reports', FILE('101')), REPORT('101', oldUrl, oldOfficial, { preamble, body }));
    writeFileSync(tracker, [HEADER.slice(0, -1) + (urlColumn ? ' URL |' : '|'), SEP + (urlColumn ? '---|' : ''),
      `| 101 | 2026-10-01 | ExampleCo | Product Lead | 3.7/5 | Evaluated | ❌ | [101](../reports/${FILE('101')}) | initial |${urlColumn ? '  |' : ''}`, ''].join('\n'));
    const result = writeEvaluationArtifacts(root, { markdown: REPORT('102', newUrl, newOfficial), num: '102', today: '2026-10-01', company: 'ExampleCo', role: 'Product Lead', score: '4.0/5', url: newUrl, notes: 'fresh evaluation', reportFile: FILE('102') });
    assert.deepEqual(result, { ok: true });
    const beforeFirstReport = readFileSync(join(root, 'reports', FILE('101')), 'utf8');
    await mergeTracker({ appsFile: tracker, dataRoot: root, logger: { log() {}, warn() {}, error() {} } });
    const rows = readFileSync(tracker, 'utf8').split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
    assert.equal(rows.length, expected, name);
    if (expected === 2) {
      assert.match(rows.find(line => /\| 101 \|/.test(line)), /3\.7\/5.*101-exampleco/);
      assert.match(rows.find(line => /\| 102 \|/.test(line)), /4\.0\/5.*102-exampleco/);
    } else {
      assert.match(rows[0], /4\.0\/5.*102-exampleco/);
    }
    assert.equal(readFileSync(join(root, 'reports', FILE('101')), 'utf8'), beforeFirstReport, 'merge never edits the prior report');
    pass(name);
  } catch (error) {
    fail(`${name}: ${error.message}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

await scenario({ name: 'different ATS IDs survive no URL column and publisher provenance' });
await scenario({ name: 'different ATS IDs survive a blank URL cell and publisher provenance', urlColumn: true });
await scenario({ name: 'the same declared ATS identity preserves existing re-evaluation behavior', newUrl: FIRST, expected: 1 });
await scenario({ name: 'the same ATS application URL does not create a different identity', newUrl: `${FIRST}/application`, expected: 1 });
await scenario({ name: 'absent explicit employer metadata preserves unknown cross-board semantics', oldOfficial: '', expected: 1 });
await scenario({ name: 'a body link is never promoted to employer identity', oldOfficial: '', body: `**Official employer posting:** ${FIRST}`, expected: 1 });
await scenario({ name: 'a fenced metadata example is ignored', oldOfficial: '', preamble: `\`\`\`markdown\n**Official employer posting:** ${FIRST}\n\`\`\`\n`, expected: 1 });
await scenario({ name: 'a quoted metadata example is ignored', oldOfficial: '', preamble: `> **Official employer posting:** ${FIRST}\n`, expected: 1 });
await scenario({ name: 'metadata from a different ATS board stays unknown', oldOfficial: FIRST.replace('/exampleco/', '/other-board/'), expected: 1 });
await scenario({ name: 'the incoming publisher report also respects distinct employer IDs', oldUrl: FIRST, oldOfficial: '', newUrl: PRIMARY, newOfficial: SECOND });
await scenario({ name: 'a metadata alias never grants positive identity over distinct primary postings', oldUrl: FIRST, newOfficial: FIRST });
await scenario({ name: 'non-ATS employer metadata is not mistaken for a strong requisition ID', oldOfficial: 'https://careers.example.test/jobs/111', expected: 1 });
await scenario({ name: 'UUID case is not evidence of a different employer requisition', oldOfficial: 'https://jobs.ashbyhq.com/exampleco/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', newUrl: 'https://jobs.ashbyhq.com/exampleco/AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', expected: 1 });
await scenario({ name: 'opaque non-UUID ATS IDs retain their case-sensitive identity', oldOfficial: 'https://apply.workable.com/exampleco/j/AbCdEf', newUrl: 'https://apply.workable.com/exampleco/j/aBcDeF' });
