// tests/status-hooks-writers.test.mjs — status changes made outside
// set-status.mjs run the same hooks (#5536).
//
// reply-watch.mjs used to edit the Status cell itself and write only a ledger
// row, so a recruiter's interview invite never triggered the JD archive.
// dedup-tracker.mjs moves a removed duplicate's status onto the kept row and
// ran no hook at all. Each path is driven end to end here.
//
// The JD archive is pointed at 127.0.0.1, which archive-posting.mjs refuses
// before it launches a browser, so the attempt is visible as a failure without
// any network access.
//
// Run:  node --test tests/status-hooks-writers.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, rmSync } from './helpers.mjs';
import { describeSpawn } from './helpers/describe-spawn.mjs';
import { parseStatusLog, foldObservations } from '../funnel-velocity.mjs';
import { loadCanonicalStates } from '../tracker-utils.mjs';

const BLOCKED_URL = 'http://127.0.0.1:9/jobs/1';
const REPORT = '[5](../reports/005-acme-2026-06-01.md)';

function workspace(t, rows, { url = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-status-hooks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const data = join(root, 'data');
  mkdirSync(data);
  mkdirSync(join(root, 'reports'));
  // A report with no JD section, so the archive hook has work to do.
  writeFileSync(join(root, 'reports', '005-acme-2026-06-01.md'), '# Eval\n\nNo job description was archived.\n');
  const header = url
    ? '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |\n|---|---|---|---|---|---|---|---|---|---|'
    : '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|';
  const file = join(data, 'applications.md');
  writeFileSync(file, `# Applications\n\n${header}\n${rows.join('\n')}\n`);
  return {
    root, data, file,
    env: {
      ...process.env,
      CAREER_OPS_ROOT: root,
      CAREER_OPS_DATA_DIR: '',
      CAREER_OPS_TRACKER: file,
      CAREER_OPS_JD_ARCHIVE_TIMEOUT_MS: '20000',
    },
  };
}

function runScript(w, script, args = [], input = '') {
  const r = spawnSync(process.execPath, [join(ROOT, script), ...args], {
    cwd: w.root, env: w.env, input, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(r.error, undefined, r.error?.message);
  return { ...r, all: `${r.stdout}${r.stderr}` };
}

const ledger = w => readFileSync(join(w.data, 'status-log.tsv'), 'utf8').trim().split('\n');

test('reply-watch: an accepted Interview goes through set-status and attempts the JD archive', (t) => {
  const w = workspace(t, [
    `| 1 | 2026-06-01 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | ${REPORT} | | ${BLOCKED_URL} |`,
  ], { url: true });
  const candidates = join(w.root, 'candidates.json');
  writeFileSync(candidates, JSON.stringify([{
    message_id: 'invite',
    from: 'hr@acme.com',
    subject: 'Acme — Backend Engineer',
    body_snippet: 'We would like to invite you to interview. Please pick a time slot.',
  }]));

  const r = runScript(w, 'reply-watch.mjs', [candidates], 'y\n');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(r.stdout, /Updated #1 to Interview/);
  assert.match(readFileSync(w.file, 'utf8'), /\| 1 \|.+\| Interview \|/);
  // The archive was attempted for this row's report. It fails only because
  // the fixture URL is a host archive-posting.mjs refuses.
  assert.match(r.all, /JD archive trigger failed .*archive-posting\.mjs --report=5 --company=Acme/);
  assert.deepEqual(ledger(w).map(line => line.split('\t').slice(2, 5)), [['Applied', 'Interview', 'reply-watch']]);
});

test('dedup-tracker: a promotion into Applied writes a ledger row and seeds a follow-up', (t) => {
  const w = workspace(t, [
    `| 1 | 2026-06-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | ${REPORT} | first |`,
    `| 2 | 2026-06-03 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | ${REPORT} | sent |`,
  ]);

  const r = runScript(w, 'dedup-tracker.mjs');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(r.stdout, /#1: status promoted to "Applied" \(from #2\)/);
  assert.match(readFileSync(w.file, 'utf8'), /\| 1 \|.+\| Applied \|/);
  assert.doesNotMatch(readFileSync(w.file, 'utf8'), /\| 2 \| 2026-06-03 \|/);

  const rows = ledger(w);
  assert.equal(rows.length, 1, rows.join('\n'));
  assert.match(rows[0], /^1\t\d{4}-\d{2}-\d{2}\tEvaluated\tApplied\tdedup-tracker\tfrom #2$/);
  assert.match(readFileSync(join(w.data, 'follow-ups.md'), 'utf8'), /^- next #1 \d{4}-\d{2}-\d{2}/m);
});

test('dedup-tracker: a promotion into Interview attempts the JD archive', (t) => {
  const w = workspace(t, [
    `| 1 | 2026-06-01 | Acme | Backend Engineer | 4.5/5 | Applied | ❌ | ${REPORT} | first | ${BLOCKED_URL} |`,
    `| 2 | 2026-06-03 | Acme | Backend Engineer | 4.0/5 | Interview | ❌ | ${REPORT} | screen | ${BLOCKED_URL} |`,
  ], { url: true });

  const r = runScript(w, 'dedup-tracker.mjs');
  assert.equal(r.status, 0, describeSpawn(r));
  assert.match(r.all, /JD archive trigger failed .*archive-posting\.mjs --report=5 --company=Acme/);
  assert.match(ledger(w)[0], /^1\t\d{4}-\d{2}-\d{2}\tApplied\tInterview\tdedup-tracker\tfrom #2$/);
});

test('dedup-tracker: a dry run and a run with no promotion leave no ledger row', (t) => {
  const w = workspace(t, [
    `| 1 | 2026-06-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | ${REPORT} | first |`,
    `| 2 | 2026-06-03 | Acme | Backend Engineer | 4.0/5 | Applied | ❌ | ${REPORT} | sent |`,
  ]);
  assert.equal(runScript(w, 'dedup-tracker.mjs', ['--dry-run']).status, 0);
  assert.equal(existsSync(join(w.data, 'status-log.tsv')), false);

  const same = workspace(t, [
    `| 1 | 2026-06-01 | Acme | Backend Engineer | 4.5/5 | Evaluated | ❌ | ${REPORT} | first |`,
    `| 2 | 2026-06-03 | Acme | Backend Engineer | 4.0/5 | Evaluated | ❌ | ${REPORT} | second |`,
  ]);
  assert.equal(runScript(same, 'dedup-tracker.mjs').status, 0);
  assert.equal(existsSync(join(same.data, 'status-log.tsv')), false);
});

test('funnel-velocity counts a dedup-tracker row but keeps it out of day-math', () => {
  const states = loadCanonicalStates(join(ROOT, 'templates', 'states.yml'));
  const { observations, unknownSources } = parseStatusLog('1\t2026-10-20\tEvaluated\tApplied\tdedup-tracker\tfrom #2\n', states);
  assert.deepEqual(unknownSources, []);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].dayMath, false);
  assert.equal(foldObservations(observations).get(1)?.[0]?.to, 'Applied');
});
