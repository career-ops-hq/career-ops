#!/usr/bin/env node
// tests/run-discovered-child.mjs — run ONE discovered pass/fail-style suite in
// its own process, for `test-all.mjs --jobs N` with N > 1.
//
// With --jobs 1 test-all.mjs imports every discovered suite into its own
// process, one after another, and they share its counters. To run several at
// once each suite needs a process of its own, and its counters have to get back
// to the parent. This is that process: import the suite, then hand results() to
// the parent through a file.
//
//   node tests/run-discovered-child.mjs <suite.test.mjs> <result.json> [--quick]
//
// The suite's own output goes to stdout/stderr as usual; the parent captures it
// and prints it when this suite's turn comes, so a parallel run reads in the
// same order as a serial one.
//
// A FILE, not a trailer line on stdout: the result is written from the 'exit'
// handler so it includes assertions made by async work the suite did not await,
// and a synchronous file write is the one thing that is guaranteed to complete
// there. The parent treats a missing file as a suite that died.
//
// node:test suites do not come through here; the parent runs those with
// `node --test`, as the serial path does.
import { writeFileSync } from 'fs';
import { importSuiteContained, results, ROOT } from './helpers.mjs';

// How long a suite may keep the process alive after its import has resolved.
// In a serial run a suite that leaves a handle open (a server it never closed,
// a timer) costs nothing: the next suite starts, and finish() exits the process
// at the very end. Alone in a process, the same suite would never exit. The
// timer is unref'd, so a suite with nothing left to do exits immediately and
// only one that lingers waits this long before it is cut off and reported.
const LINGER_GRACE_MS = 3000;

const [suite, resultFile] = process.argv.slice(2);
if (!suite || !resultFile) {
  console.error('usage: node tests/run-discovered-child.mjs <suite.test.mjs> <result.json> [--quick]');
  process.exitCode = 2;
} else {
  let lingered = false;
  process.on('exit', () => {
    try {
      writeFileSync(resultFile, JSON.stringify({ ...results(), lingered }));
    } catch {
      // Nothing to report to: the parent reads a missing file as a dead suite.
    }
  });

  // The same import the in-process loop makes, throw containment included.
  await importSuiteContained(suite, suite.startsWith(ROOT) ? suite.slice(ROOT.length + 1) : suite);

  setTimeout(() => {
    lingered = true;
    // exit(), not exitCode: something is holding the loop open, which is the
    // reason this timer fired at all.
    process.exit(process.exitCode ?? 0);
  }, LINGER_GRACE_MS).unref();
}
