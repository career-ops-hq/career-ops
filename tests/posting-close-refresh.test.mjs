import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScanHistoryLine } from '../lib/scan-history-columns.mjs';
import { closeDateForUrl, closeDatesByUrl } from '../lib/posting-close.mjs';
import { computeListingFingerprint } from '../listing-fingerprint.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const URL = 'https://boards.example.com/fixture/close-date';
const TODAY = '2026-11-05';
const PATH_VARS = [
  'CAREER_OPS_PORTALS',
  'CAREER_OPS_PROFILE',
  'CAREER_OPS_PIPELINE',
  'CAREER_OPS_SCAN_HISTORY',
  'CAREER_OPS_ROOT',
  'CAREER_OPS_DATA_DIR',
  'CAREER_OPS_TRACKER',
  'FIXTURE_CLOSES_AT',
];

const PORTALS = `title_filter:
  positive:
    - "Strategic Finance"
tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/close-date-board.mjs
`;

const TRACKER_HEADER = `# Applications

| # | Date | Company | Role | Score | Status | PDF | Report | URL | Notes |
|---|---|---|---|---|---|---|---|---|---|
`;

const TRACKER_ROW = `| 1 | 2026-10-01 | Fixture Defense | Strategic Finance Manager | 4/5 | Evaluated | | | ${URL} | |
`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-close-refresh-'));
  mkdirSync(join(dir, 'data'));
  const tracker = join(dir, 'data', 'applications.md');
  writeFileSync(tracker, TRACKER_HEADER);
  writeFileSync(join(dir, 'portals.yml'), PORTALS);
  return { dir, tracker, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function childEnv(dir, closesAt) {
  const env = { ...process.env, CAREER_OPS_ROOT: dir, CAREER_OPS_HTTP_CACHE: '0' };
  for (const name of PATH_VARS) delete env[name];
  env.CAREER_OPS_ROOT = dir;
  if (closesAt) env.FIXTURE_CLOSES_AT = closesAt;
  return env;
}

function runScan(dir, closesAt) {
  return spawnSync(process.execPath, [join(ROOT, 'scan.mjs')], {
    cwd: dir,
    encoding: 'utf-8',
    env: childEnv(dir, closesAt),
  });
}

function runDiscard(dir) {
  return spawnSync(process.execPath, [join(ROOT, 'closing-soon.mjs'), '--discard-passed', '--today', TODAY], {
    cwd: dir,
    encoding: 'utf-8',
    env: childEnv(dir),
  });
}

function historyText(dir) {
  return readFileSync(join(dir, 'data', 'scan-history.tsv'), 'utf-8');
}

function dataRows(text) {
  return text.split('\n').filter((line) => line.startsWith('https://')).map(parseScanHistoryLine);
}

function pendingCount(dir) {
  const text = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf-8');
  // The posting is its own token. includes(URL) matches that string anywhere
  // in the line, which is the check CodeQL rejects.
  let count = 0;
  for (const line of text.split('\n')) {
    const match = /^- \[[ x]\]\s+(\S+)/.exec(line);
    if (match && match[1] === URL) count += 1;
  }
  return count;
}

test('a seen posting keeps a later close day and stays out of the pipeline', () => {
  const box = sandbox();
  try {
    const first = runScan(box.dir, '2026-10-03');
    assert.equal(first.status, 0, describeSpawn(first));
    assert.equal(pendingCount(box.dir), 1);
    const added = dataRows(historyText(box.dir));
    assert.equal(added.length, 1);
    assert.equal(added[0].status, 'added');
    assert.equal(added[0].closes_at, '2026-10-03');
    writeFileSync(box.tracker, TRACKER_HEADER + TRACKER_ROW);

    const early = runDiscard(box.dir);
    assert.equal(early.status, 0, describeSpawn(early));
    assert.match(early.stdout, /Would move to Discarded: #1/);

    const second = runScan(box.dir, '2026-12-01');
    assert.equal(second.status, 0, describeSpawn(second));
    assert.equal(pendingCount(box.dir), 1, second.stdout);
    const rows = dataRows(historyText(box.dir));
    assert.equal(rows.length, 2);
    assert.equal(rows[1].status, 'skipped_close_refresh');
    assert.equal(rows[1].closes_at, '2026-12-01');
    assert.equal(rows[1].fingerprint, '');
    assert.equal(closeDateForUrl(closeDatesByUrl(historyText(box.dir)), URL), '2026-12-01');

    const later = runDiscard(box.dir);
    assert.equal(later.status, 0, describeSpawn(later));
    assert.match(later.stdout, /No Evaluated row has a close date before/);

    const third = runScan(box.dir, '2026-12-01');
    assert.equal(third.status, 0, describeSpawn(third));
    assert.equal(dataRows(historyText(box.dir)).length, 2);
    assert.equal(pendingCount(box.dir), 1);

    const fourth = runScan(box.dir, '2026-11-01');
    assert.equal(fourth.status, 0, describeSpawn(fourth));
    const changed = dataRows(historyText(box.dir));
    assert.equal(changed.length, 3);
    assert.equal(changed[2].status, 'skipped_close_refresh');
    assert.equal(changed[2].closes_at, '2026-11-01');
    assert.equal(closeDateForUrl(closeDatesByUrl(historyText(box.dir)), URL), '2026-11-01');
    assert.equal(pendingCount(box.dir), 1);

    const applied = spawnSync(process.execPath, [join(ROOT, 'closing-soon.mjs'), '--discard-passed', '--apply', '--today', TODAY], {
      cwd: box.dir,
      encoding: 'utf-8',
      env: childEnv(box.dir),
    });
    assert.equal(applied.status, 0, describeSpawn(applied));
    assert.match(readFileSync(box.tracker, 'utf-8'), /\| Discarded \|/);

    const cleared = runScan(box.dir, 'none');
    assert.equal(cleared.status, 0, describeSpawn(cleared));
    assert.equal(dataRows(historyText(box.dir)).length, 3);
    assert.equal(closeDateForUrl(closeDatesByUrl(historyText(box.dir)), URL), '2026-11-01');
  } finally {
    box.cleanup();
  }
});

const CASE_UPPER = 'https://boards.example.com/fixture/Acme';
const CASE_LOWER = 'https://boards.example.com/fixture/acme';
const CASE_IDENTITY = { ats_provider: 'greenhouse', board_slug: 'acme', posting_id: '4012345' };

const CASE_PORTALS = `title_filter:
  positive:
    - "Strategic Finance"
tracked_companies:
  - name: Fixture Defense
    careers_url: https://boards.example.com/fixture
    parser:
      command: node
      script: tests/fixtures/close-date-case-board.mjs
`;

test('a scan keeps an exact tracker path case when listing identity matches', { timeout: 60000 }, () => {
  const box = sandbox();
  try {
    writeFileSync(join(box.dir, 'portals.yml'), CASE_PORTALS);
    const first = spawnSync(process.execPath, [join(ROOT, 'scan.mjs')], {
      cwd: box.dir,
      encoding: 'utf-8',
      env: { ...childEnv(box.dir, '2026-10-03'), FIXTURE_JOB_URL: CASE_UPPER },
    });
    assert.equal(first.status, 0, describeSpawn(first));
    const added = dataRows(historyText(box.dir));
    assert.equal(added.length, 1);
    assert.equal(added[0].url, CASE_UPPER);
    assert.equal(added[0].listing_key, computeListingFingerprint({ strong: CASE_IDENTITY }).listing_key);
    writeFileSync(box.tracker, `${TRACKER_HEADER}| 1 | 2026-10-01 | Fixture Defense | Strategic Finance Manager | 4/5 | Evaluated | | | ${CASE_UPPER} | |
| 2 | 2026-10-01 | Fixture Defense | Other Analyst | 4/5 | Evaluated | | | ${CASE_LOWER} | |
`);
    const second = spawnSync(process.execPath, [join(ROOT, 'scan.mjs')], {
      cwd: box.dir,
      encoding: 'utf-8',
      env: { ...childEnv(box.dir, '2026-12-01'), FIXTURE_JOB_URL: CASE_LOWER },
    });
    assert.equal(second.status, 0, describeSpawn(second));
    const rows = dataRows(historyText(box.dir));
    assert.equal(rows.length, 2);
    assert.equal(rows[1].status, 'skipped_close_refresh');
    assert.equal(rows[1].url, CASE_LOWER);
    assert.equal(rows[1].closes_at, '2026-12-01');
    const index = closeDatesByUrl(historyText(box.dir));
    assert.equal(closeDateForUrl(index, CASE_LOWER), '2026-12-01');
    assert.equal(closeDateForUrl(index, CASE_UPPER), '2026-10-03');
    const pipeline = readFileSync(join(box.dir, 'data', 'pipeline.md'), 'utf-8');
    let upper = 0;
    let lower = 0;
    for (const line of pipeline.split('\n')) {
      const match = /^- \[[ x]\]\s+(\S+)/.exec(line);
      if (!match) continue;
      if (match[1] === CASE_UPPER) upper += 1;
      if (match[1] === CASE_LOWER) lower += 1;
    }
    assert.equal(upper, 1);
    assert.equal(lower, 0);
  } finally {
    box.cleanup();
  }
});
