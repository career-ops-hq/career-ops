import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { openTrackerTransaction } from '../tracker-utils.mjs';

const header = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
const original = '| 1 | 2026-06-01 | Acme | Backend Engineer | 4/5 | Applied | - | - | |\n';

async function review(change, expectsConflict = true) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-reply-identity-'));
  let child, timer;
  try {
    mkdirSync(join(root, 'data'));
    const tracker = join(root, 'data', 'applications.md');
    const candidates = join(root, 'data', 'reply-candidates.json');
    writeFileSync(tracker, header + original);
    writeFileSync(candidates, JSON.stringify([{
      message_id: 'fixture-interview', from: 'careers@acme.com',
      subject: 'Acme Backend Engineer', body_snippet: 'We invite you to interview.',
    }]));
    child = spawn(NODE, [join(ROOT, 'reply-watch.mjs'), candidates], {
      cwd: root, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_TRACKER: tracker },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', changed = false;
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => { child.kill(); reject(new Error('review did not finish')); }, 15_000);
      child.on('error', reject);
      child.stderr.on('data', data => { stderr += data; });
      child.stdout.on('data', async data => {
        stdout += data;
        if (changed || !stdout.includes('Apply recommended status updates')) return;
        changed = true;
        try {
          // A second authorized writer changes the row while the human prompt is open.
          const transaction = await openTrackerTransaction(tracker);
          try { transaction.replace(header + change(original)); }
          finally { transaction.close(); }
          child.stdin.end('y\n');
        } catch (error) { child.kill(); reject(error); }
      });
      child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(changed, true, result.stdout);
    assert.equal(readFileSync(tracker, 'utf8'), header + change(original), 'must preserve the concurrent writer');
    assert.equal(existsSync(join(root, 'data', 'status-log.tsv')), false, 'must not log an unapproved replacement row');
    if (expectsConflict) {
      assert.match(result.stderr, /tracker row changed or became ambiguous during review/);
    } else {
      assert.doesNotMatch(result.stderr, /tracker row changed or became ambiguous during review/);
      assert.match(result.stdout, /No change for #1: already Interview/);
    }
  } finally {
    clearTimeout(timer);
    child?.kill();
    rmSync(root, { recursive: true, force: true });
  }
}

for (const [field, change] of [
  ['company', row => row.replace('Acme', 'Other Employer')],
  ['role', row => row.replace('Backend Engineer', 'Other Role')],
  ['date', row => row.replace('2026-06-01', '2026-06-02')],
  ['report', row => row.replace('| - | - |', '| - | [9](reports/9-acme.md) |')],
  ['notes', row => row.replace('| - | - | |', '| - | - | Concurrent note |')],
  ['duplicate identity', row => row + row.replace('Acme', 'Other Employer')],
  ['already-current replacement', row => row.replace('Acme', 'Other Employer').replace('| Applied |', '| Interview |')],
]) {
  const label = `legacy reply review refuses a concurrent ${field} change`;
  try {
    await review(change);
    pass(label);
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
}

try {
  await review(row => row.replace('| Applied |', '| Interview |'), false);
  pass('an unchanged application already updated by another writer remains a no-op');
} catch (error) {
  fail(`an unchanged application already updated by another writer remains a no-op: ${error.message}`);
}
