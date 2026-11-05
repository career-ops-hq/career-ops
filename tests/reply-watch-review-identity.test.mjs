import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pass, fail, ROOT, NODE, rmSync, DEFAULT_SCRIPT_TIMEOUT_MS } from './helpers.mjs';
import { openTrackerTransaction } from '../tracker-utils.mjs';

const header = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
const original = '| 1 | 2026-06-01 | Acme | Backend Engineer | 4/5 | Applied | - | - | |\n';

// One review is a chain of cold Node starts: reply-watch up to its prompt,
// then, after the answer, set-status and `tracker.mjs sync`, each run by
// reply-watch with execFileSync. A case normally takes about a second on the
// Windows runner, but a flat 15s for the whole chain has run out there, in a
// different case each time: an occasional stall, not the usual pace. Each
// phase gets the per-script budget run() uses, which rides out a short stall,
// and a timeout names the phase it was in, with the child's output, so the
// next stall shows where it happens.
const PHASE_BUDGET_MS = DEFAULT_SCRIPT_TIMEOUT_MS;

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
    const startedAt = Date.now();
    let answeredAt = null;
    const result = await new Promise((resolve, reject) => {
      const arm = phase => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          child.kill();
          reject(new Error(`review did not finish: still ${phase} after ${PHASE_BUDGET_MS}ms `
            + `(${Date.now() - startedAt}ms in all)\nstdout: ${stdout}\nstderr: ${stderr}`));
        }, PHASE_BUDGET_MS);
      };
      arm('waiting for the review prompt');
      child.on('error', reject);
      child.stderr.on('data', data => { stderr += data; });
      child.stdout.on('data', async data => {
        stdout += data;
        if (changed || !stdout.includes('Apply recommended status updates')) return;
        changed = true;
        arm('changing the tracker as the second writer');
        try {
          // A second authorized writer changes the row while the human prompt is open.
          const transaction = await openTrackerTransaction(tracker);
          try { transaction.replace(header + change(original)); }
          finally { transaction.close(); }
          answeredAt = Date.now();
          arm('applying the answer (set-status, then tracker sync)');
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
    return `answered after ${answeredAt - startedAt}ms, exit ${Date.now() - answeredAt}ms later`;
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
    const timing = await review(change);
    pass(`${label} (${timing})`);
  } catch (error) {
    fail(`${label}: ${error.message}`);
  }
}

try {
  const timing = await review(row => row.replace('| Applied |', '| Interview |'), false);
  pass(`an unchanged application already updated by another writer remains a no-op (${timing})`);
} catch (error) {
  fail(`an unchanged application already updated by another writer remains a no-op: ${error.message}`);
}
