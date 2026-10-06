import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, NODE } from './helpers.mjs';

const REPLY_WATCH = join(ROOT, 'reply-watch.mjs');
const CONTACT_EXTRACT = join(ROOT, 'contact-extract.mjs');

const LEGACY_BULLET = '- 2026-07-02 · #42 Acme — resent to careers@acme.com';
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|';

function setupWorkspace(followupsContents) {
  const tmp = mkdtempSync(join(tmpdir(), 'co-followups-shared-'));
  const dataDir = join(tmp, 'data');
  mkdirSync(dataDir, { recursive: true });
  const trackerFile = join(dataDir, 'applications.md');
  writeFileSync(trackerFile, `${HEADER}\n| 42 | 2026-06-01 | ? | Backend Engineer | 4.0/5 | Applied | ❌ | - | |\n`);
  writeFileSync(join(dataDir, 'follow-ups.md'), followupsContents);
  return { tmp, dataDir, trackerFile };
}

function runCli(script, tmp, dataDir, trackerFile, extra = [], input = 'n\n') {
  const res = spawnSync(NODE, [script, ...extra], {
    cwd: tmp,
    encoding: 'utf-8',
    timeout: 30000,
    input,
    env: {
      ...process.env,
      CAREER_OPS_TRACKER: trackerFile,
      CAREER_OPS_DATA_DIR: dataDir,
      CAREER_OPS_ROOT: dataDir,
    },
  });
  return res;
}

test('reply-watch: a legacy bullet reaches the matcher', () => {
  const { tmp, dataDir, trackerFile } = setupWorkspace(`${LEGACY_BULLET}\n`);
  const cands = join(tmp, 'cands.json');
  writeFileSync(cands, JSON.stringify([{
    message_id: 'm1',
    from: 'no-reply@acme.com',
    subject: 'following up',
    body_snippet: 'Checking in on my application.',
  }]));

  const res = runCli(REPLY_WATCH, tmp, dataDir, trackerFile, [cands]);
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /#42|acme|Backend Engineer|following up/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('reply-watch: a table row reaches the matcher too', () => {
  const { tmp, dataDir, trackerFile } = setupWorkspace(
    '| num | appNum | date | company | role | channel | contact | notes |\n'
    + '|-----|--------|------|---------|------|---------|---------|-------|\n'
    + '| 1 | 42 | 2026-07-01 | Acme | Engineer | Email | careers@acme.com | applied |\n'
  );
  const cands = join(tmp, 'cands.json');
  writeFileSync(cands, JSON.stringify([{
    message_id: 'm1',
    from: 'no-reply@acme.com',
    subject: 'following up',
    body_snippet: 'Checking in on my application.',
  }]));

  const res = runCli(REPLY_WATCH, tmp, dataDir, trackerFile, [cands]);
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /#42|acme|Backend Engineer|following up/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('reply-watch: an unattributable bullet (no #num) does not match', () => {
  const { tmp, dataDir, trackerFile } = setupWorkspace('- 2026-07-02 · Acme — careers@acme.com\n');
  const cands = join(tmp, 'cands.json');
  writeFileSync(cands, JSON.stringify([{
    message_id: 'm1',
    from: 'no-reply@acme.com',
    subject: 'following up',
    body_snippet: 'Checking in on my application.',
  }]));

  const res = runCli(REPLY_WATCH, tmp, dataDir, trackerFile, [cands]);
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.doesNotMatch(res.stdout, /#42/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('contact-extract: a legacy bullet reaches the matcher', () => {
  const { tmp, dataDir, trackerFile } = setupWorkspace(`${LEGACY_BULLET}\n`);
  const res = runCli(CONTACT_EXTRACT, tmp, dataDir, trackerFile, [
    'Jane Doe <jane@acme.com>',
    'Re: application',
  ], 'y\n');
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /acme|contact|Saved/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});