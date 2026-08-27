import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ROOT, NODE, rmSync } from './helpers.mjs';

const SCRIPT = join(ROOT, 'reply-watch.mjs');

function setupWorkspace() {
  const tmp = mkdtempSync(join(tmpdir(), 'career-ops-reply-watch-'));
  const dataDir = join(tmp, 'data');
  mkdirSync(dataDir, { recursive: true });
  
  const trackerFile = join(dataDir, 'applications.md');
  const trackerHeader = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n';
  writeFileSync(trackerFile, trackerHeader + '| 1 | 2026-06-01 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | - | |\n| 2 | 2026-06-01 | Beta | Backend Engineer | 4.0/5 | Applied | ❌ | - | |\n');

  return { tmp, dataDir, trackerFile };
}

function runReplyWatch(tmp, trackerFile, candidatesFile = null, input = '') {
  const args = candidatesFile ? [candidatesFile] : [];
  return spawnSync(NODE, [SCRIPT, ...args], {
    cwd: tmp,
    input,
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, CAREER_OPS_TRACKER: trackerFile }
  });
}

test('status-log.tsv is created and appended on a confirmed tracker update', () => {
  const { tmp, dataDir, trackerFile } = setupWorkspace();
  const candFile = join(tmp, 'cands.json');
  writeFileSync(candFile, JSON.stringify([{
    message_id: 'm1',
    from: 'hr@acme.com',
    subject: 'Acme — Backend Engineer',
    body_snippet: 'We would like to invite you to interview.',
  }]));

  const res = runReplyWatch(tmp, trackerFile, candFile, 'y\n');
  assert.equal(res.status, 0, res.stderr);

  const trackerContent = readFileSync(trackerFile, 'utf-8');
  assert.match(trackerContent, /\| 1 \|.+?\| Interview \|/);

  const logFile = join(dataDir, 'status-log.tsv');
  assert.ok(existsSync(logFile), 'status-log.tsv should be created');
  const logContent = readFileSync(logFile, 'utf-8').trim().split('\n');
  assert.equal(logContent.length, 1);
  assert.match(logContent[0], /^1\t\d{4}-\d{2}-\d{2}\tApplied\tInterview\treply-watch\t?$/);

  rmSync(tmp, { recursive: true, force: true });
});

test('No status-log entry is written on a no-op re-run', () => {
  const { tmp, dataDir, trackerFile } = setupWorkspace();
  const candFile = join(tmp, 'cands.json');
  writeFileSync(candFile, JSON.stringify([{
    message_id: 'm1',
    from: 'hr@acme.com',
    subject: 'Acme — Backend Engineer',
    body_snippet: 'We would like to invite you to interview.',
  }]));

  // Run 1
  runReplyWatch(tmp, trackerFile, candFile, 'y\n');
  const logFile = join(dataDir, 'status-log.tsv');
  const logContent1 = readFileSync(logFile, 'utf-8').trim().split('\n');
  assert.equal(logContent1.length, 1);

  // Run 2
  const res2 = runReplyWatch(tmp, trackerFile, candFile, 'y\n');
  assert.equal(res2.status, 0);

  const logContent2 = readFileSync(logFile, 'utf-8').trim().split('\n');
  assert.equal(logContent2.length, 1, 'No duplicate entry for alreadyCurrent');

  rmSync(tmp, { recursive: true, force: true });
});

test('Status-log append failure does not abort the tracker update', () => {
  const { tmp, dataDir, trackerFile } = setupWorkspace();
  const candFile = join(tmp, 'cands.json');
  writeFileSync(candFile, JSON.stringify([{
    message_id: 'm1',
    from: 'hr@acme.com',
    subject: 'Acme — Backend Engineer',
    body_snippet: 'We would like to invite you to interview.',
  }]));

  const logFile = join(dataDir, 'status-log.tsv');
  // Make log file a directory so appendFileSync fails
  mkdirSync(logFile);

  const res = runReplyWatch(tmp, trackerFile, candFile, 'y\n');
  assert.equal(res.status, 0);
  assert.match(res.stderr || res.stdout, /failed to append to status-log\.tsv/);

  // Tracker is still updated
  const trackerContent = readFileSync(trackerFile, 'utf-8');
  assert.match(trackerContent, /\| 1 \|.+?\| Interview \|/);

  rmSync(tmp, { recursive: true, force: true });
});

test('reply-watch.mjs with no candidates prints the count line and exits 0', () => {
  const { tmp, trackerFile } = setupWorkspace();
  const candFile = join(tmp, 'empty.json');
  writeFileSync(candFile, JSON.stringify([]));

  const res = runReplyWatch(tmp, trackerFile, candFile);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /0 application updates need review/);

  rmSync(tmp, { recursive: true, force: true });
});

test('reply-watch.mjs skips Noise candidates from status recommendations', () => {
  const { tmp, dataDir, trackerFile } = setupWorkspace();
  const candFile = join(tmp, 'noise.json');
  writeFileSync(candFile, JSON.stringify([{
    message_id: 'm1',
    from: 'alerts@zhaopin.com',
    subject: 'Zhaopin job alert for Acme',
    body_snippet: 'We recommend these jobs: Acme - Backend Engineer. 立即投递！',
  }]));

  const res = runReplyWatch(tmp, trackerFile, candFile);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /Type: Noise/);
  assert.doesNotMatch(res.stdout, /Suggested status updates to apply:/);

  const trackerContent = readFileSync(trackerFile, 'utf-8');
  assert.doesNotMatch(trackerContent, /\| Interview \|/);

  rmSync(tmp, { recursive: true, force: true });
});
