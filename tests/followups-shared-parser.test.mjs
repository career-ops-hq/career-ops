import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, NODE } from './helpers.mjs';

const REPLY_WATCH = join(ROOT, 'reply-watch.mjs');
const CONTACT_EXTRACT = join(ROOT, 'contact-extract.mjs');

const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|';
const TRACKER_ROW = '| 42 | 2026-06-01 | Acme Corp | Backend Engineer | 4.0/5 | Applied | ❌ | - | |';

// The email is crafted so that NOTHING in it can reach application #42 without
// the follow-up entry: the tracker company is never named in the text, the role
// is never named, and the sender domain is `acme-partners.com` — not one of the
// `acmecorp.{com,co,io}` domains getAppDomains() guesses from the company name.
// The only route left is the contact recorded on the follow-up, which
// getAppDomains() picks up via `followups.filter(f => f.appNum === app.num)`.
const CANDIDATE = {
  message_id: 'm1',
  from: 'no-reply@acme-partners.com',
  subject: 'Interview invitation',
  body_snippet: 'Hello, I am following up on my application.',
};

const LEGACY_BULLET = '- 2026-07-02 · #42 Acme Corp — resent to careers@acme-partners.com';

const TABLE_ROWS = [
  '| num | appNum | date | company | role | channel | contact | notes |',
  '|-----|--------|------|---------|------|---------|---------|-------|',
  '| 1 | 42 | 2026-07-01 | Acme Corp | Backend Engineer | Email | careers@acme-partners.com | applied |',
].join('\n');

function setupWorkspace(followupsContents) {
  const tmp = mkdtempSync(join(tmpdir(), 'co-followups-shared-'));
  const dataDir = join(tmp, 'data');
  mkdirSync(dataDir, { recursive: true });
  const trackerFile = join(dataDir, 'applications.md');
  writeFileSync(trackerFile, `${HEADER}\n${TRACKER_ROW}\n`);
  writeFileSync(join(dataDir, 'follow-ups.md'), followupsContents);
  return {
    tmp,
    trackerFile,
    contactsFile: join(dataDir, 'contacts.tsv'),
    candidatesFile: join(tmp, 'cands.json'),
  };
}

function runCli(script, tmp, trackerFile, extra = [], input = 'n\n') {
  const res = spawnSync(NODE, [script, ...extra], {
    cwd: tmp,
    encoding: 'utf-8',
    timeout: 30000,
    input,
    env: {
      ...process.env,
      CAREER_OPS_TRACKER: trackerFile,
      // Both CLI consumers resolve writes under DATA_ROOT (README: "All write
      // operations canonically target {DATA_ROOT}/data/..."), and both read
      // `DATA_ROOT/data/follow-ups.md`. Pointing these at dataDir would look for
      // `dataDir/data/follow-ups.md`, silently skipping the fixture below.
      CAREER_OPS_DATA_DIR: tmp,
      CAREER_OPS_ROOT: tmp,
    },
  });
  return res;
}

function writeCandidates(path) {
  writeFileSync(path, JSON.stringify([CANDIDATE]));
  return [path];
}

test('reply-watch: a legacy bullet attributes a reply to application 42', () => {
  const { tmp, trackerFile, candidatesFile } = setupWorkspace(`${LEGACY_BULLET}\n`);
  const res = runCli(REPLY_WATCH, tmp, trackerFile, writeCandidates(candidatesFile));
  try {
    assert.equal(res.status, 0, res.stderr);
    // Header is rendered from the MATCHED TRACKER ROW, so company/role here can
    // only have come from resolving the candidate to #42.
    assert.match(res.stdout, /^1\. Acme Corp — Backend Engineer$/m);
    // And the status recommendation names the row number outright.
    assert.match(res.stdout, /^ {2}#42 Acme Corp \(Backend Engineer\): Applied → Interview$/m);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('reply-watch: a table row attributes a reply to application 42 too', () => {
  const { tmp, trackerFile, candidatesFile } = setupWorkspace(`${TABLE_ROWS}\n`);
  const res = runCli(REPLY_WATCH, tmp, trackerFile, writeCandidates(candidatesFile));
  try {
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /^1\. Acme Corp — Backend Engineer$/m);
    assert.match(res.stdout, /^ {2}#42 Acme Corp \(Backend Engineer\): Applied → Interview$/m);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('reply-watch: an unattributable bullet (no #num) does not match', () => {
  const { tmp, trackerFile, candidatesFile } = setupWorkspace('- 2026-07-02 · Acme Corp — careers@acme-partners.com\n');
  const res = runCli(REPLY_WATCH, tmp, trackerFile, writeCandidates(candidatesFile));
  try {
    assert.equal(res.status, 0, res.stderr);
    // No recommendation can be raised without an application_num, so #42 must
    // never appear...
    assert.doesNotMatch(res.stdout, /#42/);
    // ...and the header falls back to the raw subject instead of the row.
    assert.match(res.stdout, /^1\. Interview invitation$/m);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('contact-extract: a legacy bullet attributes the saved contact to 42', () => {
  const { tmp, trackerFile, contactsFile } = setupWorkspace(`${LEGACY_BULLET}\n`);
  const message = join(tmp, 'reply.txt');
  writeFileSync(message, [
    `Subject: ${CANDIDATE.subject}`,
    'From: Jane Doe <jane@acme-partners.com>',
    '',
    CANDIDATE.body_snippet,
  ].join('\n'));

  const res = runCli(CONTACT_EXTRACT, tmp, trackerFile, ['--file', message, '--yes']);
  try {
    assert.equal(res.status, 0, res.stderr);

    // Assert on the persisted row, not stdout: stdout only echoes the inferred
    // values, so it cannot tell us whether tracker #42 actually drove them.
    const rows = readFileSync(contactsFile, 'utf-8')
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('#'));
    assert.equal(rows.length, 1);

    // header: # name, company, type, title, phone, email, linkedin, tracker, notes
    const cells = rows[0].split('\t');
    assert.equal(cells[0], 'Jane Doe');
    assert.equal(cells[1], 'Acme Corp');
    assert.equal(cells[7], '42');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});