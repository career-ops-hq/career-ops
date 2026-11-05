// tests/outcome-posting-archive-keys.test.mjs — outcome.mjs finds and files a
// row's archived posting by its REPORT number, and archives from the tracker's
// URL column.
//
// Two misses in one block of outcome.mjs:
//
//   - The capture lookup and `archive-posting --report=` used matchedRow.num,
//     the TRACKER #. Captures are named by report number (`{N}-…`, the
//     convention AGENTS.md documents and jd-capture.mjs reads), and the PDF
//     lookup a few lines up already keyed by it. The two numbers differ once any
//     row has no report, so an existing capture was never found, and a fresh
//     one was filed under another application's number.
//   - The URL to archive came from --url or the Notes cell only. merge-tracker
//     writes the posting URL to the URL column (#3516), so a row it added had
//     nothing to archive from and got a "None provided" stub.
//
// archive-posting.mjs would launch Chromium, so a preload wraps
// child_process.execFileSync: calls to it are recorded and fail fast, and
// every other call (set-status) runs for real.
import { pass, fail, rmSync, ROOT, NODE } from './helpers.mjs';
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ok = (name, fn) => { try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); } };

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';

/** Record the outcome for tracker #num; return the outcome dir and archive-posting's recorded calls. */
function outcome(rows, captures, num) {
  const root = mkdtempSync(join(tmpdir(), 'outcome-archive-keys-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'jds'), { recursive: true });
    const tracker = join(root, 'data', 'applications.md');
    writeFileSync(tracker, ['# Applications Tracker', '', HEADER, SEP, ...rows, ''].join('\n'));
    for (const [name, body] of Object.entries(captures)) writeFileSync(join(root, 'jds', name), body);
    const calls = join(root, 'archive-calls.jsonl');
    const preload = join(root, 'preload.mjs');
    writeFileSync(preload, [
      "import cp from 'node:child_process';",
      "import { syncBuiltinESMExports } from 'node:module';",
      "import { appendFileSync } from 'node:fs';",
      'const real = cp.execFileSync;',
      'cp.execFileSync = function (file, args, options) {',
      "  if (Array.isArray(args) && String(args[0]).endsWith('archive-posting.mjs')) {",
      "    appendFileSync(process.env.ARCHIVE_CALLS, JSON.stringify(args.slice(1)) + '\\n');",
      "    throw new Error('archive-posting stubbed in test');",
      '  }',
      '  return real.call(this, file, args, options);',
      '};',
      'syncBuiltinESMExports();',
      '',
    ].join('\n'));
    const r = spawnSync(NODE, ['--import', pathToFileURL(preload).href, join(ROOT, 'outcome.mjs'), String(num), 'rejected', '--json'], {
      cwd: root, encoding: 'utf-8', timeout: 60000,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, CAREER_OPS_DATA_DIR: '', ARCHIVE_CALLS: calls },
    });
    assert.strictEqual(r.status, 0, `outcome exited ${r.status}: ${r.stdout}${r.stderr}`);
    const json = JSON.parse(r.stdout);
    // Read now: the sandbox is removed on the way out.
    const files = {};
    for (const file of ['posting.pdf', 'posting_missing.md']) {
      const p = join(json.outcomeDir, file);
      files[file] = existsSync(p) ? readFileSync(p, 'utf-8') : null;
    }
    const read = (file) => files[file];
    const archiveCalls = existsSync(calls)
      ? readFileSync(calls, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
    return { read, archiveCalls };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const row = (num, report, url) =>
  `| ${num} | 2026-10-01 | Acme | Platform Engineer | 4.2/5 | Applied | ❌ | [${report}](../reports/${String(report).padStart(3, '0')}-acme-2026-10-01.md) | applied | ${url} |`;

console.log('\noutcome.mjs — the posting archive is keyed by report number and reads the URL column');

ok('an existing capture is found by the row\'s report number, not its tracker #', () => {
  // Tracker #5 links report 12; its capture is named for report 12.
  const { read, archiveCalls } = outcome(
    [row(5, 12, '')],
    { '012-2026-10-01_acme_platform-engineer_0123456789abcdef.pdf': '%PDF capture for report 12' },
    5,
  );
  assert.strictEqual(read('posting.pdf'), '%PDF capture for report 12', 'the report-12 capture must be the archived posting');
  assert.deepStrictEqual(archiveCalls, [], 'a capture was found, so nothing is re-archived');
});

ok('with no capture, the posting is archived from the URL column, keyed by report number', () => {
  const url = 'https://job-boards.greenhouse.io/acme/jobs/7007';
  const { read, archiveCalls } = outcome([row(6, 13, `[greenhouse](${url})`)], {}, 6);
  assert.strictEqual(archiveCalls.length, 1, `archive-posting calls: ${JSON.stringify(archiveCalls)}`);
  assert.strictEqual(archiveCalls[0][0], url, 'the URL column is the URL to archive');
  assert.ok(archiveCalls[0].includes('--report=13'), `filed under report 13: ${JSON.stringify(archiveCalls[0])}`);
  // The stubbed archive fails, so the stub records the URL it tried.
  assert.ok((read('posting_missing.md') ?? '').includes(`**URL**: ${url}`), read('posting_missing.md'));
});
