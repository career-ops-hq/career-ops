// Real native writer + merge, using fictional reports and posting IDs only.
import { pass, fail } from './helpers.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeTracker } from '../merge-tracker.mjs';
import { writeEvaluationArtifacts } from '../persist-evaluation-report.mjs';
import { trackerTsvLine } from '../lib/tracker-addition.mjs';
import { extractTrackerReportLinks } from '../tracker-parse.mjs';

const PRIMARY = 'https://himalayas.app/companies/exampleco/jobs/product-lead-123456';
const FIRST = 'https://jobs.ashbyhq.com/exampleco/11111111-1111-4111-8111-111111111111';
const SECOND = 'https://jobs.ashbyhq.com/exampleco/22222222-2222-4222-8222-222222222222';
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |';
const SEP = '|---|---|---|---|---|---|---|---|---|';
const FILE = (num) => `${num}-exampleco-2026-10-01.md`;
const REPORT = (num, url, official, { preamble = '', body = '' } = {}) => `# Evaluation: ExampleCo\n\n${preamble}**Score:** ${num === '101' ? '3.7' : '4.0'}/5 | **URL:** ${url} | **PDF:** not generated\n${official ? `**Official employer posting:** ${official}\n` : ''}\n<!-- Machine Summary: fictional test -->\n## A. Summary\nA fictional evaluation.\n${body}\n## Job Description (archived verbatim)\nA fictional posting; no real candidate data.\n`;

async function scenario({ name, urlColumn = false, oldUrl = PRIMARY, oldOfficial = FIRST, newUrl = SECOND, newOfficial, preamble = '', body = '', expected = 2, urlCell = '', newNum = '102', newFile = FILE('102'), oldEntryNum = '101', pending = false }) {
  const root = mkdtempSync(join(tmpdir(), 'tracker-cross-source-'));
  try {
    mkdirSync(join(root, 'data'));
    mkdirSync(join(root, 'reports'));
    const tracker = join(root, 'data', 'applications.md');
    writeFileSync(join(root, 'reports', FILE('101')), REPORT(newFile === FILE('101') ? '102' : '101', oldUrl, oldOfficial, { preamble, body }));
    writeFileSync(tracker, [HEADER.slice(0, -1) + (urlColumn ? ' URL |' : '|'), SEP + (urlColumn ? '---|' : ''),
      `| ${oldEntryNum} | 2026-10-01 | ExampleCo | Product Lead | 3.7/5 | Evaluated | ❌ | [101](../reports/${FILE('101')}) | initial |${urlColumn ? ` ${urlCell} |` : ''}`, ''].join('\n'));
    const payload = { markdown: REPORT('102', newUrl, newOfficial), num: newNum, today: '2026-10-01', company: 'ExampleCo', role: 'Product Lead', score: '4.0/5', url: newUrl, notes: 'fresh evaluation', reportFile: newFile };
    if (newFile === FILE('101')) {
      // A second contribution to an existing report only needs another TSV;
      // the native writer correctly refuses to overwrite that artifact.
      mkdirSync(join(root, 'batch', 'tracker-additions'), { recursive: true });
      writeFileSync(join(root, 'batch', 'tracker-additions', 'same-report.tsv'), trackerTsvLine(payload));
    } else {
      assert.deepEqual(writeEvaluationArtifacts(root, payload), { ok: true });
    }
    const beforeFirstReport = readFileSync(join(root, 'reports', FILE('101')), 'utf8');
    const newReport = readFileSync(join(root, 'reports', newFile), 'utf8');
    const beforeTracker = readFileSync(tracker, 'utf8');
    const additions = join(root, 'batch', 'tracker-additions');
    const pendingFiles = readdirSync(additions).filter(file => file.endsWith('.tsv'));
    const code = await mergeTracker({ appsFile: tracker, dataRoot: root, logger: { log() {}, warn() {}, error() {} } });
    const rows = readFileSync(tracker, 'utf8').split('\n').filter(line => /^\|\s*\d+\s*\|/.test(line));
    assert.equal(code, pending ? 1 : 0, 'merge outcome');
    assert.equal(rows.length, expected, name);
    assert.equal(new Set(rows.map(row => row.split('|')[1].trim())).size, rows.length, 'tracker row IDs remain unique');
    const owners = new Map();
    for (const row of rows) {
      const cells = row.split('|');
      for (const { target } of extractTrackerReportLinks(cells[8], cells[9])) {
        const owner = cells[1].trim();
        assert.ok(!owners.has(target) || owners.get(target) === owner, `native report ${target} cannot belong to two rows`);
        owners.set(target, owner);
      }
    }
    if (expected === 2) {
      assert.ok(rows.some(line => line.includes('3.7/5') && line.includes(FILE('101'))), 'prior score/report remain referenced');
      assert.ok(rows.some(line => line.includes('4.0/5') && line.includes(newFile)), 'new score/report remain referenced');
      assert.equal(new Set(rows.map(row => row.match(/\]\(([^)]+)\)/)?.[1])).size, 2, 'actual report targets remain distinct');
    } else if (pending) {
      assert.equal(readFileSync(tracker, 'utf8'), beforeTracker, 'conflicting report-number addition leaves tracker byte-exact');
      assert.deepEqual(readdirSync(additions).filter(file => file.endsWith('.tsv')), pendingFiles, 'unmerged TSV remains pending');
    } else {
      assert.ok(rows[0].includes('4.0/5') && rows[0].includes(newFile), 'same-posting update reaches its actual report');
    }
    assert.equal(readFileSync(join(root, 'reports', newFile), 'utf8'), newReport, 'merge never edits the new report');
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


