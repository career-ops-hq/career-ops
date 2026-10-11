// tests/batch-evaluate-gemini-pipeline-merge.test.mjs — the end of a
// batch-evaluate-gemini run must merge its results into the CURRENT
// data/pipeline.md under the pipeline lock, not write back the copy it read
// when the run started.
//
// A run takes minutes (liveness check + model call per offer). scan.mjs,
// plugins.mjs and agent-inbox.mjs append to the same file meanwhile, and
// scan.mjs has already recorded each appended offer in scan-history.tsv, so an
// offer erased by the final write is never queued again.
//
// No Playwright and no model: the merge is the exported finishPipelineBatch /
// mergeProcessedLines pair, driven with hand-built results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishPipelineBatch, mergeProcessedLines } from '../batch-evaluate-gemini.mjs';
import { lockDirFor, withPipelineLock } from '../pipeline-lock.mjs';
import { appendToPipeline } from '../scan.mjs';

const PENDING = [
  '- [ ] https://example.test/job/1 | Co1 | Role 1',
  '- [ ] https://example.test/job/2 | Co2 | Role 2',
  '- [ ] https://example.test/job/3 | Co3 | Role 3',
];
const done = (line) => line.replace('- [ ]', '- [x]');

function workdir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cops-gemini-merge-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'pipeline.md');
}

// The start-of-run snapshot is the file split on '\n', exactly as main() reads it.
const snapshotOf = (text) => text.split('\n');

test('an offer appended during the run survives; only processed lines change', async (t) => {
  const path = workdir(t);
  const start = ['# Pipeline', '', '## Pending', ...PENDING, ''].join('\n');
  const snapshot = snapshotOf(start);
  const results = new Map([
    [3, { line: done(PENDING[0]), processed: true }],
    [4, { line: PENDING[1], processed: false }],
    [5, { line: done(PENDING[2]), processed: true }],
  ]);

  const appended = '- [ ] https://example.test/job/NEW-SCAN-HIT | ScanCo | Staff Engineer';
  writeFileSync(path, ['# Pipeline', '', '## Pending', ...PENDING, appended, ''].join('\n'), 'utf-8');

  await finishPipelineBatch(path, snapshot, results);

  assert.equal(readFileSync(path, 'utf-8'), [
    '# Pipeline', '', '## Pending',
    done(PENDING[0]), PENDING[1], done(PENDING[2]),
    appended, '',
  ].join('\n'));
});

test('a pending line edited during the run is left alone and does not stop the merge', async (t) => {
  const path = workdir(t);
  const snapshot = snapshotOf(['## Pending', ...PENDING, ''].join('\n'));
  const results = new Map([
    [1, { line: done(PENDING[0]), processed: true }],
    [2, { line: done(PENDING[1]), processed: true }],
    [3, { line: done(PENDING[2]), processed: true }],
  ]);

  const edited = '- [ ] https://example.test/job/2 | Co2 | Role 2 (edited by hand)';
  writeFileSync(path, ['## Pending', PENDING[0], edited, PENDING[2], ''].join('\n'), 'utf-8');

  const warnings = [];
  t.mock.method(console, 'error', (message) => { warnings.push(String(message)); });
  await finishPipelineBatch(path, snapshot, results);

  assert.equal(readFileSync(path, 'utf-8'),
    ['## Pending', done(PENDING[0]), edited, done(PENDING[2]), ''].join('\n'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /https:\/\/example\.test\/job\/2\b/);
});

test('CRLF line endings and a missing final newline are preserved', () => {
  const crlf = ['## Pending', ...PENDING, ''].join('\r\n');
  const results = new Map([[1, { line: done(PENDING[0]) + '\r', processed: true }]]);
  const merged = mergeProcessedLines(crlf, snapshotOf(crlf), results);
  assert.equal(merged.text, ['## Pending', done(PENDING[0]), PENDING[1], PENDING[2], ''].join('\r\n'));
  assert.deepEqual(merged.unmatched, []);

  const bare = ['## Pending', ...PENDING].join('\n');
  const lastIdx = snapshotOf(bare).length - 1;
  const last = new Map([[lastIdx, { line: done(PENDING[2]), processed: true }]]);
  const mergedBare = mergeProcessedLines(bare, snapshotOf(bare), last);
  assert.equal(mergedBare.text, ['## Pending', PENDING[0], PENDING[1], done(PENDING[2])].join('\n'));
});

test('finishPipelineBatch waits for a held pipeline lock and merges into what the holder wrote', async (t) => {
  const path = workdir(t);
  const start = ['# Pipeline', '', '## Pending', PENDING[0], PENDING[1], ''].join('\n');
  writeFileSync(path, start, 'utf-8');
  const snapshot = snapshotOf(start);
  const results = new Map([
    [3, { line: done(PENDING[0]), processed: true }],
    [4, { line: PENDING[1], processed: false }],
  ]);

  const offer = { url: 'https://example.test/job/NEW-SCAN-HIT', company: 'ScanCo', title: 'Staff Engineer', location: 'Remote', source: 'scan' };

  // Both writers start while the lock is held, so both are waiters on a lock
  // they cannot take; neither may touch the file until it is released.
  let finishing;
  let scan;
  await withPipelineLock(path, async () => {
    finishing = finishPipelineBatch(path, snapshot, results);
    scan = appendToPipeline([offer], { pipelinePath: path });

    const state = await Promise.race([
      finishing.then(() => 'finished'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 300)),
    ]);
    assert.equal(state, 'pending', 'finishPipelineBatch is still waiting for the lock');
    assert.equal(readFileSync(path, 'utf-8'), start, 'nothing is written while the lock is held');
  });

  // The waiters take the lock in either order; the merge holds for both.
  await finishing;
  await scan;

  const lines = readFileSync(path, 'utf-8').split('\n');
  assert.ok(lines.includes(done(PENDING[0])), 'processed offer is marked done');
  assert.ok(lines.includes(PENDING[1]), 'unprocessed offer stays pending');
  assert.equal(lines.filter((l) => l.includes(offer.url)).length, 1, 'the scanned offer is present once');
  assert.ok(!lines.includes(PENDING[0]), 'no stale pending copy of the processed offer');
  assert.equal(existsSync(lockDirFor(path)), false);
});
