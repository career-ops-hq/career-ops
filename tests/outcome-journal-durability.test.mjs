// Confirmed outcomes must retain the append-only journal through races and I/O errors.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, realpathSync, chmodSync, statSync } from 'node:fs';
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
if (process.platform !== 'win32') chmodSync(journal, 0o600);
const hook = join(root, 'journal-io.mjs');
writeFileSync(hook, `import fs from 'node:fs';
process.umask(0o022);
import { basename, dirname } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync, write = fs.writeFileSync, mkdir = fs.mkdirSync;
fs.mkdirSync = (file, ...args) => {
  try { return mkdir(file, ...args); } catch (err) {
    if (process.env.ORDER_CONTENDED && String(file) === process.env.JOURNAL + '.lock' && ['EEXIST', 'EPERM', 'EACCES', 'EBUSY'].includes(err.code) && fs.existsSync(file)) {
      write(process.env.ORDER_CONTENDED, 'contended');
    }
    throw err;
  }
};
fs.readFileSync = (file, ...args) => {
  const bytes = read(file, ...args);
  if (String(file) === process.env.JOURNAL && !process.env.FAIL_JOURNAL_WRITE) {
    if (process.env.ORDER_SIGNAL) write(process.env.ORDER_SIGNAL, 'ready');
    if (process.env.ORDER_WAIT_FOR) {
      const deadline = Date.now() + 10000;
      while (!fs.existsSync(process.env.ORDER_WAIT_FOR)) {
        if (Date.now() >= deadline) throw new Error('second writer did not contend for the journal lock');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    } else {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.ORDER_DELAY_MS ?? 500));
    }
  }
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
const record = (feedback, extra = {}, type = 'interview_progress') => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', pathToFileURL(hook).href, join(ROOT, 'outcome.mjs'), '1', type, '--feedback', feedback, '--json'], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  if (process.platform !== 'win32') check('restricted journal permissions survive concurrent replacement', () => {
    assert.equal(statSync(journal).mode & 0o777, 0o600);
  });
  const beforeRetry = readFileSync(journal, 'utf8');
  const retry = await record(feedbacks[0]);
  check('retry remains idempotent after concurrent recordings', () => {
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(readFileSync(journal, 'utf8'), beforeRetry);
  });
  const signal = join(root, 'ordering-read');
  const contended = join(root, 'ordering-contended');
  const first = record('ordering interview feedback', { ORDER_SIGNAL: signal, ORDER_WAIT_FOR: contended });
  const deadline = Date.now() + 5000;
  while (!readdirSync(root).includes('ordering-read') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const orderingReady = readdirSync(root).includes('ordering-read');
  if (!orderingReady) {
    await first;
    assert.fail('first writer did not reach the journal before the ordering deadline');
  }
  const second = record('ordering offer feedback', { ORDER_DELAY_MS: '0', ORDER_CONTENDED: contended }, 'offer_received');
  const orderedResults = await Promise.all([first, second]);
  check('different outcome states retain tracker and journal ordering during overlap', () => {
    for (const result of orderedResults) assert.equal(result.status, 0, result.stderr);
    assert.ok(readdirSync(root).includes('ordering-contended'), 'second writer encountered the held journal lock');
    const text = readFileSync(journal, 'utf8');
    const states = [...text.matchAll(/\*\*Canonical State\*\*: ([^\n]+)/g)].map(match => match[1]);
    const trackerState = readFileSync(tracker, 'utf8').split('\n').find(line => /^\|\s*1\s*\|/.test(line)).split('|')[6].trim();
    assert.equal(states.at(-1), trackerState);
    assert.equal(states.at(-1), 'Offer');
    const interviewIndex = text.indexOf('> ordering interview feedback\n');
    const offerIndex = text.indexOf('> ordering offer feedback\n');
    assert.notEqual(interviewIndex, -1, 'interview feedback is retained');
    assert.notEqual(offerIndex, -1, 'offer feedback is retained');
    assert.ok(interviewIndex < offerIndex);
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
