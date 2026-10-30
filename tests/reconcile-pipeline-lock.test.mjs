// reconcile-pipeline.mjs must take the pipeline lock around its read → compute
// → write (#4895). It used to read pipeline.md, rebuild it, and write it back
// with no lock, so an offer scan.mjs appended in between was silently
// overwritten — and the .pre-reconcile.bak, copied before the append, did not
// have it either.
//
// The test plays the scan: it takes the lock, reads the file, waits while
// reconcile runs, then writes back what it read plus a new offer. Unlocked,
// reconcile finishes inside that window and the scan's write replaces its
// move. Locked, reconcile waits, then reconciles the file the scan left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquirePipelineLock } from '../pipeline-lock.mjs';

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'reconcile-pipeline.mjs');
const DONE_URL = 'https://jobs.example.test/4521';
const SCANNED_URL = 'https://jobs.example.test/9001';

test('an offer appended under the lock during a reconcile run survives it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-reconcile-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['data', 'batch', 'reports']) mkdirSync(join(root, dir));
  const pipeline = join(root, 'data', 'pipeline.md');
  const state = join(root, 'batch', 'batch-state.tsv');
  writeFileSync(pipeline, `# Pipeline\n\n## Pending\n\n- [ ] ${DONE_URL} | Example | Engineer\n\n## Processed\n\n`);
  writeFileSync(state,
    `id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\t${DONE_URL}\tcompleted\t2026-09-01\t2026-09-01\t42\t4.2\t\t0\n`);
  writeFileSync(join(root, 'reports', '042-example-2026-09-01.md'), '**Score:** 4.2/5\n');

  const lock = await acquirePipelineLock(pipeline);
  let child;
  let released = false;
  try {
    const scanRead = readFileSync(pipeline, 'utf-8');

    child = spawn(process.execPath, [SCRIPT, '--pipeline', pipeline, '--state', state], {
      cwd: root,
      env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root, CAREER_OPS_TRACKER: '' },
    });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));

    // Long enough for an unlocked reconcile to start, read and write; well
    // under the lock's 8s acquisition timeout, so a locked one just waits.
    const finishedEarly = await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    assert.equal(finishedEarly, false, `reconcile ran while the pipeline lock was held:\n${output}`);

    writeFileSync(pipeline, scanRead.replace(
      `| Example | Engineer\n`,
      `| Example | Engineer\n- [ ] ${SCANNED_URL} | Scanned | Analyst\n`,
    ));
    lock.release();
    released = true;

    const code = await exited;
    assert.equal(code, 0, output);
  } finally {
    if (!released) lock.release();
    if (child && child.exitCode === null) child.kill();
  }

  const text = readFileSync(pipeline, 'utf-8');
  assert.match(text, new RegExp(`^- \\[ \\] ${SCANNED_URL} \\| Scanned \\| Analyst$`, 'm'), 'the scanned offer was lost');
  assert.match(text, new RegExp(`^- \\[x\\] .*\\| ${DONE_URL} \\| Example \\| Engineer \\| 4\\.2/5`, 'm'), 'the batch entry was not moved');
  assert.doesNotMatch(text, new RegExp(`^- \\[ \\] ${DONE_URL}`, 'm'), 'the batch entry is still pending');
});
