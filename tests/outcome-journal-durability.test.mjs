// Confirmed outcomes must retain the append-only journal through races and I/O errors.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, pass, fail } from './helpers.mjs';

function check(label, fn) {
  try { fn(); pass(label); } catch (err) { fail(`${label}: ${err.message}`); process.exitCode = 1; }
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'career-ops-outcome-journal-')));
const data = join(root, 'data');
const dir = join(data, 'outcomes', '1_fictional_engineer');
mkdirSync(dir, { recursive: true });
const tracker = join(data, 'applications.md');
writeFileSync(tracker, '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-01-05 | Fictional | Engineer | 4/5 | Interview | — | — | notes |\n');
writeFileSync(join(dir, 'submitted_cv.md'), '# Fictional CV\n');
const journal = join(dir, 'outcome.md');
const previous = '# Previous outcome history\n\n## Entry: 2026-01-01\n- **Outcome Type**: applied\n';
writeFileSync(journal, previous);
const hook = join(root, 'journal-io.mjs');
writeFileSync(hook, `import fs from 'node:fs';
import { basename, dirname } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync, write = fs.writeFileSync;
fs.readFileSync = (file, ...args) => {
  const bytes = read(file, ...args);
  if (String(file) === process.env.JOURNAL && !process.env.FAIL_JOURNAL_WRITE) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  return bytes;
};
fs.writeFileSync = (file, bytes, ...args) => {
  if (process.env.FAIL_JOURNAL_WRITE && dirname(String(file)) === dirname(process.env.JOURNAL) && (String(file) === process.env.JOURNAL || basename(String(file)).startsWith('.outcome.md.'))) {
    write(file, String(bytes).slice(0, 8), ...args);
    throw Object.assign(new Error('simulated disk full during journal write'), { code: 'ENOSPC' });
  }
  return write(file, bytes, ...args);
};
syncBuiltinESMExports();\n`);
const env = { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker, JOURNAL: journal };
const record = (feedback, extra = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'outcome.mjs'), '1', 'interview_progress', '--feedback', feedback, '--json'], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => stdout += bytes);
  child.stderr.on('data', bytes => stderr += bytes);
  child.on('error', reject);
  child.on('close', status => resolve({ status, stdout, stderr }));
});

try {
  const feedbacks = ['first recruiter feedback', 'second recruiter feedback', 'third recruiter feedback', 'fourth recruiter feedback'];
  const results = await Promise.all(feedbacks.map(feedback => record(feedback)));
  check('every successful concurrent outcome retains its feedback and previous history', () => {
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    const text = readFileSync(journal, 'utf8');
    assert.ok(text.startsWith(previous));
    for (const feedback of feedbacks) assert.equal(text.split(`> ${feedback}\n`).length - 1, 1, feedback);
  });
  const beforeRetry = readFileSync(journal, 'utf8');
  const retry = await record(feedbacks[0]);
  check('retry remains idempotent after concurrent recordings', () => {
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(readFileSync(journal, 'utf8'), beforeRetry);
  });
  const beforeFailure = readFileSync(journal, 'utf8');
  const failed = await record('feedback that cannot be saved', { FAIL_JOURNAL_WRITE: '1' });
  check('partial journal write failure leaves the entire prior journal intact', () => {
    assert.equal(failed.status, 1);
    assert.equal(readFileSync(journal, 'utf8'), beforeFailure);
    assert.match(failed.stderr + failed.stdout, /journal-write-failed|journal could not be saved/);
    assert.deepEqual(readdirSync(dir).filter(name => name.startsWith('.outcome.md.') || name.endsWith('.lock')), []);
  });
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 10 });
}
