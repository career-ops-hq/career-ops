// tests/set-status-archives-jd.test.mjs — the transition into Interview is
// the last reliable moment to archive a JD automatically (#4506 direction 2).
//
// A row entered through `add` (a referral, a recruiter reach-out, a posting
// that skipped `oferta`/`pdf`) never gets a JD archived, and interview-prep's
// last resort once the posting has closed is "ask the user to paste the JD
// text instead" — which fails if the user never kept a copy either.
//
// This exercises only the GATING logic (already-embedded / already-captured /
// no-url / no-report-number / wrong-transition / dry-run), never the actual
// archive-posting.mjs → Chromium → live-network path: no test file in this
// repo runs that path (archive-posting.mjs has no dedicated test suite of its
// own), and a unit test that launched a real browser against a real URL would
// be flaky and slow for no benefit — the gating is exactly what determines
// whether that subprocess is ever spawned, so it is what needs proving here.
//
// Run:  node --test tests/set-status-archives-jd.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const HEADER = '| # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |';
const SEP = '|---|---|---|---|---|---|---|---|---|---|';

function sandbox({ status = 'Evaluated', url = 'https://boards.greenhouse.io/acme/jobs/1', reportCell = '[7](../reports/007-acme-2026-02-01.md)' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-jd-archive-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  writeFileSync(join(dir, 'data', 'applications.md'), [
    '# Applications Tracker', '', HEADER, SEP,
    `| 7 | 2026-02-01 | Acme | Backend Engineer | 4.4/5 | ${status} | ✅ | ${reportCell} | notes | ${url} |`,
    '',
  ].join('\n'));
  return dir;
}

function setStatus(dir, args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'set-status.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_TRACKER: join(dir, 'data', 'applications.md') },
  });
  assert.equal(r.error, undefined, `spawn failed: ${r.error?.message}`);
  return { ...r, all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const jsonOf = (r) => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 10 });

test('an already-embedded JD is never re-archived', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'),
    '# Eval\n\n## Job Description (archived verbatim)\n\nWe are looking for a Senior Backend Engineer to join our platform team and own the checkout service end to end.\n\n## Machine Summary\n');
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'already-embedded');
  } finally { cleanup(dir); }
});

test('an already-captured JD (jds/ has a matching file) is never re-archived', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'), '# Eval\n\n## Job Description (archived verbatim)\n\nTBD\n');
  mkdirSync(join(dir, 'jds'), { recursive: true });
  writeFileSync(join(dir, 'jds', '007-acme.pdf'), 'not a real pdf, existence is all that matters');
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'already-captured');
  } finally { cleanup(dir); }
});

test('a row with no URL is not attempted', () => {
  const dir = sandbox({ url: '' });
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'no-url');
  } finally { cleanup(dir); }
});

test('a row whose report cell resolves to no number is not attempted', () => {
  const dir = sandbox({ reportCell: '—' });
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.jdArchiveTriggered?.attempted, false);
    assert.equal(r.jdArchiveTriggered?.reason, 'no-report-number');
  } finally { cleanup(dir); }
});

test('a transition to any status other than Interview triggers nothing', () => {
  const dir = sandbox();
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Applied', '--json']));
    assert.equal(r.jdArchiveTriggered, undefined, 'jdArchiveTriggered must not appear on a non-Interview transition');
  } finally { cleanup(dir); }
});

test('--dry-run triggers nothing (nothing was written for archive-posting to attach a --report to)', () => {
  const dir = sandbox();
  try {
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--dry-run', '--json']));
    assert.equal(r.jdArchiveTriggered, undefined, 'jdArchiveTriggered must not appear on a dry run');
  } finally { cleanup(dir); }
});

test('re-running on an already-Interview row does not retry (statusChanged gates it, same as follow-up seeding)', () => {
  const dir = sandbox();
  writeFileSync(join(dir, 'reports', '007-acme-2026-02-01.md'), '# Eval\n\n## Job Description (archived verbatim)\n\nAlready archived, so the first call resolves cleanly.\n');
  try {
    setStatus(dir, ['--row', '7', 'Interview']);
    const r = jsonOf(setStatus(dir, ['--row', '7', 'Interview', '--json']));
    assert.equal(r.changed, false, 'the second call should be a no-op re-run, not a fresh transition');
    assert.equal(r.jdArchiveTriggered, undefined, 'an idempotent re-run must not re-evaluate the trigger at all');
  } finally { cleanup(dir); }
});