// Existing provider parsing owns Workday req formats and repost suffixes. The
// tracker only supplies the stricter tenant/shard/site comparison scope.
const OTHER_PUBLISHER = 'https://www.indeed.com/viewjob?jk=fictional102';
const WORKDAY = 'https://exampleco.wd1.myworkdayjobs.com/External/job/Lisbon/Product-Lead_';
for (const [first, second] of [['R100001', 'R100002'], ['R-123456', 'R-123457'], ['JR_2024_00123', 'JR_2024_00124'], ['10154966', '10154967']]) {
  await scenario({ name: `Workday distinct ${first}/${second} requisitions survive different publishers`, oldOfficial: WORKDAY + first, newUrl: OTHER_PUBLISHER, newOfficial: WORKDAY + second });
}
await scenario({ name: 'Workday location/title changes alone do not imply a different requisition', oldOfficial: WORKDAY + 'R100001', newUrl: OTHER_PUBLISHER, newOfficial: WORKDAY.replace('Lisbon/Product-Lead_', 'Porto/Senior-Product-Lead_') + 'R100001', expected: 1 });
await scenario({ name: 'Workday different site is unknown rather than a comparable conflict', oldOfficial: WORKDAY + 'R100001', newUrl: OTHER_PUBLISHER, newOfficial: WORKDAY.replace('/External/', '/Internal/') + 'R100002', expected: 1 });
await scenario({ name: 'Workday title words are not promoted to requisition IDs', oldOfficial: WORKDAY + 'Manager', newUrl: OTHER_PUBLISHER, newOfficial: WORKDAY + 'Director', expected: 1 });
await scenario({ name: 'same aggregator URL cannot override different declared employer IDs', oldUrl: PRIMARY, newUrl: PRIMARY, urlColumn: true, urlCell: PRIMARY, oldOfficial: FIRST, newOfficial: SECOND });
await scenario({ name: 'a report-derived aggregator URL behind a placeholder cell cannot override different declared employer IDs', oldUrl: PRIMARY, newUrl: PRIMARY, urlColumn: true, urlCell: '—', oldOfficial: FIRST, newOfficial: SECOND });
await scenario({ name: 'same aggregator URL with the same declared employer ID still updates', oldUrl: PRIMARY, newUrl: PRIMARY, urlColumn: true, urlCell: PRIMARY, oldOfficial: FIRST, newOfficial: FIRST, expected: 1 });
await scenario({ name: 'same report number with conflicting identities stays pending without losing either artifact', newUrl: OTHER_PUBLISHER, newOfficial: SECOND, newNum: '101', newFile: '101-exampleco-second-2026-10-01.md', pending: true, expected: 1 });
await scenario({ name: 'same report number with the same employer identity preserves re-evaluation', newUrl: OTHER_PUBLISHER, newOfficial: FIRST, newNum: '101', newFile: '101-exampleco-second-2026-10-01.md', expected: 1 });
await scenario({ name: 'same exact report file stays trusted', newUrl: OTHER_PUBLISHER, newOfficial: FIRST, newNum: '101', newFile: FILE('101'), expected: 1 });
await scenario({ name: 'distinct report numbers with a tracker-ID collision keep both report references', oldEntryNum: '102' });
await scenario({ name: 'a different incoming label cannot give the same file a conflicting report owner', oldUrl: FIRST, newUrl: SECOND, oldOfficial: FIRST, newNum: '900', newFile: FILE('101'), pending: true, expected: 1 });
await scenario({ name: 'a different incoming label preserves same-file same-identity replay', oldUrl: FIRST, newUrl: FIRST, oldOfficial: FIRST, newNum: '900', newFile: FILE('101'), expected: 1 });
await scenario({ name: 'a different incoming report number does not collide with a distinct report target', newNum: '900', newFile: FILE('900') });
