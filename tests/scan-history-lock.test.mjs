// tests/scan-history-lock.test.mjs — appendToScanHistory() must write
// data/scan-history.tsv under the same lock appendToPipeline() uses.
//
// scan.mjs, scan-ats-full.mjs, scan-interamt.mjs and plugins.mjs all append to
// this one file, which is why appendToPipeline() takes a lock. scan-history
// took none, leaving two races (#2600):
//
//   - The create branch is check-then-write, and its writeFileSync truncates.
//     Two scanners starting against a missing file both take the branch; the
//     loser's header write lands on top of rows the winner already appended
//     and erases them.
//   - A multi-row appendFileSync is not atomic, so two appends can interleave
//     inside a line.
//
// Neither throws. Every scan-history reader skips a malformed line quietly, so
// the damage shows up as postings that silently stop counting for dedup.
//
// This asserts lock PARTICIPATION rather than trying to lose the race on
// purpose: a held lock must block the write. Racing it directly is not a
// usable test — both windows are microseconds wide, and an earlier draft that
// spawned ten barrier-synchronized writers caught the unlocked version once in
// eight runs, which is a coin flip wearing a lab coat. Mutual exclusion itself
// is already covered by test/pipeline-lock.test.mjs; what is new here is that
// this writer takes part at all, and that is deterministic.
//
// The writer runs in a child process because discovered suites share one
// process (and one module cache) with the rest of test-all, so scan.mjs may
// already be imported with its real SCAN_HISTORY_PATH baked in.
import { pass, fail, NODE } from './helpers.mjs';
import { execFile } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { acquirePipelineLock } from '../pipeline-lock.mjs';

const execFileAsync = promisify(execFile);

console.log('\nscan-history.tsv writes — appendToScanHistory holds the shared lock');

const HEADER_PREFIX = 'url\tfirst_seen\t';
const LOCK_TIMEOUT_MS = 600;
const URL_BASE = 'https://example.test/';

/** The url column of each row — column 0, exact, never a substring test. */
const urlColumn = (rows) => rows.map(l => l.split('\t')[0]);

const root = mkdtempSync(join(tmpdir(), 'career-ops-scan-history-'));
const historyPath = join(root, 'data', 'scan-history.tsv');

// argv is read from the end: node's arg layout after -e differs from a script
// run, and the suite has to behave the same on every supported Node.
const writerSource = `
  const [scanUrl, writer] = process.argv.slice(-2);
  const { appendToScanHistory } = await import(scanUrl);
  await appendToScanHistory([{
    url: '${URL_BASE}' + writer,
    source: 'testportal',
    title: 'Engineer',
    company: 'Acme',
    location: 'Remote',
  }], '2026-08-09', 'added');
`;

// cwd is the scratch root, not the repo: scan.mjs resolves its data paths
// relative to cwd, so a writer that ignored CAREER_OPS_SCAN_HISTORY still
// lands in the temp dir rather than the developer's real data/.
const runWriter = (writer) =>
  execFileAsync(NODE, ['--input-type=module', '-e', writerSource, '--', new URL('../scan.mjs', import.meta.url).href, writer], {
    cwd: root,
    env: {
      ...process.env,
      CAREER_OPS_SCAN_HISTORY: historyPath,
      CAREER_OPS_PIPELINE_LOCK_TIMEOUT_MS: String(LOCK_TIMEOUT_MS),
      CAREER_OPS_PIPELINE_LOCK_RETRY_MS: '20',
    },
  });

try {
  // 1. While another process holds the lock on scan-history.tsv, a writer must
  //    wait it out and fail, not write. An unlocked appendToScanHistory ignores
  //    the lock entirely and creates the file here.
  const held = await acquirePipelineLock(historyPath, { timeoutMs: 2000, retryMs: 20 });
  let blocked = false;
  try {
    await runWriter('blocked');
    blocked = false;
  } catch {
    blocked = true; // LockTimeoutError propagates as a non-zero exit
  } finally {
    const wroteAnyway = existsSync(historyPath)
      && new Set(urlColumn(readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean))).has(`${URL_BASE}blocked`);
    wroteAnyway
      ? fail('wrote scan-history.tsv while another process held its lock — the append is unlocked')
      : pass('a held lock blocks the scan-history write instead of letting it through');
    if (!wroteAnyway && !blocked) {
      fail('writer exited cleanly without writing — expected it to wait for the lock and time out');
    }
    held.release();
  }

  // 2. With the lock free, the same write succeeds: the fix must not simply
  //    break the writer.
  await runWriter('free');
  const lines = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
  const headers = lines.filter(l => l.startsWith(HEADER_PREFIX));
  const rows = lines.filter(l => !l.startsWith(HEADER_PREFIX));

  // Compare the url COLUMN exactly rather than testing the line for a
  // substring: an exact field match is the stronger assertion, and a substring
  // check against a URL is the shape CodeQL flags as incomplete sanitization.
  headers.length === 1 && rows.length === 1 && urlColumn(rows)[0] === `${URL_BASE}free`
    ? pass('once the lock is free the row is written, under a single header')
    : fail(`expected 1 header + 1 row after release, got ${headers.length} header(s) and ${rows.length} row(s)`);

  // 3. A second writer appends rather than truncating — the create branch must
  //    stay a create branch once the file exists.
  await runWriter('second');
  const after = readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
  const urls = new Set(urlColumn(after.filter(l => !l.startsWith(HEADER_PREFIX))));
  after.filter(l => l.startsWith(HEADER_PREFIX)).length === 1
    && urls.has(`${URL_BASE}free`)
    && urls.has(`${URL_BASE}second`)
    ? pass('a later write appends under the existing header instead of rewriting it')
    : fail(`expected both rows under one header, got ${JSON.stringify(after)}`);
} catch (err) {
  fail(`scan-history lock test threw: ${err?.message ?? err}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
